'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { PASSWORD_MAX, PASSWORD_MIN, passwordProblem } from '@/demo/passwords';
import { track } from '@/lib/analytics';
import {
  actionFailFor,
  parseActionParams,
  safeContinuePath,
  type ActionFail,
  type EmailActionMode,
} from '@/lib/auth/email-action';
import { AUTH_MODE } from '@/lib/auth/mode';
import { PasswordField } from './password-field';

type View =
  | { kind: 'checking' }
  | { kind: 'form'; email: string }
  | { kind: 'done'; mode: EmailActionMode; email?: string }
  | { kind: 'failed'; reason: ActionFail | 'missing'; mode: EmailActionMode | null };

const text = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};

const primary =
  'press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover aria-disabled:cursor-wait aria-disabled:opacity-70';

const FAIL_TEXT = {
  invalid: 'failInvalid',
  expired: 'failExpired',
  disabled: 'failDisabled',
  network: 'failNetwork',
  unavailable: 'failUnavailable',
  weak: 'failWeak',
  missing: 'failMissing',
} as const;

/**
 * The page Firebase's email links open (verification, password reset, email change, "this wasn't me" recovery):
 * Firebase appends `mode`, `oobCode`, `continueUrl` and `lang` to our action URL. Works signed out. One state at a
 * time, the heading takes focus on each result and the status text is a polite live region. The Firebase SDK loads
 * only here, after the page is open. Each code is single use, so it is applied exactly once (the `started` ref
 * guards React's development double-run).
 */
