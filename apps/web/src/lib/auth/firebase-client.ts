import { getApps, initializeApp } from '@firebase/app';
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  onAuthStateChanged,
  reauthenticateWithCredential,
  RecaptchaVerifier,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
  updatePassword,
  verifyPasswordResetCode,
  type Auth,
  type ConfirmationResult,
} from '@firebase/auth';
import {
  analyticsAuthCode,
  codeFailFor,
  hasPasswordProvider,
  passwordLinkedFor,
  phoneSendFailFor,
  type CodeFail,
  type PhoneFail,
} from './auth-errors';
import { isTransientAuthCode, retryOnce } from './sign-in-retry';
import { changeFailFor, type ChangeFail } from './password-change';
import type { RealMe } from './real-account';

/**
 * Real sign-in in the browser (spec 01 "Password sign-in", Q69 firebase mode). **Heavy**: import it only with
 * `import('@/lib/auth/firebase-client')` from the sign-in screens, never from a module the header or other
 * pages load (JS budget, learning L63).
 *
 * - Sign-up: phone code (Firebase SMS, invisible reCAPTCHA) → email + password linked to that phone account →
 *   the API signs them in again (custom token) → verification email → name and language saved through the API.
 * - Sign-in: `POST /v1/auth/password` (the API checks the password, Turnstile and limits) → custom token.
 *   Staff: the API answers `staff_code` → phone code → the same call again with the phone token.
 * - Forgot password: phone code then a new password, or an email link.
 * - Verification and reset emails are sent by the API (`/v1/auth/verification-email`, `/v1/auth/password-reset-email`,
 *   decision 2026-11-24), never by the Firebase client SDK: Firebase would link to its own page, and the project
 *   cannot be given a custom action URL. The links open `/auth/action` on our domain.
 */

const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

let auth: Auth | null = null;
let confirmation: ConfirmationResult | null = null;
let verifier: RecaptchaVerifier | null = null;

function firebaseAuth(locale: string): Auth {
  if (!auth) {
    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
        // Web push (Q103) reads the same app: the sender id must be on whichever code created it first.
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      });
    auth = getAuth(app);
    const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
    if (emulator) connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
  }
  // SMS and emails in the visitor's language (hard rule 10).
  auth.languageCode = locale;
  return auth;
}

const codeOf = (err: unknown) =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : '';

export type { CodeFail, PhoneFail };

/** Start Firebase up (app + auth object, and the stored session) while the sign-in form is still being filled in. */
export function warmFirebase(locale: string): void {
  void firebaseAuth(locale).authStateReady();
}

/** A closed reCAPTCHA challenge never settles the send: give up after this long (a11y review 2026-11-09). */
const SEND_TIMEOUT_MS = 60_000;

/**
 * Send a sign-in code to an Indian mobile (`+91…`). `containerId` holds the reCAPTCHA badge (inline, so no fixed
 * badge covers the mobile tab bar or the focused button: WCAG 2.4.11). If the person closes Google's challenge the
 * send never settles, so it times out and a fresh verifier is made for the retry.
 */
