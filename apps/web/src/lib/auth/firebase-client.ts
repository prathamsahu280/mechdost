import { getApps, initializeApp } from '@firebase/app';
import {
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth,
  linkWithCredential,
  RecaptchaVerifier,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
  updatePassword,
  type Auth,
  type ConfirmationResult,
} from '@firebase/auth';
import { codeFailFor, passwordLinkedFor, type CodeFail } from './auth-errors';
import type { RealMe } from './real-account';

/**
 * Real sign-in in the browser (spec 01 "Password sign-in", Q69 firebase mode). **Heavy**: import it only with
 * `import('@/lib/auth/firebase-client')` from the sign-in screens, never from a module the header or other
 * pages load (JS budget, learning L63).
 *
 * - Sign-up: phone code (Firebase SMS, invisible reCAPTCHA) → email + password linked to that phone account →
 *   verification email → name and language saved through the API.
 * - Sign-in: `POST /v1/auth/password` (the API checks the password, Turnstile and limits) → custom token.
 *   Staff: the API answers `staff_code` → phone code → the same call again with the phone token.
 * - Forgot password: phone code then a new password, or Firebase's reset email.
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

export type PhoneFail = 'phone' | 'rate' | 'captcha' | 'unavailable';
export type { CodeFail };

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
): Promise<{ ok: true } | { ok: false; reason: PhoneFail }> {
  const a = firebaseAuth(locale);
  try {
    verifier?.clear();
    verifier = new RecaptchaVerifier(a, containerId, { size: 'invisible', badge: 'inline' });
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
    if (code === 'auth/invalid-phone-number') return { ok: false, reason: 'phone' };
    if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded')
      return { ok: false, reason: 'rate' };
    if (code === 'auth/captcha-check-failed') return { ok: false, reason: 'captcha' };
    return { ok: false, reason: 'unavailable' };
  }
}

/** Check the 6-digit code. `hasPassword`: this phone already has an account with a password (sign in instead). */
export async function confirmPhoneCode(
  code: string,
): Promise<{ ok: true; hasPassword: boolean } | { ok: false; reason: CodeFail }> {
  if (!confirmation) return { ok: false, reason: 'otp' };
  try {
    const { user } = await confirmation.confirm(code);
    return { ok: true, hasPassword: user.providerData.some((p) => p.providerId === 'password') };
  } catch (err) {
    return { ok: false, reason: codeFailFor(codeOf(err)) };
  }
}

/** Sign-up step 3: link email + password to the phone account, then send the one-time verification email. */
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
  // A failed send is not fatal: the account area offers "send again".
  await sendEmailVerification(user).catch(() => undefined);
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
  if (user.emailVerified) await fetchMe().catch(() => null);
  return { email: user.email, verified: user.emailVerified };
}

/** Send the verification email again (account-area banner). False when it could not be sent. */
export async function resendVerification(locale: string): Promise<boolean> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  const user = a.currentUser;
  if (!user) return false;
  return sendEmailVerification(user).then(
    () => true,
    () => false,
  );
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
      reason: 'invalid' | 'locked' | 'turnstile' | 'unavailable' | 'staff_mismatch' | 'staff_expired';
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
  let res: Response;
  try {
    res = await api('/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        identifier: input.identifier,
        password: input.password,
        turnstileToken: input.turnstileToken,
      }),
      ...(token ? { token } : {}),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    customToken?: string;
    phone?: string;
    error?: { code?: string };
  };
  if (res.ok && body.status === 'staff_code' && body.phone)
    return { ok: true, status: 'staff_code', phone: body.phone };
  if (res.ok && body.status === 'signed_in' && body.customToken) {
    try {
      await signInWithCustomToken(a, body.customToken);
      return { ok: true, status: 'signed_in' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
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
export async function currentIdToken(locale: string): Promise<string | null> {
  const a = firebaseAuth(locale);
  await a.authStateReady();
  return a.currentUser ? a.currentUser.getIdToken() : null;
}

/**
 * `GET /v1/me` for the signed-in Firebase user (creates the profile row on first sign-up). `blocked`: the API
 * refuses this account (blocked or deactivated) — the caller signs out and shows why.
 */
export async function fetchMe(): Promise<ApiMe | 'blocked' | null> {
  const token = await auth?.currentUser?.getIdToken(true);
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
export async function setNewPassword(password: string): Promise<boolean> {
  const user = auth?.currentUser;
  if (!user) return false;
  return updatePassword(user, password).then(
    () => true,
    () => false,
  );
}

/** Forgot password by email: always looks the same to the person asking (no account enumeration). */
export async function sendResetEmail(email: string, locale: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth(locale), email).catch(() => undefined);
}

export async function signOutReal(): Promise<void> {
  if (auth) await signOut(auth).catch(() => undefined);
}