export function EmailAction() {
  const t = useTranslations('emailAction');
  const a = useTranslations('auth');
  const locale = useLocale();
  const query = useSearchParams();
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const code = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prefix = locale === 'hi' ? '/hi' : '';

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = parseActionParams(query);
    const { mode } = params;
    const fail = (reason: ActionFail | 'missing', analyticsCode: string) => {
      if (mode) track('auth_email_action_failed', { mode, code: analyticsCode });
      setView({ kind: 'failed', reason, mode });
    };
    if (!mode || !params.oobCode) {
      fail('missing', 'missing');
      return;
    }
    if (AUTH_MODE !== 'firebase') {
      fail('unavailable', 'unknown');
      return;
    }
    track('auth_email_action_opened', { mode });
    code.current = params.oobCode;
    const oob = params.oobCode;
    void (async () => {
      const client = await import('@/lib/auth/firebase-client');
      if (mode === 'resetPassword') {
        const res = await client.checkResetLink(oob, locale);
        if (res.ok) setView({ kind: 'form', email: res.email });
        else fail(actionFailFor(res.code), res.code);
        return;
      }
      if (mode === 'recoverEmail') {
        const res = await client.recoverEmailLink(oob, locale);
        if (res.ok) setView({ kind: 'done', mode, email: res.email });
        else fail(actionFailFor(res.code), res.code);
        return;
      }
      const res = await client.applyEmailLink(oob, locale);
      if (!res.ok) {
        fail(actionFailFor(res.code), res.code);
        return;
      }
      track('auth_email_verified', { mode });
      // Signed in here too: refresh the session so the account's "verify your email" card goes away at once.
      await client.emailStatus(locale).catch(() => null);
      setView({ kind: 'done', mode });
    })();
  }, [query, locale]);

  useEffect(() => {
    if (view.kind !== 'checking') headingRef.current?.focus();
  }, [view.kind]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || view.kind !== 'form' || !code.current) return;
    const data = new FormData(event.currentTarget);
    const password = text(data, 'password');
    const confirm = text(data, 'confirm');
    const problem = passwordProblem(password, { email: view.email });
    if (problem) {
      setError({
        id: 'action-new-password',
        text: a(`errPassword_${problem}`, { min: PASSWORD_MIN, max: PASSWORD_MAX }),
      });
      return;
    }
    if (password !== confirm) {
      setError({ id: 'action-confirm-password', text: a('errConfirm') });
      return;
    }
    setError(null);
    setBusy(true);
    const client = await import('@/lib/auth/firebase-client');
    const res = await client.finishPasswordReset(code.current, password, locale);
    setBusy(false);
    if (res.ok) {
      void client.notifyPasswordChanged(view.email, locale);
      track('auth_password_reset_done', {});
      setView({ kind: 'done', mode: 'resetPassword' });
      return;
    }
    const reason = actionFailFor(res.code);
    track('auth_email_action_failed', { mode: 'resetPassword', code: res.code });
    if (reason === 'weak') {
      setError({ id: 'action-new-password', text: t('failWeak') });
      return;
    }
    setView({ kind: 'failed', reason, mode: 'resetPassword' });
  }

  const go = (href: string, label: string, track_id: string) => (
    <Link href={href} data-track={track_id} className={`${primary} mt-6`}>
      {label}
    </Link>
  );

  let heading = t('title');
  let body: ReactNode = null;
  let icon: ReactNode = null;
  switch (view.kind) {
    case 'checking':
      body = <p className="mt-2 text-sm text-muted">{t('checking')}</p>;
      break;
    case 'form':
      heading = t('resetTitle');
      body = (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <p className="mt-2 text-sm text-muted">
            {t.rich('resetLead', {
              email: view.email,
              e: (chunks) => (
                <strong data-user-content="" className="break-all text-ink">
                  {chunks}
                </strong>
              ),
            })}
          </p>
          <PasswordField
            id="action-new-password"
            name="password"
            label={a('newPassword')}
            autoComplete="new-password"
            hint={a('passwordHint', { min: PASSWORD_MIN })}
            error={error?.id === 'action-new-password' ? error.text : null}
          />
          <PasswordField
            id="action-confirm-password"
            name="confirm"
            label={a('confirmPassword')}
            autoComplete="new-password"
            error={error?.id === 'action-confirm-password' ? error.text : null}
          />
          <button type="submit" aria-disabled={busy || undefined} className={`${primary} mt-6`}>
            {busy ? t('resetSaving') : t('resetSave')}
          </button>
        </form>
      );
      break;
    case 'done': {
      icon = <CircleCheck aria-hidden="true" className="size-8 text-success" />;
      const { mode } = view;
      if (mode === 'resetPassword') {
        heading = t('resetDoneTitle');
        body = (
          <>
            <p className="mt-2 text-sm text-muted">{t('resetDoneBody')}</p>
            {go(`${prefix}/login`, t('toSignIn'), 'email_action_sign_in')}
          </>
        );
      } else if (mode === 'recoverEmail') {
        heading = t('recoverDoneTitle');
        const chunks = {
          email: view.email ?? '',
          e: (c: ReactNode) => (
            <strong data-user-content="" className="break-all text-ink">
              {c}
            </strong>
          ),
        };
        body = (
          <>
            <p className="mt-2 text-sm text-muted">
              {view.email ? t.rich('recoverDoneBody', chunks) : t('recoverDoneBodyNoEmail')}
            </p>
            {go(`${prefix}/login`, t('recoverCta'), 'email_action_reset_password')}
          </>
        );
      } else {
        heading = mode === 'verifyEmail' ? t('verifyDoneTitle') : t('changeDoneTitle');
        const next = safeContinuePath(parseActionParams(query).continueUrl, window.location.host);
        body = (
          <>
            <p className="mt-2 text-sm text-muted">
              {mode === 'verifyEmail' ? t('verifyDoneBody') : t('changeDoneBody')}
            </p>
            {go(
              next ?? `${prefix}/account`,
              next ? t('toContinue') : t('toAccount'),
              'email_action_continue',
            )}
          </>
        );
      }
      break;
    }
    case 'failed': {
      icon = <CircleAlert aria-hidden="true" className="size-8 text-error" />;
      heading = t('failTitle');
      const reset = view.mode === 'resetPassword';
      const verify = view.mode === 'verifyEmail' || view.mode === 'verifyAndChangeEmail';
      body = (
        <>
          <p className="mt-2 text-sm text-muted">{t(FAIL_TEXT[view.reason])}</p>
          {verify
            ? go(`${prefix}/account`, t('newLinkVerify'), 'email_action_new_link')
            : go(
                `${prefix}/login`,
                reset ? t('newLinkReset') : t('toSignIn'),
                reset ? 'email_action_new_link' : 'email_action_sign_in',
              )}
        </>
      );
      break;
    }
  }

  return (
    <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
      {icon}
      <div aria-live="polite">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-heading text-2xl font-extrabold text-ink focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          {heading}
        </h1>
      </div>
      {body}
    </div>
  );
}