export async function sendPhoneCode(
  e164: string,
  locale: string,
  containerId: string,
): Promise<{ ok: true } | { ok: false; reason: PhoneFail; code: string }> {
  const a = firebaseAuth(locale);
  try {
    verifier?.clear();
    // A fresh host element per attempt: a retry on the same page that rendered into the container a cleared or
    // abandoned verifier had used failed as "Sign-in isn't working right now" (real-API pass 3, 2026-11-16).
    const container = document.getElementById(containerId);
    if (!container)
      throw Object.assign(new Error('recaptcha container missing'), { code: 'auth/internal-error' });
    container.replaceChildren();
    const host = document.createElement('div');
    container.appendChild(host);
    verifier = new RecaptchaVerifier(a, host, { size: 'invisible', badge: 'inline' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('captcha timeout'), { code: 'auth/captcha-check-failed' }));
      }, SEND_TIMEOUT_MS);
    });
    try {
      confirmation = await Promise.race([signInWithPhoneNumber(a, e164, verifier), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return { ok: true };
  } catch (err) {
    verifier?.clear();
    verifier = null;
    const code = codeOf(err);
    return { ok: false, reason: phoneSendFailFor(code), code: analyticsAuthCode(code) };
  }
}

/** Check the 6-digit code. `hasPassword`: this phone already has an account with a password (sign in instead). */
export async function confirmPhoneCode(
  code: string,
): Promise<{ ok: true; hasPassword: boolean } | { ok: false; reason: CodeFail; code: string }> {
  if (!confirmation) return { ok: false, reason: 'otp', code: 'unknown' };
  try {
    const { user } = await confirmation.confirm(code);
    return { ok: true, hasPassword: user.providerData.some((p) => p.providerId === 'password') };
  } catch (err) {
    return { ok: false, reason: codeFailFor(codeOf(err)), code: analyticsAuthCode(codeOf(err)) };
  }
}

/** True when the signed-in Firebase user already has email + password linked (a sign-up retry). */
export function sessionHasPassword(): boolean {
  return hasPasswordProvider(auth?.currentUser?.providerData ?? []);
}

/**
 * Sign-up step 3: link email + password to the phone account. The one-time verification email is sent afterwards
 * (`resendVerification`), once the API has signed the person in again: linking turns the Firebase session into a
 * `password` one, which the API refuses.
 */
export async function linkEmailPassword(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; reason: 'email_in_use' | 'unavailable' }> {
  const user = auth?.currentUser;
  if (!user) return { ok: false, reason: 'unavailable' };
  // A retry after an earlier link succeeded (the next step failed): already linked is fine (review B15).
  if (passwordLinkedFor(user.providerData, email)) return { ok: true };
  try {
    await linkWithCredential(user, EmailAuthProvider.credential(email, password));
  } catch (err) {
    const c = codeOf(err);
    if (c === 'auth/email-already-in-use' || c === 'auth/credential-already-in-use')
      return { ok: false, reason: 'email_in_use' };
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true };
}

/**
 * Email verification status for the account-area banner (spec 01: verified once, needed before ordering). Waits
 * for Firebase to restore the session after a page load, reloads the user (the link may have been opened in
 * another tab or on the phone), and once verified tells the API right away (a fresh token on `GET /v1/me`).
 * Null when nobody is signed in to Firebase or the account has no email.
 */
export async function emailStatus(locale: string): Promise<{ email: string; verified: boolean } | null> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  const user = a.currentUser;
  if (!user?.email) return null;
  await user.reload().catch(() => undefined);
  if (user.emailVerified) await fetchMe(true).catch(() => null);
  return { email: user.email, verified: user.emailVerified };
}

/**
 * Send the verification email (sign-up, and "send again" in the account area): the API mails the account's own
 * address a link to our `/auth/action` page. False when it could not be sent; an address that is already verified
 * counts as sent (nothing is wrong).
 */
export async function resendVerification(locale: string): Promise<boolean> {
  const token = await currentIdToken(locale);
  if (!token) return false;
  const res = await api('/auth/verification-email', {
    method: 'POST',
    token,
    body: JSON.stringify({ locale: locale === 'hi' ? 'hi' : 'en' }),
  }).catch(() => null);
  return res?.ok ?? false;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return fetch(`${API}/v1${path}`, { ...init, headers, credentials: 'omit' });
}

export type PasswordResult =
  | { ok: true; status: 'signed_in' }
  | { ok: true; status: 'staff_code'; phone: string }
  | {
      ok: false;
      reason:
        'invalid' | 'locked' | 'turnstile' | 'network' | 'unavailable' | 'staff_mismatch' | 'staff_expired';
      retryAfterSeconds?: number;
    };

/**
 * Phone or email + password through the API. Staff: call once without `phoneToken` (→ `staff_code`), sign in with
 * the phone code, then again with `phoneToken: true` to send that fresh phone session's token.
 */
