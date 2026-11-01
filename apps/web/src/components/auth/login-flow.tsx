'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '@/demo/passwords';
import {
  DEMO_OTP,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
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
  verifyPhoneOtp,
  type DemoAccount,
  type DemoRole,
} from '@/demo/session';
import { track } from '@/lib/analytics';
import { PasswordField, authInput } from './password-field';

type Step =
  | 'signin'
  | 'staff'
  | 'signup-phone'
  | 'signup-otp'
  | 'signup-profile'
  | 'forgot'
  | 'forgot-phone'
  | 'forgot-otp'
  | 'forgot-email'
  | 'forgot-email-sent'
  | 'reset-link';

const RESEND_SECONDS = 30;
const ROLE_EMOJI: Record<DemoRole, string> = { customer: '🙋', shop: '🏪', workshop: '🔧', admin: '🛡️' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const primary =
  'press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70';
const linkButton =
  'inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline';

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};

/**
 * Sign-in (spec 01, decision 2026-11-01) in demo mode:
 * - returning users: phone number or email + password (staff also enter a code sent to their phone);
 * - new users: phone → one-time code → name, email, password, confirm password;
 * - forgot password: a code to the phone, or a reset link by email — whichever the person prefers.
 * One primary action per step, errors next to the field, focus moves to each step's first field.
 */
