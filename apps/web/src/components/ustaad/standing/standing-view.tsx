'use client';

import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { formatDate } from '@/lib/format';
import { localePath } from '@/lib/locale-path';
import { ustaadClient, type StandingView } from '@/lib/ustaad/client';
import { standingReasonKey, standingSummary, type StandingSummary } from '@/lib/ustaad/standing-view';
import { btnPrimary, btnQuiet, card, LoadingBlock, useUstaad } from '../common';

type Item = StandingView['items'][number];

/** The one wording for a limited account (SIM-P23): what is limited and until when. */
export function StandingSummaryText({ summary }: { summary: StandingSummary }) {
  const t = useTranslations('ustaad.standing');
  const locale = useLocale();
  const date = (iso: string) => formatDate(iso, locale);
  if (summary.kind === 'banned')
    return <>{summary.until ? t('bannedUntil', { date: date(summary.until) }) : t('bannedForever')}</>;
  if (summary.kind === 'restricted')
    return <>{summary.until ? t('restrictedUntil', { date: date(summary.until) }) : t('restrictedReview')}</>;
  if (summary.kind === 'review') return <>{t('restrictedReview')}</>;
  return <>{t('allClear')}</>;
}

/** One decision with its plain reason, dates and its single Appeal action (an inline form, no dialog). */
function Decision({ item, onFiled }: { item: Item; onFiled: (code: string, ticket: string) => void }) {
  const t = useTranslations('ustaad.standing');
  const locale = useLocale();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  async function send() {
    if (note.trim().length < 10) {
      setError(t('appealNeed'));
      field.current?.focus();
      return;
    }
    setBusy(true);
    const r = await (await ustaadClient(locale)).fileAppeal(item.reportCode, note.trim());
    setBusy(false);
    if (!r.ok) {
      setError(
        r.code === 'USTAAD_APPEAL_CLOSED' || r.code === 'TICKET_DAILY_LIMIT'
          ? t(`err_${r.code}`)
          : t('loadFailed'),
      );
      field.current?.focus();
      return;
    }
    setOpen(false);
    onFiled(item.reportCode, r.data.ticketCode);
  }

  const appealLine =
    item.appeal === 'pending'
      ? t('appealPending')
      : item.appeal === 'upheld'
        ? t('appealUpheld')
        : item.appeal === 'overturned'
          ? t('appealOverturned')
          : null;

  return (
    <li className="grid gap-2 rounded-xl bg-surface-alt p-4">
      <p className="text-[16px] font-extrabold text-ink">{t(`act_${item.action}`)}</p>
      <p className="text-[15px] text-ink">
        {t('reasonLabel', { reason: t(standingReasonKey(item.reasonCode)) })}
      </p>
      <p className="text-sm text-muted">
        {t('decidedOn', { date: formatDate(item.at, locale) })}
        {item.action === 'restrict' || item.action === 'ban' ? (
          <>
            {' · '}
            {item.endsAt ? t('endsOn', { date: formatDate(item.endsAt, locale) }) : t('noEnd')}
          </>
        ) : null}
      </p>
      {appealLine ? <p className="text-sm font-bold text-ink">{appealLine}</p> : null}
      {item.appeal === 'can' && !open ? (
        <button
          ref={opener}
          type="button"
          className={`${btnPrimary} justify-self-start`}
          onClick={() => {
            setOpen(true);
            setError(null);
            requestAnimationFrame(() => field.current?.focus());
          }}
          data-track="ustaad_appeal_open"
        >
          {t('appeal')}
        </button>
      ) : null}
      {open ? (
        <form
          className="grid gap-2"
          aria-labelledby={`${ids}-h`}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              opener.current?.focus();
            }
          }}
        >
          <h3 id={`${ids}-h`} className="font-heading text-base font-extrabold text-ink">
            {t('appealH')}
          </h3>
          <p className="text-sm text-muted">{t('appealHelp')}</p>
          <label htmlFor={`${ids}-note`} className="text-sm font-bold text-ink">
            {t('appealNote')}
          </label>
          <textarea
            ref={field}
            id={`${ids}-note`}
            value={note}
            maxLength={1000}
            rows={4}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className="w-full rounded-xl border border-line-card bg-surface p-3 text-[15px] leading-relaxed text-ink focus-visible:outline-3 focus-visible:outline-focus"
          />
          <p id={`${ids}-err`} role="alert" className="text-sm font-bold text-error empty:sr-only">
            {error ?? ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={btnPrimary}
              aria-disabled={busy ? true : undefined}
              data-track="ustaad_appeal_send"
            >
              {t('appealSend')}
            </button>
            <button
              type="button"
              className={btnQuiet}
              onClick={() => {
                setOpen(false);
                requestAnimationFrame(() => opener.current?.focus());
              }}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** SIM-P27: the banned screen every network page shows a banned member (reason, end date, appeal). */
export function BannedScreen() {
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <StandingPanel heading="bannedTitle" />
    </div>
  );
}

/**
 * SIM-P23: the one banner a restricted (or under-review) member sees above every network page: what is limited and
 * until when, and the way to the reason and the appeal. The space is reserved while the date loads (no jump).
 */
export function LimitedBanner() {
  const t = useTranslations('ustaad.standing');
  const locale = useLocale();
  const { loaded } = useUstaad((c) => c.standing(), 'standing-banner');
  const summary = loaded.state === 'ok' ? standingSummary(loaded.data) : null;
  return (
    <section
      aria-labelledby="ustaad-limited-h"
      className="mx-auto mb-4 grid min-h-[132px] w-full max-w-2xl gap-2 rounded-2xl border border-line-card bg-warning-bg p-4"
    >
      <h2 id="ustaad-limited-h" className="flex items-center gap-2 text-[16px] font-extrabold text-warning">
        <ShieldAlert aria-hidden="true" className="size-5 shrink-0" />
        {t('restrictedTitle')}
      </h2>
      <p className="text-[15px] leading-relaxed text-ink">
        {summary ? <StandingSummaryText summary={summary} /> : t('restrictedReview')}
      </p>
      <Link
        href={localePath('/ustaad/me/standing', locale)}
        className="inline-flex min-h-11 items-center justify-self-start text-[15px] font-bold text-info underline underline-offset-4 hover:no-underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        data-track="ustaad_limited_banner_open"
      >
        {t('seeStanding')}
      </Link>
    </section>
  );
}

/**
 * The member's standing (SIM-P19 / SIM-P24): the one-line summary of what is limited and until when, then each
 * decision with its plain reason and one Appeal action. Shown on `/ustaad/me/standing` and as the banned screen.
 */
export function StandingPanel({ heading }: { heading: 'title' | 'bannedTitle' }) {
  const t = useTranslations('ustaad.standing');
  const locale = useLocale();
  const { loaded, reload, set } = useUstaad((c) => c.standing(), 'standing');
  const [status, setStatus] = useState('');
  const statusRef = useRef<HTMLParagraphElement>(null);

  if (loaded.state === 'loading') return <LoadingBlock />;
  if (loaded.state === 'error')
    return (
      <div className={`${card} grid gap-3`}>
        <p className="text-[15px] text-ink">{t('loadFailed')}</p>
        <button type="button" className={`${btnQuiet} justify-self-start`} onClick={reload}>
          {t('retry')}
        </button>
      </div>
    );
  const v = loaded.data;
  const summary = standingSummary(v);
  return (
    <div className="grid gap-5">
      <section aria-labelledby="ustaad-standing-h" className={`${card} grid gap-3`}>
        <h1
          id="ustaad-standing-h"
          className="flex items-center gap-2 font-heading text-[clamp(22px,4.6vw,28px)] leading-snug font-extrabold text-ink"
        >
          {summary.kind === 'clear' ? null : (
            <ShieldAlert aria-hidden="true" className="size-6 shrink-0 text-warning" />
          )}
          {heading === 'bannedTitle' ? t('bannedTitle') : t('title')}
        </h1>
        <p className="text-[15.5px] leading-relaxed text-ink">
          <StandingSummaryText summary={summary} />
        </p>
        {summary.kind === 'clear' && v.items.length === 0 ? (
          <Link
            href={localePath('/policies/community-rules', locale)}
            className={`${btnQuiet} justify-self-start`}
            data-track="ustaad_standing_rules"
          >
            {t('allClearAction')}
          </Link>
        ) : null}
      </section>
      <p
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="text-[15px] font-bold text-ink focus-visible:outline-3 focus-visible:outline-focus empty:sr-only"
      >
        {status}
      </p>
      {v.items.length > 0 ? (
        <section aria-labelledby="ustaad-decisions-h" className={`${card} grid gap-3`}>
          <h2 id="ustaad-decisions-h" className="font-heading text-xl font-extrabold text-ink">
            {t('decisionsH')}
          </h2>
          <ul className="grid gap-3">
            {v.items.map((item) => (
              <Decision
                key={item.reportCode}
                item={item}
                onFiled={(code, ticket) => {
                  set({
                    ...v,
                    items: v.items.map((x) => (x.reportCode === code ? { ...x, appeal: 'pending' } : x)),
                  });
                  setStatus(t('appealSent', { code: ticket }));
                  requestAnimationFrame(() => statusRef.current?.focus());
                }}
              />
            ))}
          </ul>
          <p className="text-sm text-muted">{t('gac')}</p>
        </section>
      ) : null}
    </div>
  );
}