export async function passwordSignIn(input: {
  identifier: string;
  password: string;
  turnstileToken: string;
  locale: string;
  phoneToken?: boolean;
}): Promise<PasswordResult> {
  const a = firebaseAuth(input.locale);
  const token = input.phoneToken ? await a.currentUser?.getIdToken() : undefined;
  // A request that never reached the API (a network blink) is safe to send once more.
  const sent = await retryOnce(
    () =>
      api('/auth/password', {
        method: 'POST',
        body: JSON.stringify({
          identifier: input.identifier,
          password: input.password,
          turnstileToken: input.turnstileToken,
        }),
        ...(token ? { token } : {}),
      }).then(
        (response) => ({ response }),
        () => ({ response: null }),
      ),
    (r) => r.response === null,
  );
  const res = sent.response;
  if (!res) return { ok: false, reason: 'network' };
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    customToken?: string;
    phone?: string;
    error?: { code?: string };
  };
  if (res.ok && body.status === 'staff_code' && body.phone)
    return { ok: true, status: 'staff_code', phone: body.phone };
  if (res.ok && body.status === 'signed_in' && body.customToken) {
    const customToken = body.customToken;
    // The one-hour custom token is still good after a network blink: try the exchange once more before failing.
    const exchanged = await retryOnce(
      () =>
        signInWithCustomToken(a, customToken).then(
          () => ({ ok: true as const }),
          (err: unknown) => ({ ok: false as const, code: codeOf(err) }),
        ),
      (r) => !r.ok && isTransientAuthCode(r.code),
    );
    return exchanged.ok ? { ok: true, status: 'signed_in' } : { ok: false, reason: 'unavailable' };
  }
  switch (body.error?.code) {
    case 'INVALID_CREDENTIALS':
      return { ok: false, reason: 'invalid' };
    case 'ACCOUNT_LOCKED':
      return {
        ok: false,
        reason: 'locked',
        retryAfterSeconds: Number(res.headers.get('retry-after') ?? 900),
      };
    case 'TURNSTILE_FAILED':
      return { ok: false, reason: 'turnstile' };
    case 'STAFF_CODE_MISMATCH':
      return { ok: false, reason: 'staff_mismatch' };
    case 'STAFF_CODE_EXPIRED':
    case 'STAFF_CODE_INVALID':
      return { ok: false, reason: 'staff_expired' };
    default:
      return { ok: false, reason: 'unavailable' };
  }
}

export type ApiMe = RealMe & { version: number };

/** The signed-in user's ID token for API calls (waits for Firebase to restore the session), or null. */
export async function currentIdToken(locale: string, forceRefresh = false): Promise<string | null> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  return a.currentUser ? a.currentUser.getIdToken(forceRefresh) : null;
}

/** The signed-in Firebase user's id (waits for Firebase to restore the session), or null. */
export async function currentUid(locale: string): Promise<string | null> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  return a.currentUser?.uid ?? null;
}

/** Calls `cb` with the signed-in user's id now and whenever it changes (null = signed out). Returns the stop function. */
export function watchUid(locale: string, cb: (uid: string | null) => void): () => void {
  return onAuthStateChanged(firebaseAuth(locale), (user) => {
    cb(user?.uid ?? null);
  });
}

/**
 * `GET /v1/me` for the signed-in Firebase user (creates the profile row on first sign-up). `blocked`: the API
 * refuses this account (blocked or deactivated) — the caller signs out and shows why. `forceRefresh` costs a
 * round trip to Google: only for a caller that needs a claim changed after the last sign-in (email verified);
 * right after sign-in the token is already fresh (sign-in speed pass 2026-11-23).
 */
export async function fetchMe(forceRefresh = false): Promise<ApiMe | 'blocked' | null> {
  const token = await auth?.currentUser?.getIdToken(forceRefresh);
  if (!token) return null;
  const res = await api('/me', { token }).catch(() => null);
  if (!res) return null;
  if (res.ok) return (await res.json()) as ApiMe;
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  const code = body.error?.code ?? '';
  return code === 'ACCOUNT_BLOCKED' || code === 'ACCOUNT_DEACTIVATED' ? 'blocked' : null;
}

/** Save name and language after sign-up (`PATCH /v1/me`, compare-and-set on `version`). */
export async function saveProfile(
  me: ApiMe,
  patch: { name: string; language: 'en' | 'hi' },
): Promise<ApiMe | null> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return null;
  const res = await api('/me', {
    method: 'PATCH',
    token,
    body: JSON.stringify({ ...patch, version: me.version }),
  }).catch(() => null);
  return res?.ok ? ((await res.json()) as ApiMe) : null;
}