export function LoginFlow() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const prefix = locale === 'hi' ? '/hi' : '';
  const [step, setStep] = useState<Step>('signin');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<DemoAccount | null>(null);
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el =
      root.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      root.current?.querySelector<HTMLElement>('input, button');
    el?.focus();
  }, [step]);

  function goTo(s: Step, keepNotice = false) {
    setError(null);
    if (!keepNotice) setNotice(null);
    setStep(s);
  }

  function fail(message: string, field: string) {
    setError({ message, field });
    document.getElementById(field)?.focus();
  }

  function done(account: DemoAccount, event: string) {
    track('click', { id: event, path: window.location.pathname });
    router.push(next ?? `${prefix}${homeFor(account.role)}`);
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

  const errorText = error ? (
    <p id="login-error" role="alert" className="mt-2 text-sm font-bold text-error">
      {error.message}
    </p>
  ) : null;
  const invalid = (field: string) => error?.field === field;
  const describedBy = (field: string) => (error?.field === field ? 'login-error' : undefined);

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
        invalid={invalid('login-new-password')}
        describedBy={describedBy('login-new-password')}
      />
      <PasswordField
        id="login-confirm-password"
        name="confirm"
        label={t('confirmPassword')}
        autoComplete="new-password"
        invalid={invalid('login-confirm-password')}
        describedBy={describedBy('login-confirm-password')}
      />
    </>
  );

  // ── Returning users ───────────────────────────────────────────────────────────────────────────────────────

  async function onSignIn(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
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
    setBusy(true);
    const result = await signInWithPassword(identifier, password);
    setBusy(false);
    if (!result.ok) {
      track('click', { id: 'login_password_failed', path: window.location.pathname });
      if (result.reason === 'locked') {
        const minutes = Math.max(1, Math.ceil((result.until - Date.now()) / 60_000));
        fail(t('locked', { minutes }), 'login-password');
      } else {
        fail(t('errSignIn'), 'login-password');
      }
      return;
    }
    if (result.needsOtp) {
      setStaff(result.account);
      goTo('staff');
      return;
    }
    done(result.account, `login_${result.account.role}`);
  }

  function onStaffCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!staff) return;
    if (!completeStaffSignIn(staff.id, text(new FormData(e.currentTarget), 'otp'))) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    done(staff, `login_${staff.role}`);
  }

  // ── New users ─────────────────────────────────────────────────────────────────────────────────────────────

  function onPhone(target: Step) {
    return (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      const normalised = normalisePhone(phone);
      if (!normalised) {
        fail(t('errPhone'), 'login-phone');
        return;
      }
      setPhone(normalised);
      track('click', {
        id: target === 'signup-otp' ? 'signup_otp_sent' : 'reset_otp_sent',
        path: window.location.pathname,
      });
      goTo(target);
    };
  }

  function onSignUpCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = verifyPhoneOtp(phone, text(new FormData(e.currentTarget), 'otp'));
    if (!result.ok) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    if (result.exists) {
      // The code proved the number is theirs, so it is safe to say an account exists.
      setIdentifier(phone);
      setNotice(t('phoneInUse'));
      goTo('signin', true);
      return;
    }
    goTo('signup-profile');
  }

  async function onProfile(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
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
    setBusy(true);
    const result = await signUp({ phone, name, email, password, language: locale === 'hi' ? 'hi' : 'en' });
    setBusy(false);
    if (!result.ok) {
      if (result.reason === 'email_in_use') fail(t('emailInUse'), 'login-email');
      else {
        setIdentifier(phone);
        setNotice(t('phoneInUse'));
        goTo('signin', true);
      }
      return;
    }
    done(result.account, 'sign_up');
  }

  // ── Forgot password ───────────────────────────────────────────────────────────────────────────────────────

  async function onResetWithCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const otp = text(data, 'otp');
    if (!/^\d{6}$/.test(otp)) {
      fail(t('errOtp'), 'login-otp');
      return;
    }
    const password = text(data, 'password');
    if (!checkNewPassword(password, text(data, 'confirm'), { phone })) return;
    setBusy(true);
    const result = await resetPasswordWithOtp(phone, otp, password);
    setBusy(false);
    if (!result.ok) {
      fail(result.reason === 'otp' ? t('errOtp') : t('noAccount'), 'login-otp');
      return;
    }
    done(result.account, 'password_reset_phone');
  }

  function onResetEmail(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = text(new FormData(e.currentTarget), 'email').trim();
    if (!EMAIL.test(email)) {
      fail(t('errEmail'), 'login-reset-email');
      return;
    }
    setResetEmail(email);
    setResetToken(requestEmailReset(email));
    track('click', { id: 'password_reset_email', path: window.location.pathname });
    goTo('forgot-email-sent');
  }

  async function onResetWithLink(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!linkToken) return;
    const data = new FormData(e.currentTarget);
    const password = text(data, 'password');
    if (!checkNewPassword(password, text(data, 'confirm'), { email: resetEmail })) return;
    setBusy(true);
    const result = await resetPasswordWithLink(linkToken, password);
    setBusy(false);
    if (!result.ok) {
      setLinkToken(null);
      goTo('reset-link');
      return;
    }
    track('click', { id: 'password_reset_link', path: window.location.pathname });
    setIdentifier(result.account.email);
    setNotice(t('resetDone'));
    goTo('signin', true);
  }

  // ── Steps ─────────────────────────────────────────────────────────────────────────────────────────────────

  const phoneForm = (target: Step, title: string, lead: string) => (
    <form noValidate onSubmit={onPhone(target)}>
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
          value={phone}
          aria-invalid={invalid('login-phone') ? true : undefined}
          aria-describedby={describedBy('login-phone') ?? 'login-phone-hint'}
          onChange={(e) => {
            setPhone(e.target.value);
          }}
          className={`${authInput} mt-0`}
        />
      </div>
      <p id="login-phone-hint" className="mt-1 text-xs text-muted">
        {t('phoneHint')}
      </p>
      {errorText}
      <button type="submit" className={`${primary} mt-5`}>
        {t('sendOtp')}
      </button>
      {back}
    </form>
  );

  const codeSentTo = (
    <p className="mt-1 text-sm text-muted">
      {t('otpSent', { phone })}{' '}
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
  );

  let body: ReactNode = null;
  switch (step) {
    case 'signin':
      body = (
        <form noValidate onSubmit={(e) => void onSignIn(e)}>
          {notice ? (
            <p role="status" className="mb-4 rounded-lg bg-success-bg p-3 text-sm font-bold text-success">
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
            inputMode="email"
            maxLength={200}
            value={identifier}
            aria-invalid={invalid('login-identifier') ? true : undefined}
            aria-describedby={describedBy('login-identifier') ?? 'login-identifier-hint'}
            onChange={(e) => {
              setIdentifier(e.target.value);
            }}
            className={authInput}
          />
          <p id="login-identifier-hint" className="mt-1 text-xs text-muted">
            {t('identifierHint')}
          </p>
          <PasswordField
            id="login-password"
            name="password"
            label={t('password')}
            autoComplete="current-password"
            invalid={invalid('login-password')}
            describedBy={describedBy('login-password')}
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
          {errorText}
          <button type="submit" disabled={busy} className={`${primary} mt-3`}>
            {busy ? t('verifying') : t('signInButton')}
          </button>
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
        </form>
      );
      break;

    case 'staff':
      body = (
        <form noValidate onSubmit={onStaffCode}>
          <StepTitle title={t('staffTitle')} lead={t('staffLead', { phone: staff?.phone ?? '' })} />
          <CodeField invalid={invalid('login-otp')} describedBy={describedBy('login-otp')} />
          {errorText}
          <button type="submit" className={`${primary} mt-5`}>
            {t('verify')}
          </button>
          {back}
        </form>
      );
      break;

    case 'signup-phone':
      body = phoneForm('signup-otp', t('signupTitle'), t('signupLead'));
      break;

    case 'signup-otp':
      body = (
        <form noValidate onSubmit={onSignUpCode}>
          <h2 className="font-heading text-xl font-extrabold text-ink">{t('otpTitle')}</h2>
          {codeSentTo}
          <CodeField invalid={invalid('login-otp')} describedBy={describedBy('login-otp')} />
          {errorText}
          <button type="submit" className={`${primary} mt-5`}>
            {t('verify')}
          </button>
        </form>
      );
      break;

    case 'signup-profile':
      body = (
        <form noValidate onSubmit={(e) => void onProfile(e)}>
          <StepTitle title={t('profileTitle')} lead={t('profileLead')} />
          <label htmlFor="login-name" className="mt-5 block text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            data-autofocus
            id="login-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            aria-invalid={invalid('login-name') ? true : undefined}
            aria-describedby={describedBy('login-name')}
            className={authInput}
          />
          <label htmlFor="login-email" className="mt-4 block text-sm font-bold text-ink">
            {t('email')}
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
            aria-invalid={invalid('login-email') ? true : undefined}
            aria-describedby={describedBy('login-email')}
            className={authInput}
          />
          {newPasswordFields}
          {errorText}
          <button type="submit" disabled={busy} className={`${primary} mt-5`}>
            {busy ? t('verifying') : t('create')}
          </button>
        </form>
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
                ['forgot-email', '✉️', t('forgotByEmail'), t('forgotByEmailHint', { minutes: 30 })],
              ] as const
            ).map(([target, emoji, label, hint], i) => (
              <li key={target}>
                <button
                  type="button"
                  data-autofocus={i === 0 ? true : undefined}
                  onClick={() => {
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
        <form noValidate onSubmit={(e) => void onResetWithCode(e)}>
          <h2 className="font-heading text-xl font-extrabold text-ink">{t('resetOtpTitle')}</h2>
          {codeSentTo}
          <CodeField invalid={invalid('login-otp')} describedBy={describedBy('login-otp')} />
          {newPasswordFields}
          {errorText}
          <button type="submit" disabled={busy} className={`${primary} mt-5`}>
            {busy ? t('verifying') : t('savePassword')}
          </button>
          {back}
        </form>
      );
      break;

    case 'forgot-email':
      body = (
        <form noValidate onSubmit={onResetEmail}>
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
            aria-invalid={invalid('login-reset-email') ? true : undefined}
            aria-describedby={describedBy('login-reset-email')}
            className={authInput}
          />
          {errorText}
          <button type="submit" className={`${primary} mt-5`}>
            {t('sendLink')}
          </button>
          {back}
        </form>
      );
      break;

    case 'forgot-email-sent':
      body = (
        <div>
          <StepTitle title={t('emailSentTitle')} lead={t('emailSent', { email: resetEmail, minutes: 30 })} />
          <div className="mt-5 rounded-tile border border-dashed border-line p-4 text-sm">
            {resetToken ? (
              <>
                <p className="text-xs text-muted">{t('demoInboxNote')}</p>
                <button
                  type="button"
                  data-autofocus
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
          {back}
        </div>
      );
      break;

    case 'reset-link':
      body =
        linkToken && resetLinkValid(linkToken) ? (
          <form noValidate onSubmit={(e) => void onResetWithLink(e)}>
            <StepTitle title={t('resetLinkTitle')} lead={t('resetLinkLead', { email: resetEmail })} />
            {newPasswordFields}
            {errorText}
            <button type="submit" disabled={busy} className={`${primary} mt-5`}>
              {busy ? t('verifying') : t('savePassword')}
            </button>
          </form>
        ) : (
          <div>
            <StepTitle title={t('resetLinkTitle')} lead={t('resetLinkExpired')} />
            <button
              type="button"
              data-autofocus
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

  return <div ref={root}>{body}</div>;
}

function StepTitle({ title, lead }: { title: string; lead: string }) {
  return (
    <>
      <h2 className="font-heading text-xl font-extrabold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">{lead}</p>
    </>
  );
}

/** 6-digit code with a 30-second resend timer (modern-web-guidance sms-otp-form pattern). */
function CodeField({ invalid, describedBy }: { invalid: boolean; describedBy?: string }) {
  const t = useTranslations('auth');
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_SECONDS * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (now >= resendAt) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [now, resendAt]);

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
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
        maxLength={6}
        value={code}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy ?? 'login-otp-hint'}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
        }}
        className={`${authInput} text-center font-heading text-2xl font-extrabold tracking-[0.5em] tabular-nums`}
      />
      <p id="login-otp-hint" className="mt-1 text-xs text-muted">
        {t('demoHint', { otp: DEMO_OTP })}
      </p>
      <p className="mt-2 text-center text-sm" aria-live="polite">
        {waitSeconds > 0 ? (
          <span className="text-muted">{t('resendIn', { seconds: waitSeconds })}</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              const at = Date.now();
              setNow(at);
              setResendAt(at + RESEND_SECONDS * 1000);
              setResent(true);
            }}
            className={linkButton}
          >
            {t('resend')}
          </button>
        )}
        {resent && waitSeconds > 0 ? <span className="block text-xs text-success">{t('resent')}</span> : null}
      </p>
    </>
  );
}
