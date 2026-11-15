'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '@/demo/passwords';
import {
  DEMO_OTP,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
  adoptRealAccount,
  completeStaffSignIn,
  homeFor,
  normalisePhone,
  requestEmailReset,
  resetLinkValid,
  resetPasswordWithLink,
  resetPasswordWithOtp,
  safeNext,
  signInWithPassword,
  signUp,
  useSession,
  verifyPhoneOtp,
  type DemoAccount,
  type DemoRole,
} from '@/demo/session';
import { track } from '@/lib/analytics';
import type * as RealClientModule from '@/lib/auth/firebase-client';
import { AUTH_MODE } from '@/lib/auth/mode';
import { PasswordField, authInput } from './password-field';

type Step =
  | 'signin'
  | 'staff'
  | 'signup-phone'
  | 'signup-otp'
  | 'signup-profile'
  | 'signup-done'
  | 'forgot'
  | 'forgot-phone'
  | 'forgot-otp'
  | 'forgot-email'
  | 'forgot-email-sent'
  | 'reset-link';

/** Real accounts (Firebase + the API) or the browser-only demo (Q69). */
const REAL = AUTH_MODE === 'firebase';
/** Firebase is heavy: loaded only when a real-mode step needs it (JS budget, L63). */
type RealClient = typeof RealClientModule;
let realClient: Promise<RealClient> | null = null;
const real = () => (realClient ??= import('@/lib/auth/firebase-client'));
const turnstile = () => import('@/lib/auth/turnstile');

const RESEND_SECONDS = 30;
/** Busy work this slow is announced; faster work stays quiet (a11y review 2026-11-09). */
const ANNOUNCE_BUSY_AFTER_MS = 700;
/** Firebase reset links work once and expire after an hour; the demo link after 30 minutes. */
const RESET_LINK_MINUTES = REAL ? 60 : 30;
const ROLE_EMOJI: Record<DemoRole, string> = { customer: '🙋', shop: '🏪', workshop: '🔧', admin: '🛡️' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RECAPTCHA_ID = 'login-recaptcha';
const TURNSTILE_ID = 'login-turnstile';

const primary =
  'press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover aria-disabled:cursor-wait aria-disabled:opacity-70';
const linkButton =
  'inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline aria-disabled:cursor-default aria-disabled:no-underline aria-disabled:text-muted';

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};
const ids = (...list: (string | null | undefined | false)[]) => list.filter(Boolean).join(' ') || undefined;

/** `''` = an error about the whole form (network, limits, bot check), not one field. */
interface FormError {
  message: string;
  field: string;
  seq: number;
}
/** What a busy action ended with: `leaving` keeps the button busy through the navigation. */
type Outcome = 'leaving' | undefined;

/**
 * Two always-mounted screen-reader regions (polite status, assertive alert). Text is cleared and set again after
 * a tick so a repeated message is read again. Used only when focus does not move — when it moves, the newly
 * focused field's description carries the message (one channel per event, a11y review 2026-11-09).
 */
function useAnnouncer() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const timers = useRef<{ polite?: number; assertive?: number }>({});
  const announce = useCallback((message: string, kind: 'polite' | 'assertive' = 'polite') => {
    const set = kind === 'polite' ? setPolite : setAssertive;
    window.clearTimeout(timers.current[kind]);
    set('');
    timers.current[kind] = window.setTimeout(() => {
      set(message);
    }, 100);
  }, []);
  const regions = (
    <>
      <div role="status" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div role="alert" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </>
  );
  return { announce, regions };
}

/**
 * Sign-in (spec 01, decision 2026-11-01), in demo or real (Firebase) mode — same screens:
 * - returning users: phone number or email + password (staff also enter a code sent to their phone);
 * - new users: phone → one-time code → name, email, password, confirm password (real: then "verify your email");
 * - forgot password: a code to the phone, or a reset link by email — whichever the person prefers.
 * Accessibility (review 2026-11-09, `.a11y-history/2026-11-09-login-firebase`): one primary action per step;
 * errors next to their field (form-level ones above the button); focus moves after render; busy buttons stay
 * focusable (`aria-disabled`); field-less steps focus their heading; nothing ticks in a live region.
 */
