'use client';

import { useLocale, useNow, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CLOCK_HOURS, clockBadge } from '@/lib/admin-ustaad-console';
import { commonErrorKey } from '@/lib/api-error-key';
import { StatusBadge } from '../admin-ui';

/** Console texts (`ustaad.console.*`), typed loosely for keys built from codes (every code has a key: unit test). */
export function useConsoleT() {
  const t = useTranslations('ustaad.console');
  return (key: string, values?: Record<string, string | number>) =>
    (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
}

/** The message for an API refusal: the console's own codes first, then the portal's common ones. */
export function useErrorText() {
  const c = useConsoleT();
  const p = useTranslations('portal');
  return (code: string): string => {
    if (code.startsWith('STALE_')) return c('err_stale');
    if (code === 'FOUR_EYES') return c('err_four_eyes');
    if (code === 'SELF_MODERATION') return c('err_self');
    if (code === 'USTAAD_LEGAL_HOLD') return c('err_legal_hold');
    if (code === 'USTAAD_MEMBER_FROZEN') return c('m_frozen_note');
    if (code === 'USTAAD_BAN_PENDING' || code === 'USTAAD_UNBAN_PENDING') return c('err_pending');
    if (code === 'USTAAD_NOT_SANCTIONED') return c('err_not_sanctioned');
    if (code === 'NAME_EXISTS') return c('n_exists');
    return p(commonErrorKey(code));
  };
}

/** Date and time in IST, in the page's language. */
export function useFormatWhen() {
  const locale = useLocale();
  return (iso: string, withTime = true) =>
    new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
    }).format(new Date(iso));
}

/** The report's clock: "24 h clock" and the time left or overdue, in words and tone (never colour alone). */
export function ClockBadge({ clock, dueAt, createdAt }: { clock: string; dueAt: string; createdAt: string }) {
  const c = useConsoleT();
  const now = useNow({ updateInterval: 60_000 });
  const b = clockBadge(dueAt, createdAt, now);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={b.tone}>
        <span className="tabular-nums">
          {c(b.overdue ? 'overdue' : 'due_in', { h: b.hours, m: b.minutes })}
        </span>
      </StatusBadge>
      {CLOCK_HOURS[clock] !== undefined ? (
        <span className="text-xs text-muted">{c(`clock_${clock}`)}</span>
      ) : null}
    </span>
  );
}

/** A polite status line that stays mounted (screen readers hear each change once). */
export function StatusLine({ tone, children }: { tone: 'ok' | 'error' | null; children: ReactNode }) {
  return (
    <p
      role="status"
      className={`text-sm font-bold empty:sr-only ${tone === 'error' ? 'text-error' : 'text-success'}`}
    >
      {children}
    </p>
  );
}

/** Section heading with its one-line help. */
export function SectionHead({ id, title, help }: { id: string; title: string; help: string }) {
  return (
    <div>
      <h3 id={id} tabIndex={-1} className="font-heading text-lg font-extrabold text-ink">
        {title}
      </h3>
      <p className="mt-0.5 max-w-prose text-sm text-muted">{help}</p>
    </div>
  );
}

export const labelClass = 'text-sm font-bold text-ink';
