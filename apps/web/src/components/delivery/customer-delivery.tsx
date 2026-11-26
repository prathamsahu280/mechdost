'use client';

import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { portalField, portalPrimary, portalQuiet } from '@/components/portal/portal-styles';
import { track } from '@/lib/analytics';
import {
  RATING_REASONS,
  type CustomerDeliveryView,
  type RatingReason,
  type Result,
} from '@/lib/delivery/types';
import { site } from '@/lib/site';
import { telNumber } from '@/lib/delivery/view';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { useStatusLine } from './status-line';

/**
 * The customer's delivery block for an agent-delivered part (spec 24, Lead's calls 7, 13): the stage in words with the
 * agent's first name and vehicle — never the shop, never the agent's phone; a failed try and the refund wording after
 * a return; and the rider rating after delivery (founder 2026-11-26: 1–5 stars, quick reasons, editable for 24 h).
 */
export function CustomerDeliveryCard({
  view,
  rate,
}: {
  view: CustomerDeliveryView;
  /** Saves a rating; null where rating is not possible. */
  rate: ((stars: number, reasons: RatingReason[], note?: string) => Promise<Result<null>>) | null;
}) {
  const t = useTranslations('deliveryCustomer');
  const s = useTranslations('delivery.customerStage');
  const v = useTranslations('delivery.vehicle');
  const fr = useTranslations('delivery.failReason');
  const name = view.agentFirstName ?? t('partner');
  const vehicle = view.vehicleType ? v(view.vehicleType) : '';
  const stageText =
    view.stage === 'agent_assigned'
      ? s('agent_assigned', { name })
      : view.stage === 'picked_up'
        ? s('picked_up', { name, vehicle })
        : s(view.stage);
  const tone =
    view.stage === 'delivered'
      ? 'border-success bg-success-bg'
      : view.stage === 'attempt_failed' || view.stage === 'returning' || view.stage === 'returned'
        ? 'border-warning bg-warning-bg'
        : 'border-line-card bg-surface';
  return (
    <section aria-labelledby="customer-delivery-title" className={`rounded-tile border p-4 ${tone}`}>
      <h3 id="customer-delivery-title" className="text-xs font-bold text-muted">
        {t('title')}
      </h3>
      {/* Polite: a new stage (picked up, delivered…) is read when it arrives on a refresh. */}
      <p role="status" className="mt-1 font-heading text-lg font-extrabold text-ink">
        {stageText}
      </p>
      {view.stage === 'attempt_failed' && view.failReason ? (
        <p className="mt-1 text-sm text-ink">{t('failedBody', { reason: fr(view.failReason) })}</p>
      ) : null}
      {view.stage === 'returned' ? (
        <p className="mt-1 text-sm text-ink">
          {view.refund === 'parts_only' ? t('returnedParts') : t('returnedFull')}
        </p>
      ) : null}
      {view.stage === 'picked_up' || view.stage === 'retrying' ? (
        <p className="mt-1 text-sm text-ink">{t('codeNote')}</p>
      ) : null}
      {view.stage !== 'delivered' ? (
        <a
          href={`tel:${telNumber(site.supportPhone)}`}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-ink underline underline-offset-4"
        >
          {t('callSupport')}
        </a>
      ) : null}
      {view.stage === 'delivered' && rate && (view.canRate || view.rating) ? (
        <RatingCard view={view} rate={rate} />
      ) : null}
    </section>
  );
}