export function LoginFlow() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  // Already signed in: say so, with the way back; the form stays for switching accounts (QA 2026-11-14, F4).
  const current = useSession();
  const prefix = locale === 'hi' ? '/hi' : '';
  const { announce, regions } = useAnnouncer();
  const [view, setView] = useState<{ step: Step; n: number }>({ step: 'signin', n: 0 });
  const step = view.step;
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const busyTimer = useRef<number | undefined>(undefined);
  const [staff, setStaff] = useState<DemoAccount | null>(null);
  /** Real mode, staff: the phone the API named, and the password for the second call (memory only). */
  const [staffPhone, setStaffPhone] = useState('');
  const pendingPassword = useRef('');
  const [created, setCreated] = useState<{ account: DemoAccount; email: string } | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // Every step change — including to the same step — moves focus into the new content (counter, not step).
  useEffect(() => {
    const el =
      root.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      root.current?.querySelector<HTMLElement>('input, button');
    el?.focus();
  }, [view.n]);

  // Errors: focus the field after its aria-invalid/description are rendered; if it already has focus (Enter in
  // the field) or the error is about the whole form, say it through the alert region instead.
  useEffect(() => {
    if (!error) return;
    const el = error.field ? document.getElementById(error.field) : null;
    if (el && el !== document.activeElement) el.focus();
    else announce(error.message, 'assertive');
  }, [error, announce]);

  useEffect(
    () => () => {
      window.clearTimeout(busyTimer.current);
    },
    [],
  );

  function goTo(s: Step, keepNotice = false) {
    setError(null);
    setCodeExpired(false);
    if (!keepNotice) setNotice(null);
    setView((v) => ({ step: s, n: v.n + 1 }));
  }

  function fail(message: string, field: string) {
    seq.current += 1;
    setError({ message, field, seq: seq.current });
  }
  const failForm = (message: string) => {
    fail(message, '');
  };

  /** Runs one busy action: ignores repeats (Enter twice), announces slow work, never leaves the form stuck. */
  async function guarded(busyLabel: string, task: () => Promise<Outcome>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    busyTimer.current = window.setTimeout(() => {
      announce(busyLabel);
    }, ANNOUNCE_BUSY_AFTER_MS);
    let outcome: Outcome;
    try {
      outcome = await task();
    } catch {
      failForm(t('errUnavailable'));
    }
    window.clearTimeout(busyTimer.current);
    if (outcome !== 'leaving') {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function done(account: DemoAccount, event: string): Outcome {
    track('click', { id: event, path: window.location.pathname });
    router.push(next ?? `${prefix}${homeFor(account.role)}`);
    return 'leaving';
  }

  /** Real mode: load the profile from the API, mirror it for the browser-data screens, go home. */
  async function finishReal(event: (role: DemoRole) => string): Promise<Outcome> {
    const r = await real();
    const me = await r.fetchMe();
    if (me === 'blocked') {
      await r.signOutReal();
      failForm(t('blocked'));
      return undefined;
    }
    if (!me) {
      failForm(t('errUnavailable'));
      return undefined;
    }
    // Real mode: fold the guest cart into the saved one. Started before the session flips so the header's sync waits for it.
    void import('@/lib/cart-sync').then((m) => m.mergeAtSignIn(locale === 'hi' ? 'hi' : 'en'));
    const account = adoptRealAccount(me);
    return done(account, event(account.role));
  }

  /** A fresh Turnstile token for the API; a visible challenge is labelled and announced. */
  async function botCheck(): Promise<string | null> {
    try {
      const { turnstileToken } = await turnstile();
      return await turnstileToken(TURNSTILE_ID, locale, (shown) => {
        setChallenge(shown);
        if (shown) {
          announce(t('securityCheckLead'));
          track('click', { id: 'login_bot_check_shown', path: window.location.pathname });
        }
      });
    } catch {
      failForm(t('errBotCheck'));
      return null;
    }
  }

  function phoneFail(reason: 'phone' | 'rate' | 'captcha' | 'unavailable') {
    if (reason === 'phone') fail(t('errPhone'), 'login-phone');
    else if (reason === 'rate') failForm(t('errTooManyCodes'));
    else if (reason === 'captcha') {
      track('click', { id: 'login_captcha_failed', path: window.location.pathname });
      failForm(t('errBotCheck'));
    } else failForm(t('errUnavailable'));
  }

  function codeFail(reason: 'otp' | 'expired' | 'rate' | 'unavailable') {
    if (reason === 'otp') fail(t('errOtp'), 'login-otp');
    else if (reason === 'expired') {
      track('click', { id: 'login_code_expired', path: window.location.pathname });
      setCodeExpired(true);
      fail(t('errOtpExpired'), 'login-otp');
    } else if (reason === 'rate') failForm(t('errTooManyCodes'));
    else failForm(t('errUnavailable'));
  }

  /** New-password rules shared by sign-up and both reset routes. Returns false (and shows why) when invalid. */
  function checkNewPassword(
    password: string,
    confirm: string,
    context: { phone?: string; email?: string; name?: string },
  ): boolean {
    const problem = passwordProblem(password, context);
    if (problem) {
      fail(t(`errPassword_${problem}`, { min: PASSWORD_MIN, max: PASSWORD_MAX }), 'login-new-password');
      return false;
    }
    if (password !== confirm) {
      fail(t('errConfirm'), 'login-confirm-password');
      return false;
    }
    return true;
  }

  const errorFor = (field: string) => (error?.field === field ? error.message : null);
  const errorId = (field: string) => (error?.field === field ? `${field}-error` : undefined);
  const fieldError = (field: string) =>
    error?.field === field ? (
      <p id={`${field}-error`} className="mt-1 text-sm font-bold text-error">
        {error.message}
      </p>
    ) : null;
  const formErrorShown = error?.field === '';
  const formError = formErrorShown ? (
    <p id="login-form-error" className="mt-4 text-sm font-bold text-error">
      {error.message}
    </p>
  ) : null;

  const submit = (label: string, busyLabel: string) => (
    <button
      type="submit"
      aria-disabled={busy || undefined}
      aria-describedby={formErrorShown ? 'login-form-error' : undefined}
      className={`${primary} mt-5`}
    >
      {busy ? busyLabel : label}
    </button>
  );

  /** Where Cloudflare shows a challenge when it must ask: right before the button, labelled while shown. */
  const securityCheck = REAL ? (
    <div role="group" aria-labelledby={challenge ? 'login-turnstile-label' : undefined} className="mt-4">
      <p id="login-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
        {t('securityCheck')}
      </p>
      <div id={TURNSTILE_ID} />
    </div>
  ) : null;

  /** Lets password managers save the new password under the right account (hidden from people and AT). */
  const usernameFor = (value: string) => (
    <input type="text" name="username" autoComplete="username" value={value} readOnly hidden />
  );

  const back = (
    <p className="mt-5 text-center text-sm">
      <button
        type="button"
        onClick={() => {
          goTo('signin');
        }}
        className={linkButton}
      >
        {t('backToSignIn')}
      </button>
    </p>
  );

  const newPasswordFields = (
    <>
      <PasswordField
        id="login-new-password"
        name="password"
        label={t('newPassword')}
        autoComplete="new-password"
        hint={t('passwordHint', { min: PASSWORD_MIN })}
        error={errorFor('login-new-password')}
      />
      <PasswordField
        id="login-confirm-password"
        name="confirm"
        label={t('confirmPassword')}
        autoComplete="new-password"
        error={errorFor('login-confirm-password')}
      />
    </>
  );

  // ── Returning users ───────────────────────────────────────────────────────────────────────────────────────

  async function onSignIn(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const data = new FormData(e.currentTarget);
    const password = text(data, 'password');
    if (!identifier.trim()) {
      fail(t('errIdentifier'), 'login-identifier');
      return;
    }
    if (!password) {
      fail(t('errPasswordEmpty'), 'login-password');
      return;
    }
    await guarded(t('verifying'), async () => (REAL ? signInReal(password) : signInDemo(password)));
  }

  async function signInDemo(password: string): Promise<Outcome> {
    const result = await signInWithPassword(identifier, password);
    if (!result.ok) {
      track('click', { id: 'login_password_failed', path: window.location.pathname });
      if (result.reason === 'locked') {
        const minutes = Math.max(1, Math.ceil((result.until - Date.now()) / 60_000));
        failForm(t('locked', { minutes }));
      } else if (result.reason === 'blocked') {
        failForm(t('blocked'));
      } else {
        fail(t('errSignIn'), 'login-password');
      }
      return undefined;
    }
    if (result.needsOtp) {
      setStaff(result.account);
      goTo('staff');
      return undefined;
    }
    return done(result.account, `login_${result.account.role}`);
  }

  /**
   * Password sign-in through the API (custom token). Also used right after a password is set (sign-up, phone
   * reset): Firebase then marks the session as a `password` sign-in, which the API refuses by design (no way
   * around its limits), so the browser signs in again the API's way.
   */
  async function signInReal(
    password: string,
    who: string = identifier,
    event: (role: DemoRole) => string = (role) => `login_${role}`,
  ): Promise<Outcome> {
    const token = await botCheck();
    if (!token) return undefined;
    const r = await real();
    const res = await r.passwordSignIn({ identifier: who, password, turnstileToken: token, locale });
    if (!res.ok) {
      track('click', { id: 'login_password_failed', path: window.location.pathname });
      if (res.reason === 'invalid') fail(t('errSignIn'), 'login-password');
      else if (res.reason === 'locked')
        failForm(t('locked', { minutes: Math.max(1, Math.ceil((res.retryAfterSeconds ?? 900) / 60)) }));
      else if (res.reason === 'turnstile') failForm(t('errBotCheck'));
      else failForm(t('errUnavailable'));
      return undefined;
    }
    if (res.status === 'staff_code') {
      const sent = await r.sendPhoneCode(res.phone, locale, RECAPTCHA_ID);
      if (!sent.ok) {
        phoneFail(sent.reason === 'phone' ? 'unavailable' : sent.reason);
        return undefined;
      }
      pendingPassword.current = password;
      setIdentifier(who);
      setStaffPhone(res.phone);
      goTo('staff');
      return undefined;
    }
    return finishReal(event);
  }

  async function onStaffCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const otp = text(new FormData(e.currentTarget), 'otp');
    if (!/^\d{6}$/.test(otp)) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    if (!REAL) {
      if (!staff || !completeStaffSignIn(staff.id, otp)) {
        fail(t('errOtp'), 'login-otp');
        return;
      }
      await guarded(t('verifying'), () => Promise.resolve(done(staff, `login_${staff.role}`)));
      return;
    }
    await guarded(t('verifying'), async () => {
      const r = await real();
      const confirmed = await r.confirmPhoneCode(otp);
      if (!confirmed.ok) {
        codeFail(confirmed.reason);
        return undefined;
      }
      const token = await botCheck();
      if (!token) return undefined;
      const res = await r.passwordSignIn({
        identifier,
        password: pendingPassword.current,
        turnstileToken: token,
        locale,
        phoneToken: true,
      });
      if (!res.ok || res.status !== 'signed_in') {
        if (!res.ok && res.reason === 'staff_expired') codeFail('expired');
        else if (!res.ok && res.reason === 'staff_mismatch') failForm(t('errStaffOtherAccount'));
        else if (!res.ok && res.reason === 'turnstile') failForm(t('errBotCheck'));
        else failForm(t('errUnavailable'));
        return undefined;
      }
      pendingPassword.current = '';
      return finishReal((role) => `login_${role}`);
    });
  }

  /** Resend the code of the current step (demo: nothing to send). */
  async function resendCode(): Promise<boolean> {
    if (!REAL) return true;
    const r = await real();
    const target = step === 'staff' ? staffPhone : `+91${phone}`;
    const sent = await r.sendPhoneCode(target, locale, RECAPTCHA_ID);
    if (!sent.ok) {
      phoneFail(sent.reason === 'phone' ? 'unavailable' : sent.reason);
      return false;
    }
    setCodeExpired(false);
    setError(null);
    return true;
  }

  // ── New users ─────────────────────────────────────────────────────────────────────────────────────────────

  function onPhone(target: Step) {
    return async (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busyRef.current) return;
      const normalised = normalisePhone(phone);
      if (!normalised) {
        fail(t('errPhone'), 'login-phone');
        return;
      }
      setPhone(normalised);
      await guarded(t('sendingCode'), async () => {
        if (REAL) {
          const r = await real();
          const sent = await r.sendPhoneCode(`+91${normalised}`, locale, RECAPTCHA_ID);
          if (!sent.ok) {
            phoneFail(sent.reason);
            return undefined;
          }
        }
        track('click', {
          id: target === 'signup-otp' ? 'signup_otp_sent' : 'reset_otp_sent',
          path: window.location.pathname,
        });
        goTo(target);
        return undefined;
      });
    };
  }

  /** The code proved the number is theirs, so it is safe to say an account exists. */
  function phoneHasAccount() {
    setIdentifier(phone);
    setNotice(t('phoneInUse'));
    goTo('signin', true);
  }

  async function onSignUpCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const otp = text(new FormData(e.currentTarget), 'otp');
    if (!REAL) {
      const result = verifyPhoneOtp(phone, otp);
      if (!result.ok) fail(t('errOtp'), 'login-otp');
      else if (result.exists) phoneHasAccount();
      else goTo('signup-profile');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    await guarded(t('verifying'), async () => {
      const r = await real();
      const confirmed = await r.confirmPhoneCode(otp);
      if (!confirmed.ok) {
        codeFail(confirmed.reason);
        return undefined;
      }
      if (confirmed.hasPassword) {
        await r.signOutReal();
        phoneHasAccount();
      } else goTo('signup-profile');
      return undefined;
    });
  }

  async function onProfile(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const data = new FormData(e.currentTarget);
    const name = text(data, 'name').trim();
    const email = text(data, 'email').trim();
    if (name.length < 2) {
      fail(t('errName'), 'login-name');
      return;
    }
    if (!EMAIL.test(email)) {
      fail(t('errEmail'), 'login-email');
      return;
    }
    const password = text(data, 'password');
    if (!checkNewPassword(password, text(data, 'confirm'), { phone, email, name })) return;
    const language = locale === 'hi' ? 'hi' : 'en';
    await guarded(t('verifying'), async () => {
      if (!REAL) {
        const result = await signUp({ phone, name, email, password, language });
        if (!result.ok) {
          if (result.reason === 'email_in_use') fail(t('emailInUse'), 'login-email');
          else phoneHasAccount();
          return undefined;
        }
        return done(result.account, 'sign_up');
      }
      const r = await real();
      // Create the profile with the phone session first (the API makes it on the first call; a blocked number
      // stops here), so the API sign-in below finds the account by its phone.
      const first = await r.fetchMe();
      if (!first || first === 'blocked') {
        failForm(first === 'blocked' ? t('blocked') : t('errUnavailable'));
        return undefined;
      }
      const linked = await r.linkEmailPassword(email, password);
      if (!linked.ok) {
        if (linked.reason === 'email_in_use') fail(t('emailInUse'), 'login-email');
        else failForm(t('errUnavailable'));
        return undefined;
      }
      // Linking turned the session into a `password` sign-in, which the API refuses: sign in the API's way.
      const token = await botCheck();
      if (!token) return undefined;
      const session = await r.passwordSignIn({
        identifier: `+91${phone}`,
        password,
        turnstileToken: token,
        locale,
      });
      if (!session.ok || session.status !== 'signed_in') {
        failForm(t('errUnavailable'));
        return undefined;
      }
      const me = await r.fetchMe();
      if (!me || me === 'blocked') {
        failForm(me === 'blocked' ? t('blocked') : t('errUnavailable'));
        return undefined;
      }
      const saved = (await r.saveProfile(me, { name, language })) ?? me;
      void import('@/lib/cart-sync').then((m) => m.mergeAtSignIn(locale === 'hi' ? 'hi' : 'en'));
      setCreated({ account: adoptRealAccount({ ...saved, name }), email });
      track('click', { id: 'sign_up', path: window.location.pathname });
      goTo('signup-done');
      return undefined;
    });
  }

  // ── Forgot password ───────────────────────────────────────────────────────────────────────────────────────

  async function onResetWithCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const data = new FormData(e.currentTarget);
    const otp = text(data, 'otp');
    if (!/^\d{6}$/.test(otp)) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    const password = text(data, 'password');
    if (!checkNewPassword(password, text(data, 'confirm'), { phone })) return;
    await guarded(t('verifying'), async () => {
      if (!REAL) {
        const result = await resetPasswordWithOtp(phone, otp, password);
        if (!result.ok) {
          if (result.reason === 'otp') fail(t('errOtp'), 'login-otp');
          else failForm(t('noAccount'));
          return undefined;
        }
        return done(result.account, 'password_reset_phone');
      }
      const r = await real();
      const confirmed = await r.confirmPhoneCode(otp);
      if (!confirmed.ok) {
        codeFail(confirmed.reason);
        return undefined;
      }
      if (!confirmed.hasPassword) {
        await r.signOutReal();
        failForm(t('noAccount'));
        return undefined;
      }
      if (!(await r.setNewPassword(password))) {
        failForm(t('errUnavailable'));
        return undefined;
      }
      // The new password made this a `password` session, which the API refuses: sign in the API's way.
      return signInReal(password, `+91${phone}`, () => 'password_reset_phone');
    });
  }

  async function onResetEmail(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current) return;
    const email = text(new FormData(e.currentTarget), 'email').trim();
    if (!EMAIL.test(email)) {
      fail(t('errEmail'), 'login-reset-email');
      return;
    }
    await guarded(t('sendingLink'), async () => {
      setResetEmail(email);
      if (REAL) await (await real()).sendResetEmail(email, locale);
      else setResetToken(requestEmailReset(email));
      track('click', { id: 'password_reset_email', path: window.location.pathname });
      goTo('forgot-email-sent');
      return undefined;
    });
  }

  async function onResetWithLink(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busyRef.current || !linkToken) return;
    const data = new FormData(e.currentTarget);
    const password = text(data, 'password');
    if (!checkNewPassword(password, text(data, 'confirm'), { email: resetEmail })) return;
    await guarded(t('verifying'), async () => {
      const result = await resetPasswordWithLink(linkToken, password);
      if (!result.ok) {
        setLinkToken(null);
        goTo('reset-link');
        return undefined;
      }
      track('click', { id: 'password_reset_link', path: window.location.pathname });
      setIdentifier(result.account.email);
      setNotice(t('resetDone'));
      goTo('signin', true);
      return undefined;
    });
  }

  // ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────

  const phoneForm = (target: Step, title: string, lead: string) => (
    <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onPhone(target)(e)}>
      <StepTitle title={title} lead={lead} />
      <label htmlFor="login-phone" className="mt-5 block text-sm font-bold text-ink">
        {t('phone')}
      </label>
      <div className="mt-1 flex items-stretch gap-2">
        <span className="inline-flex min-h-12 items-center rounded-input border border-input-border bg-surface-alt px-3 text-[16px] font-bold text-ink">
          +91
        </span>
        <input
          data-autofocus
          id="login-phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={14}
          required
          value={phone}
          aria-invalid={errorFor('login-phone') ? true : undefined}
          aria-describedby={ids(errorId('login-phone'), 'login-phone-hint')}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
          className={`${authInput} mt-0`}
        />
      </div>
      {fieldError('login-phone')}
      <p id="login-phone-hint" className="mt-1 text-xs text-muted">
        {t('phoneHint')}
      </p>
      {formError}
      {submit(t('sendOtp'), t('sendingCode'))}
      {back}
    </form>
  );

  const codeField = (describedBy?: string) => (
    <CodeField
      error={errorFor('login-otp')}
      describedBy={describedBy}
      cooldownOver={codeExpired}
      onResend={resendCode}
      announce={announce}
    />
  );

  const codeSentTo = (title: string) => (
    <>
      <h2 id="login-step-title" className="font-heading text-xl font-extrabold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">
        <span id="login-otp-sent">{t('otpSent', { phone })}</span>{' '}
        <button
          type="button"
          onClick={() => {
            goTo(step === 'forgot-otp' ? 'forgot-phone' : 'signup-phone');
          }}
          className="inline-flex min-h-6 font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('changeNumber')}
        </button>
      </p>
    </>
  );

  let body: ReactNode = null;
  switch (step) {
    case 'signin':
      body = (
        <form noValidate onSubmit={(e) => void onSignIn(e)}>
          {current && !notice ? (
            <p className="mb-4 rounded-lg bg-pill p-3 text-sm text-ink">
              {t('alreadySignedIn', { name: current.name })}{' '}
              <Link
                href={`${prefix}${homeFor(current.role)}`}
                data-track="login_go_account"
                className="font-bold text-accent-soft-text underline underline-offset-2"
              >
                {t('goToAccount')}
              </Link>
            </p>
          ) : null}
          {notice ? (
            <p id="login-notice" className="mb-4 rounded-lg bg-success-bg p-3 text-sm font-bold text-success">
              {notice}
            </p>
          ) : null}
          <label htmlFor="login-identifier" className="block text-sm font-bold text-ink">
            {t('identifier')}
          </label>
          <input
            data-autofocus
            id="login-identifier"
            name="identifier"
            autoComplete="username"
            inputMode="text"
            maxLength={200}
            required
            value={identifier}
            aria-invalid={errorFor('login-identifier') ? true : undefined}
            aria-describedby={ids(
              notice && 'login-notice',
              errorId('login-identifier'),
              'login-identifier-hint',
            )}
            onChange={(e) => {
              setIdentifier(e.target.value);
            }}
            className={authInput}
          />
          {fieldError('login-identifier')}
          <p id="login-identifier-hint" className="mt-1 text-xs text-muted">
            {t('identifierHint')}
          </p>
          <PasswordField
            id="login-password"
            name="password"
            label={t('password')}
            autoComplete="current-password"
            error={errorFor('login-password')}
            inputRef={passwordRef}
          />
          <p className="mt-1 text-right text-sm">
            <button
              type="button"
              onClick={() => {
                goTo('forgot');
              }}
              className={linkButton}
            >
              {t('forgot')}
            </button>
          </p>
          {securityCheck}
          {formError}
          {submit(t('signInButton'), t('verifying'))}
          <p className="mt-5 text-center text-sm text-muted">
            {t('newHere')}{' '}
            <button
              type="button"
              onClick={() => {
                goTo('signup-phone');
              }}
              className={linkButton}
            >
              {t('createAccount')}
            </button>
          </p>
          <p className="mt-2 text-center text-xs text-muted">{t('terms')}</p>

          {REAL ? null : (
            <section
              aria-labelledby="demo-logins"
              className="mt-8 rounded-tile border border-dashed border-line p-4"
            >
              <h2 id="demo-logins" className="text-sm font-extrabold text-ink">
                {t('demoAccounts')}
              </h2>
              <p className="mt-1 text-xs text-muted">
                {t('demoAccountsLead', { password: DEMO_PASSWORD, otp: DEMO_OTP })}
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {SEEDED_ACCOUNTS.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setIdentifier(a.phone);
                        if (passwordRef.current) passwordRef.current.value = DEMO_PASSWORD;
                        setError(null);
                        passwordRef.current?.focus();
                      }}
                      className="press flex min-h-14 w-full items-center gap-2 rounded-button border border-line-card bg-surface px-3 text-left hover:bg-pill"
                    >
                      <span aria-hidden="true" className="text-[20px] leading-none">
                        {ROLE_EMOJI[a.role]}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-ink">{t(`role_${a.role}`)}</span>
                        <span data-user-content className="block truncate text-xs text-muted">
                          {a.name}
                        </span>
                        <span className="block text-xs text-muted tabular-nums">{a.phone}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </form>
      );
      break;

    case 'staff': {
      const shown = REAL ? staffPhone.replace(/^\+91/, '') : (staff?.phone ?? '');
      body = (
        <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onStaffCode(e)}>
          <StepTitle title={t('staffTitle')} lead={t('staffLead', { phone: shown })} />
          {codeField('login-step-lead')}
          {securityCheck}
          {formError}
          {submit(t('verify'), t('verifying'))}
          {back}
        </form>
      );
      break;
    }

    case 'signup-phone':
      body = phoneForm('signup-otp', t('signupTitle'), t('signupLead'));
      break;

    case 'signup-otp':
      body = (
        <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onSignUpCode(e)}>
          {codeSentTo(t('otpTitle'))}
          {codeField('login-otp-sent')}
          {formError}
          {submit(t('verify'), t('verifying'))}
        </form>
      );
      break;

    case 'signup-profile':
      body = (
        <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onProfile(e)}>
          <StepTitle title={t('profileTitle')} lead={t('profileLead')} />
          {usernameFor(phone)}
          <label htmlFor="login-name" className="mt-5 block text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            data-autofocus
            id="login-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            required
            aria-invalid={errorFor('login-name') ? true : undefined}
            aria-describedby={errorId('login-name')}
            className={authInput}
          />
          {fieldError('login-name')}
          <label htmlFor="login-email" className="mt-4 block text-sm font-bold text-ink">
            {t('email')}
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
            aria-invalid={errorFor('login-email') ? true : undefined}
            aria-describedby={errorId('login-email')}
            className={authInput}
          />
          {fieldError('login-email')}
          {newPasswordFields}
          {securityCheck}
          {formError}
          {submit(t('create'), t('verifying'))}
        </form>
      );
      break;

    case 'signup-done':
      body = (
        <div>
          <StepTitle
            focusHeading
            title={t('accountCreated')}
            lead={t('verifyEmailSent', { email: created?.email ?? '' })}
          />
          <button
            type="button"
            onClick={() => {
              if (created)
                void guarded(t('verifying'), () => Promise.resolve(done(created.account, 'sign_up_done')));
            }}
            aria-disabled={busy || undefined}
            className={`${primary} mt-5`}
          >
            {t('continue')}
          </button>
        </div>
      );
      break;

    case 'forgot':
      body = (
        <div>
          <StepTitle title={t('forgotTitle')} lead={t('forgotLead')} />
          <ul className="mt-5 space-y-3">
            {(
              [
                ['forgot-phone', '📱', t('forgotByPhone'), t('forgotByPhoneHint')],
                [
                  'forgot-email',
                  '✉️',
                  t('forgotByEmail'),
                  t('forgotByEmailHint', { minutes: RESET_LINK_MINUTES }),
                ],
              ] as const
            ).map(([target, emoji, label, hint], i) => (
              <li key={target}>
                <button
                  type="button"
                  data-autofocus={i === 0 ? true : undefined}
                  onClick={() => {
                    // Carry over what was already typed as the sign-in identifier (WCAG 3.3.7).
                    if (target === 'forgot-phone' && !phone) setPhone(normalisePhone(identifier) ?? '');
                    goTo(target);
                  }}
                  className="press flex min-h-16 w-full items-center gap-3 rounded-tile border border-line-card bg-surface px-4 py-3 text-left hover:bg-pill"
                >
                  <span aria-hidden="true" className="text-[24px] leading-none">
                    {emoji}
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-ink">{label}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {back}
        </div>
      );
      break;

    case 'forgot-phone':
      body = phoneForm('forgot-otp', t('resetPhoneTitle'), t('resetPhoneLead'));
      break;

    case 'forgot-otp':
      body = (
        <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onResetWithCode(e)}>
          {codeSentTo(t('resetOtpTitle'))}
          {usernameFor(phone)}
          {codeField('login-otp-sent')}
          {newPasswordFields}
          {securityCheck}
          {formError}
          {submit(t('savePassword'), t('verifying'))}
          {back}
        </form>
      );
      break;

    case 'forgot-email':
      body = (
        <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onResetEmail(e)}>
          <StepTitle title={t('resetEmailTitle')} lead={t('resetEmailLead')} />
          <label htmlFor="login-reset-email" className="mt-5 block text-sm font-bold text-ink">
            {t('email')}
          </label>
          <input
            data-autofocus
            id="login-reset-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
            required
            defaultValue={resetEmail || (EMAIL.test(identifier.trim()) ? identifier.trim() : '')}
            aria-invalid={errorFor('login-reset-email') ? true : undefined}
            aria-describedby={errorId('login-reset-email')}
            className={authInput}
          />
          {fieldError('login-reset-email')}
          {formError}
          {submit(t('sendLink'), t('sendingLink'))}
          {back}
        </form>
      );
      break;

    case 'forgot-email-sent':
      body = (
        <div>
          <StepTitle
            focusHeading
            title={t('emailSentTitle')}
            lead={t('emailSent', { email: resetEmail, minutes: RESET_LINK_MINUTES })}
          />
          {REAL ? null : (
            <div className="mt-5 rounded-tile border border-dashed border-line p-4 text-sm">
              {resetToken ? (
                <>
                  <p className="text-xs text-muted">{t('demoInboxNote')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkToken(resetToken);
                      goTo('reset-link');
                    }}
                    className={`${linkButton} mt-1`}
                  >
                    {t('demoInbox')}
                  </button>
                </>
              ) : (
                <p className="text-xs text-muted">{t('demoNoEmail')}</p>
              )}
            </div>
          )}
          {back}
        </div>
      );
      break;

    case 'reset-link':
      body =
        linkToken && resetLinkValid(linkToken) ? (
          <form noValidate aria-labelledby="login-step-title" onSubmit={(e) => void onResetWithLink(e)}>
            <StepTitle title={t('resetLinkTitle')} lead={t('resetLinkLead', { email: resetEmail })} />
            {usernameFor(resetEmail)}
            {newPasswordFields}
            {formError}
            {submit(t('savePassword'), t('verifying'))}
          </form>
        ) : (
          <div>
            <StepTitle focusHeading title={t('resetLinkTitle')} lead={t('resetLinkExpired')} />
            <button
              type="button"
              onClick={() => {
                goTo('forgot-email');
              }}
              className={`${primary} mt-5`}
            >
              {t('newLink')}
            </button>
            {back}
          </div>
        );
      break;
  }

  return (
    <div ref={root}>
      {body}
      {/* Stable across steps, so a step change never unmounts the reCAPTCHA badge (inline, not fixed). */}
      {REAL ? <div id={RECAPTCHA_ID} className="mt-6" /> : null}
      {regions}
    </div>
  );
}