/** Forgot password by phone: after `confirmPhoneCode`, set the new password on the account. */
export async function setNewPassword(password: string, locale: string): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user) return false;
  return updatePassword(user, password).then(
    () => {
      void notifyPasswordChanged(user.email ?? '', locale);
      return true;
    },
    () => false,
  );
}

/**
 * Change password (Account → Profile → Security): prove the current one again (the email + password credential the
 * account was linked with at sign-up), then set the new one. Firebase ends the account's other sessions when the
 * password changes (their refresh tokens stop working); this browser gets fresh tokens.
 */
export async function changePassword(
  locale: string,
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; reason: ChangeFail; code: string }> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  const user = a.currentUser;
  if (!user?.email) return { ok: false, reason: 'unavailable', code: 'unknown' };
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    await updatePassword(user, next);
    void notifyPasswordChanged(user.email, locale);
    return { ok: true };
  } catch (err) {
    const code = codeOf(err);
    return { ok: false, reason: changeFailFor(code), code: analyticsAuthCode(code) };
  }
}

/**
 * Tell the API a password was just changed so it can email the account holder a security notice (decision
 * 2026-11-24). Best effort and never throws: the change has already happened. The API does not take our word for it:
 * it asks Firebase when the password last changed and sends once per change. `keepalive` lets the request finish
 * if the page is left right away.
 */
export async function notifyPasswordChanged(email: string, locale: string): Promise<void> {
  if (!email) return;
  try {
    await api('/auth/password-changed', {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ email, locale: locale === 'hi' ? 'hi' : 'en' }),
    });
  } catch {
    // The notice is a courtesy; the password is already changed.
  }
}

export type ResetEmailResult =
  { ok: true } | { ok: false; reason: 'turnstile' | 'rate' | 'network' | 'unavailable' };

/**
 * Forgot password by email (`POST /v1/auth/password-reset-email`, with the Cloudflare check): the API answers the
 * same for every address, so an accepted request says nothing about whether an account exists.
 */
export async function sendResetEmail(
  email: string,
  locale: string,
  turnstileToken: string,
): Promise<ResetEmailResult> {
  const res = await api('/auth/password-reset-email', {
    method: 'POST',
    body: JSON.stringify({ email, locale: locale === 'hi' ? 'hi' : 'en', turnstileToken }),
  }).catch(() => null);
  if (!res) return { ok: false, reason: 'network' };
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
  if (body.error?.code === 'TURNSTILE_FAILED') return { ok: false, reason: 'turnstile' };
  return { ok: false, reason: res.status === 429 ? 'rate' : 'unavailable' };
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

/** Email link `verifyEmail` / `verifyAndChangeEmail`: apply the code (single use). */
export async function applyEmailLink(code: string, locale: string): Promise<ActionResult> {
  try {
    await applyActionCode(firebaseAuth(locale), code);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: analyticsAuthCode(codeOf(err)) };
  }
}

/** Email link `recoverEmail`: read the restored address, then apply the code. */
export async function recoverEmailLink(
  code: string,
  locale: string,
): Promise<ActionResult<{ email: string }>> {
  try {
    const a = firebaseAuth(locale);
    const info = await checkActionCode(a, code);
    await applyActionCode(a, code);
    return { ok: true, email: info.data.email ?? '' };
  } catch (err) {
    return { ok: false, code: analyticsAuthCode(codeOf(err)) };
  }
}

/** Email link `resetPassword`, step 1: is the code good, and for which email. */
export async function checkResetLink(code: string, locale: string): Promise<ActionResult<{ email: string }>> {
  try {
    return { ok: true, email: await verifyPasswordResetCode(firebaseAuth(locale), code) };
  } catch (err) {
    return { ok: false, code: analyticsAuthCode(codeOf(err)) };
  }
}

/** Email link `resetPassword`, step 2: set the new password (the code is used up). */
export async function finishPasswordReset(
  code: string,
  password: string,
  locale: string,
): Promise<ActionResult> {
  try {
    await confirmPasswordReset(firebaseAuth(locale), code, password);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: analyticsAuthCode(codeOf(err)) };
  }
}

export async function signOutReal(): Promise<void> {
  if (auth) await signOut(auth).catch(() => undefined);
}
