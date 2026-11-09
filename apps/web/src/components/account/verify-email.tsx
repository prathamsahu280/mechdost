'use client';

import { BadgeCheck, Mail, MailWarning } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type Ref } from 'react';
import type { EmailState } from '@/lib/auth/use-email-status';

/**
 * Email state pill for the account hero (real sign-in mode). The state word is in the text and the icon follows
 * it (WCAG 1.4.1); `tabIndex=-1` so focus can land here when the verify card disappears under the person's focus
 * (a11y review 2026-11-09). No live region: the state arrives after load, not from an action.
 */
export function EmailPill({
  state,
  email,
  pillRef,
}: {
  state: EmailState;
  email: string;
  pillRef: Ref<HTMLLIElement>;
}) {
  const t = useTranslations('account');
  const Icon = state.kind === 'verified' ? BadgeCheck : state.kind === 'unverified' ? MailWarning : Mail;
  const label =
    state.kind === 'verified'
      ? `${t('emailVerified')} · ${email}`
      : state.kind === 'unverified'
        ? `${t('emailNotVerified')} · ${email}`
        : email;
  return (
    <li
      ref={pillRef}
      tabIndex={-1}
      className="inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-white"
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </li>
  );
}

/**
 * "Verify your email" card (spec 01: verified once, needed before the first order). Placed at the end of the
 * overview so its late arrival moves nothing above it (CLS budget); found by its heading, not announced. One
 * button, busy via `aria-disabled` (keeps focus, guarded against double sends); the outcome goes to one
 * always-mounted polite status line, cleared first so a repeat is read again.
 */
export function VerifyEmailCard({
  email,
  onFocusInside,
  className,
}: {
  email: string;
  /** Tells the overview whether focus is in this card, so focus can be moved if the card goes away. */
  onFocusInside: (inside: boolean) => void;
  className: string;
}) {
  const t = useTranslations('account');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOutcome(null);
    const client = await import('@/lib/auth/firebase-client');
    const ok = await client.resendVerification(locale).catch(() => false);
    setOutcome({ ok, text: ok ? t('verifyEmailSent') : t('verifyEmailFailed') });
    busyRef.current = false;
    setBusy(false);
  }

  return (
    <section
      aria-labelledby="verify-email-title"
      className={className}
      onFocus={() => {
        onFocusInside(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onFocusInside(false);
      }}
    >
      <h2 id="verify-email-title" className="font-heading text-lg font-extrabold text-ink">
        {t('verifyEmailTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('verifyEmailBody', { email })}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => {
            void send();
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          {busy ? t('verifyEmailSending') : t('verifyEmailResend')}
        </button>
        <p
          role="status"
          className={`min-h-5 text-sm font-bold ${outcome?.ok === false ? 'text-error' : 'text-success'}`}
        >
          {outcome?.text ?? ''}
        </p>
      </div>
    </section>
  );
}