/**
 * Step heading and lead. `focusHeading`: the step has no field, so its heading takes focus and the lead is read
 * with it (a11y review 2026-11-09: otherwise "Back to sign in" took focus and the message was never heard).
 */
function StepTitle({ title, lead, focusHeading }: { title: string; lead: string; focusHeading?: boolean }) {
  return (
    <>
      <h2
        id="login-step-title"
        tabIndex={focusHeading ? -1 : undefined}
        data-autofocus={focusHeading ? true : undefined}
        aria-describedby={focusHeading ? 'login-step-lead' : undefined}
        className="font-heading text-xl font-extrabold text-ink"
      >
        {title}
      </h2>
      <p id="login-step-lead" className="mt-1 text-sm text-muted">
        {lead}
      </p>
    </>
  );
}

/**
 * 6-digit code with a 30-second resend timer (modern-web-guidance sms-otp-form pattern). The resend button is
 * always there (disabled by `aria-disabled` while counting down) so focus never drops; the countdown is plain
 * text, not a live region; a pasted SMS or "123 456" is reduced to its 6 digits (WCAG 3.3.8). `cooldownOver`:
 * the code expired, so a new one may be asked for at once.
 */
function CodeField({
  error,
  describedBy,
  cooldownOver,
  onResend,
  announce,
}: {
  error: string | null;
  describedBy?: string;
  cooldownOver: boolean;
  onResend: () => Promise<boolean>;
  announce: (message: string) => void;
}) {
  const t = useTranslations('auth');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (now >= resendAt) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [now, resendAt]);

  const waitSeconds = cooldownOver ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const waiting = waitSeconds > 0 || sending;
  return (
    <>
      <label htmlFor="login-otp" className="mt-5 block text-sm font-bold text-ink">
        {t('otpLabel')}
      </label>
      <input
        data-autofocus
        id="login-otp"
        name="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        required
        value={code}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids(error && 'login-otp-error', describedBy, 'login-otp-hint')}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
        }}
        onPaste={(e) => {
          const six = /\d{6}/.exec(e.clipboardData.getData('text').replace(/[\s-]/g, ''));
          if (six) {
            e.preventDefault();
            setCode(six[0]);
          }
        }}
        className={`${authInput} text-center font-heading text-2xl font-extrabold tracking-[0.5em] tabular-nums`}
      />
      {error ? (
        <p id="login-otp-error" className="mt-1 text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <p id="login-otp-hint" className="mt-1 text-xs text-muted">
        {REAL ? t('otpHint') : t('demoHint', { otp: DEMO_OTP })}
      </p>
      <p className="mt-2 text-center text-sm">
        <button
          type="button"
          aria-disabled={waiting || undefined}
          onClick={() => {
            if (waiting) return;
            setSending(true);
            void onResend().then((ok) => {
              setSending(false);
              if (!ok) return;
              const at = Date.now();
              setNow(at);
              setResendAt(at + RESEND_SECONDS * 1000);
              announce(t('resent'));
              document.getElementById('login-otp')?.focus();
            });
          }}
          className={linkButton}
        >
          {waitSeconds > 0 ? t('resendIn', { seconds: waitSeconds }) : t('resend')}
        </button>
      </p>
    </>
  );
}
