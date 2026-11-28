'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { PasswordField } from '../auth/password-field';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/demo/passwords';
import { track } from '@/lib/analytics';
import { validatePasswordChange, type ChangeFail, type ChangeInvalid } from '@/lib/auth/password-change';
import { localePath } from '@/lib/locale-path';
import { ACCOUNT_DELETION_HOOK } from '@/lib/privacy-hooks';

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60';

type Field = 'current' | 'next' | 'confirm';
type AllState = 'idle' | 'asking' | 'busy' | { error: string };
type Outcome = 'idle' | 'changed' | { field: Field | null; text: string };

const FIELD_IDS: Record<Field, string> = {
  current: 'security-current-password',
  next: 'security-new-password',
  confirm: 'security-confirm-password',
};
const fieldOf = (problem: ChangeInvalid): Field =>
  problem === 'current' ? 'current' : problem === 'confirm' ? 'confirm' : 'next';

/**
 * Account → Profile → Security (spec 01 "Change password"). Two plain blocks: change password (current, new, confirm;
 * the sign-up rules; real sign-in only, the demo has no Firebase account) and the "Delete my account" request
 * (moved here from Privacy, 2026-11-22; it still opens the one deletion request in Account → Support, staff confirm).
 * Firebase is imported on submit only, so the profile page does not carry the SDK.
 */
export function SecurityCard({ context }: { context: { phone?: string; email?: string; name?: string } }) {
  const t = useTranslations('account');
  const auth = useTranslations('auth');
  const p = useTranslations('privacy');
  const locale = useLocale();
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState<AllState>('idle');
  const allButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // The confirm step replaces the button: focus lands on the safe choice so keyboard and screen-reader users are not lost.
  useEffect(() => {
    if (all === 'asking') keepButton.current?.focus();
  }, [all]);

  /** "Sign out of all devices" (founder 2026-11-28): the API ends every session, then this device signs out too. */
  async function onSignOutAll() {
    setAll('busy');
    track('click', { id: 'signout_all_confirm', path: window.location.pathname });
    const { revokeAllSessions } = await import('@/lib/auth/sign-out-all');
    const res = await revokeAllSessions(locale);
    if (res.ok) {
      const { signOutEverywhere } = await import('@/lib/auth/sign-out');
      await signOutEverywhere();
      return;
    }
    track('click', { id: `signout_all_failed_${res.reason}`, path: window.location.pathname });
    setAll({ error: t(`signOutAllErr_${res.reason}`) });
  }

  function show(field: Field | null, text: string) {
    setOutcome({ field, text });
    if (field) document.getElementById(FIELD_IDS[field])?.focus();
  }

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v : '';
    };
    const input = { current: value('current'), next: value('next'), confirm: value('confirm') };
    const problem = validatePasswordChange(input, context);
    if (problem) {
      track('click', { id: `password_change_invalid_${problem}`, path: window.location.pathname });
      const text =
        problem === 'current'
          ? t('pwErrCurrent')
          : problem === 'same'
            ? t('pwErrSame')
            : problem === 'confirm'
              ? auth('errConfirm')
              : auth(`errPassword_${problem}`, { min: PASSWORD_MIN, max: PASSWORD_MAX });
      show(fieldOf(problem), text);
      return;
    }
    setBusy(true);
    setOutcome('idle');
    const client = await import('@/lib/auth/firebase-client');
    const res = await client.changePassword(locale, input.current, input.next);
    setBusy(false);
    if (res.ok) {
      track('click', { id: 'password_change_ok', path: window.location.pathname });
      form.reset();
      setOutcome('changed');
      return;
    }
    track('click', { id: `password_change_failed_${res.reason}`, path: window.location.pathname });
    const failField: Partial<Record<ChangeFail, Field>> = { wrong_current: 'current', weak: 'next' };
    show(failField[res.reason] ?? null, t(`pwFail_${res.reason}`));
  }

  const err = (f: Field) => (typeof outcome === 'object' && outcome.field === f ? outcome.text : null);
  const general = typeof outcome === 'object' && outcome.field === null ? outcome.text : null;

  return (
    <section aria-labelledby="security-title" className={`${card} max-w-xl space-y-6`}>
      <h2 id="security-title" className="font-heading text-xl font-extrabold text-ink">
        {t('securityTitle')}
      </h2>
      <form noValidate onSubmit={(e) => void onSubmit(e)} aria-labelledby="security-password-title">
        <h3 id="security-password-title" className="font-heading text-base font-extrabold text-ink">
          {t('pwTitle')}
        </h3>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('pwHelp')}</p>
        <PasswordField
          id={FIELD_IDS.current}
          name="current"
          label={t('pwCurrent')}
          autoComplete="current-password"
          error={err('current')}
        />
        <PasswordField
          id={FIELD_IDS.next}
          name="next"
          label={t('pwNew')}
          autoComplete="new-password"
          hint={auth('passwordHint', { min: PASSWORD_MIN })}
          error={err('next')}
        />
        <PasswordField
          id={FIELD_IDS.confirm}
          name="confirm"
          label={t('pwConfirm')}
          autoComplete="new-password"
          error={err('confirm')}
        />
        <p
          role="status"
          aria-live="polite"
          className={`mt-4 min-h-5 text-sm font-bold ${general ? 'text-error' : 'text-success'}`}
        >
          {outcome === 'changed' ? t('pwChanged') : (general ?? '')}
        </p>
        <button type="submit" disabled={busy} className={`${primary} mt-2`}>
          {busy ? t('pwBusy') : t('pwSubmit')}
        </button>
      </form>
      <div className="border-t border-line pt-5" aria-labelledby="security-signout-all-title" role="group">
        <h3 id="security-signout-all-title" className="font-heading text-base font-extrabold text-ink">
          {t('signOutAllTitle')}
        </h3>
        <p className="mt-1 max-w-prose text-sm text-muted">{t('signOutAllHelp')}</p>
        {all === 'idle' || typeof all === 'object' ? (
          <button
            ref={allButton}
            type="button"
            data-track="signout_all_open"
            onClick={() => {
              setAll('asking');
            }}
            className={`${quiet} mt-4`}
          >
            {t('signOutAllButton')}
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="max-w-prose text-sm font-bold text-ink">{t('signOutAllSure')}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={all === 'busy'}
                onClick={() => void onSignOutAll()}
                className={`${quiet} border-error text-error`}
              >
                {all === 'busy' ? t('signOutAllBusy') : t('signOutAllConfirm')}
              </button>
              <button
                ref={keepButton}
                type="button"
                disabled={all === 'busy'}
                onClick={() => {
                  setAll('idle');
                  requestAnimationFrame(() => allButton.current?.focus());
                }}
                className={quiet}
              >
                {t('signOutAllCancel')}
              </button>
            </div>
          </div>
        )}
        <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm font-bold text-error">
          {typeof all === 'object' ? all.error : ''}
        </p>
      </div>
      <div className="border-t border-line pt-5">
        <h3 className="font-heading text-base font-extrabold text-ink">{p('deleteTitle')}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted">{p('deleteHelp')}</p>
        <Link
          href={`${localePath(ACCOUNT_DELETION_HOOK.path, locale)}#${ACCOUNT_DELETION_HOOK.hash}`}
          data-track="privacy_delete_request"
          className={`${quiet} mt-4 border-error text-error`}
        >
          {p('deleteButton')}
        </Link>
      </div>
    </section>
  );
}