function RatingCard({
  view,
  rate,
}: {
  view: CustomerDeliveryView;
  rate: (stars: number, reasons: RatingReason[], note?: string) => Promise<Result<null>>;
}) {
  const t = useTranslations('deliveryCustomer');
  const locale = useLocale();
  const existing = view.rating ?? null;
  const [editing, setEditing] = useState(existing === null);
  const [stars, setStars] = useState(existing?.stars ?? 0);
  const [reasons, setReasons] = useState<RatingReason[]>(existing?.reasons ?? []);
  const [note, setNote] = useState(existing?.note ?? '');
  const [problem, setProblem] = useState<'stars' | 'note' | null>(null);
  const [busy, setBusy] = useState(false);
  const { say, line } = useStatusLine();
  useDisclosureFocus(editing && existing ? 'rate-edit' : null);

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const p = stars < 1 ? 'stars' : reasons.includes('other') && note.trim() === '' ? 'note' : null;
    setProblem(p);
    if (p) {
      document.getElementById(p === 'stars' ? 'rate-stars' : 'rate-note')?.focus();
      return;
    }
    setBusy(true);
    const res = await rate(stars, reasons, note.trim() || undefined);
    setBusy(false);
    track('click', {
      id: res.ok ? 'delivery_rated' : 'delivery_rate_failed',
      path: window.location.pathname,
    });
    if (res.ok) {
      say(t('rateSaved'));
      setEditing(false);
      // The form leaves the page: focus the saved summary instead of dropping to the page (2.4.3).
      requestAnimationFrame(() => document.getElementById('rate-summary')?.focus());
    } else say(t('rateFailed'), 'error');
  }

  const until = existing
    ? new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(existing.editableUntil))
    : null;

  if (!editing && existing) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p id="rate-summary" tabIndex={-1} className="text-sm font-bold text-ink">
          {t('rateYours', { count: existing.stars })}
        </p>
        {view.canRate && until ? (
          <>
            <p className="text-xs text-muted">{t('rateEditUntil', { time: until })}</p>
            <button
              type="button"
              data-disclosure-trigger="rate-edit"
              onClick={() => {
                setEditing(true);
              }}
              className={`${portalQuiet} mt-2`}
            >
              {t('rateEdit')}
            </button>
          </>
        ) : null}
        {line}
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      className="mt-3 grid gap-3 border-t border-line pt-3"
      aria-busy={busy || undefined}
    >
      <h4 className="font-heading text-base font-extrabold text-ink">{t('rateTitle')}</h4>
      <fieldset
        id="rate-stars"
        tabIndex={-1}
        aria-describedby={problem === 'stars' ? 'rate-stars-error' : undefined}
      >
        <legend className="text-sm font-bold text-ink">{t('rateLegend')}</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="press inline-flex size-12 cursor-pointer items-center justify-center rounded-button has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="radio"
                name="rate-stars"
                value={n}
                checked={stars === n}
                aria-invalid={problem === 'stars' ? true : undefined}
                {...(n === 1 ? { 'data-disclosure-field': 'rate-edit' } : {})}
                onChange={() => {
                  setStars(n);
                  setProblem(null);
                }}
                className="sr-only"
              />
              <Star
                aria-hidden="true"
                className={`size-8 ${n <= stars ? 'fill-star text-star' : 'text-muted'}`}
              />
              <span className="sr-only">{t('star', { count: n })}</span>
            </label>
          ))}
        </div>
        {problem === 'stars' ? (
          <p id="rate-stars-error" role="alert" className="mt-1 text-sm font-bold text-error">
            {t('rateStarsRequired')}
          </p>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('rateReasons')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {RATING_REASONS.map((r) => (
            <label
              key={r}
              className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-input-border px-3 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
            >
              <input
                type="checkbox"
                checked={reasons.includes(r)}
                onChange={(e) => {
                  setReasons((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)));
                }}
                className="size-4 accent-[var(--color-accent-button)]"
              />
              {t(`reason_${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      {reasons.includes('other') ? (
        <div>
          <label htmlFor="rate-note" className="text-sm font-bold text-ink">
            {t('rateNoteRequiredLabel')}
          </label>
          <textarea
            id="rate-note"
            value={note}
            rows={2}
            maxLength={300}
            aria-required="true"
            aria-invalid={problem === 'note' ? true : undefined}
            aria-describedby={problem === 'note' ? 'rate-note-error' : undefined}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            className={`${portalField} py-2`}
          />
          {problem === 'note' ? (
            <p id="rate-note-error" role="alert" className="mt-1 text-sm font-bold text-error">
              {t('rateNoteRequired')}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" aria-disabled={busy || undefined} className={`${portalPrimary} min-h-12`}>
          {t('rateSend')}
        </button>
        {existing ? (
          <button
            type="button"
            data-panel-cancel="rate-edit"
            onClick={() => {
              setEditing(false);
            }}
            className={`${portalQuiet} min-h-12`}
          >
            {t('rateKeep')}
          </button>
        ) : null}
      </div>
      {line}
    </form>
  );
}
