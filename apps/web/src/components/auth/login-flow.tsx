'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  DEMO_OTP,
  SEEDED_ACCOUNTS,
  homeFor,
  normalisePhone,
  safeNext,
  signUp,
  verifyOtp,
  type DemoRole,
} from '@/demo/session';
import { track } from '@/lib/analytics';

type Step = 'phone' | 'otp' | 'profile';
const RESEND_SECONDS = 30;
const ROLE_EMOJI: Record<DemoRole, string> = { customer: '🙋', shop: '🏪', workshop: '🔧', admin: '🛡️' };

/**
 * Phone-OTP sign-in (spec 01) in demo mode: phone → 6-digit code → (new numbers) name + email. One primary
 * action per step, errors next to the field, focus moves to each step's field. Firebase phone auth replaces
 * `verifyOtp`/`signUp` in Phase 1 with the same screens.
 */
export function LoginFlow() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [resent, setResent] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const prefix = locale === 'hi' ? '/hi' : '';

  useEffect(() => {
    field.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'otp' || now >= resendAt) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [step, now, resendAt]);

  function go(role: DemoRole) {
    router.push(next ?? `${prefix}${homeFor(role)}`);
  }

  function sendCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalised = normalisePhone(phone);
    if (!normalised) {
      setError(t('errPhone'));
      field.current?.focus();
      return;
    }
    setPhone(normalised);
    setError(null);
    setOtp('');
    setResent(false);
    const at = Date.now();
    setNow(at);
    setResendAt(at + RESEND_SECONDS * 1000);
    setStep('otp');
    track('click', { id: 'login_otp_sent', path: window.location.pathname });
  }

  function checkCode(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const result = verifyOtp(phone, otp);
    setBusy(false);
    if (!result.ok) {
      setError(t('errOtp'));
      track('click', { id: 'login_otp_failed', path: window.location.pathname });
      field.current?.select();
      return;
    }
    setError(null);
    if (result.account) {
      track('click', { id: `login_${result.account.role}`, path: window.location.pathname });
      go(result.account.role);
    } else {
      setStep('profile');
    }
  }

  function createAccount(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const name = text('name');
    const email = text('email');
    if (name.length < 2) {
      setError(t('errName'));
      document.getElementById('login-name')?.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError(t('errEmail'));
      document.getElementById('login-email')?.focus();
      return;
    }
    const account = signUp({ phone, name, email, language: locale === 'hi' ? 'hi' : 'en' });
    track('click', { id: 'sign_up', path: window.location.pathname });
    go(account.role);
  }

  const input =
    'mt-1 min-h-12 w-full rounded-input border border-input-border bg-surface px-3 text-[16px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
  const primary =
    'press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70';
  const errorText = error ? (
    <p id="login-error" role="alert" className="mt-2 text-sm font-bold text-error">
      {error}
    </p>
  ) : null;
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  return (
    <div>
      {step === 'phone' ? (
        <form noValidate onSubmit={sendCode}>
          <label htmlFor="login-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <div className="mt-1 flex items-stretch gap-2">
            <span className="inline-flex min-h-12 items-center rounded-input border border-input-border bg-surface-alt px-3 text-[16px] font-bold text-ink">
              +91
            </span>
            <input
              ref={field}
              id="login-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              value={phone}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : 'login-phone-hint'}
              onChange={(e) => {
                setPhone(e.target.value);
              }}
              className={`${input} mt-0`}
            />
          </div>
          <p id="login-phone-hint" className="mt-1 text-xs text-muted">
            {t('phoneHint')}
          </p>
          {errorText}
          <button type="submit" className={`${primary} mt-5`}>
            {t('sendOtp')}
          </button>
          <p className="mt-4 text-xs text-muted">{t('terms')}</p>

          <section
            aria-labelledby="demo-logins"
            className="mt-8 rounded-tile border border-dashed border-line p-4"
          >
            <h2 id="demo-logins" className="text-sm font-extrabold text-ink">
              {t('demoAccounts')}
            </h2>
            <p className="mt-1 text-xs text-muted">{t('demoAccountsLead', { otp: DEMO_OTP })}</p>
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {SEEDED_ACCOUNTS.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPhone(a.phone);
                      setError(null);
                      field.current?.focus();
                    }}
                    className="press flex min-h-14 w-full items-center gap-2 rounded-button border border-line-card bg-surface px-3 text-left hover:bg-pill"
                  >
                    <span aria-hidden="true" className="text-[20px] leading-none">
                      {ROLE_EMOJI[a.role]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink">{t(`role_${a.role}`)}</span>
                      <span className="block truncate text-xs text-muted">{a.name}</span>
                      <span className="block text-xs text-muted tabular-nums">{a.phone}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </form>
      ) : null}

      {step === 'otp' ? (
        <form noValidate onSubmit={checkCode}>
          <h2 className="font-heading text-xl font-extrabold text-ink">{t('otpTitle')}</h2>
          <p className="mt-1 text-sm text-muted">
            {t('otpSent', { phone })}{' '}
            <button
              type="button"
              onClick={() => {
                setStep('phone');
                setError(null);
              }}
              className="inline-flex min-h-6 font-bold text-accent-soft-text underline-offset-4 hover:underline"
            >
              {t('changeNumber')}
            </button>
          </p>
          <label htmlFor="login-otp" className="mt-5 block text-sm font-bold text-ink">
            {t('otpLabel')}
          </label>
          <input
            ref={field}
            id="login-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={otp}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : 'login-otp-hint'}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
            }}
            className={`${input} text-center font-heading text-2xl font-extrabold tracking-[0.5em] tabular-nums`}
          />
          <p id="login-otp-hint" className="mt-1 text-xs text-muted">
            {t('demoHint', { otp: DEMO_OTP })}
          </p>
          {errorText}
          <button type="submit" disabled={busy || otp.length !== 6} className={`${primary} mt-5`}>
            {busy ? t('verifying') : t('verify')}
          </button>
          <p className="mt-4 text-center text-sm" aria-live="polite">
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
                className="inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
              >
                {t('resend')}
              </button>
            )}
            {resent && waitSeconds > 0 ? (
              <span className="block text-xs text-success">{t('resent')}</span>
            ) : null}
          </p>
        </form>
      ) : null}

      {step === 'profile' ? (
        <form noValidate onSubmit={createAccount}>
          <h2 className="font-heading text-xl font-extrabold text-ink">{t('profileTitle')}</h2>
          <p className="mt-1 text-sm text-muted">{t('profileLead')}</p>
          <label htmlFor="login-name" className="mt-5 block text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            ref={field}
            id="login-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            className={input}
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
            className={input}
          />
          {errorText}
          <button type="submit" className={`${primary} mt-5`}>
            {t('create')}
          </button>
        </form>
      ) : null}
    </div>
  );
}
