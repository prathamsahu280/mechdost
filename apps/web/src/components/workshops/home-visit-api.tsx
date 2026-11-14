'use client';

import { KeyRound, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ServiceRequestDetail } from '@mechdost/shared/service-api';
import { useState } from 'react';
import { formatPrice } from '@/lib/format';
import {
  homeErrorKey,
  moveReasonOf,
  moveTransportOf,
  pendingMove,
  spacedCode,
  visitFeeGstPaise,
  waiveReasonOf,
} from '@/lib/home-service-views';
import { serviceErrorKey } from '@/lib/service-views';

type Detail = ServiceRequestDetail;

/**
 * Home visit, customer side (spec 06, design 2026-11-15): who is coming (the mechanic's first name, the workshop and
 * its rating), where, the visit fee they were shown, the arrival code to give at the door, and the workshop's offer
 * to move the job to its workshop. Everything on this page comes from the API; nothing is kept in the browser.
 */
export function HomeVisitBox({ req, onChanged }: { req: Detail; onChanged: () => Promise<void> }) {
  const h = useTranslations('homeService');
  const home = req.home;
  if (!home) return null;
  const move = pendingMove(home);
  const code = req.status === 'confirmed' ? home.arrivalCode : null;
  const showArrived = home.arrivedVia !== null && req.serviceMode === 'home';
  const decided = home.move && home.move.status !== 'proposed' ? home.move : null;
  if (!code && !home.arrivalLocked && !move && !showArrived && !decided) return null;
  return (
    <div className="mt-6 space-y-4">
      {req.status === 'confirmed' && home.arrivalLocked ? (
        <p role="status" className="rounded-tile bg-warning-bg p-4 text-sm font-bold text-warning">
          {h('arrivalLocked')}
        </p>
      ) : code ? (
        <div className="rounded-tile border border-accent-soft bg-accent-soft p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-accent-soft-text">
            <KeyRound aria-hidden="true" className="size-4" />
            {h('arrivalTitle')}
          </p>
          <p
            aria-label={code.split('').join(', ')}
            className="mt-2 font-heading text-4xl font-extrabold tracking-[0.3em] text-ink tabular-nums"
          >
            {spacedCode(code)}
          </p>
          <p className="mt-2 text-sm text-ink">{h('arrivalHelp')}</p>
        </div>
      ) : null}
      {showArrived && !move ? (
        <p role="status" className="text-sm text-muted">
          {home.arrivedVia === 'override' ? h('arrivedOverride') : h('arrivedCode')}
        </p>
      ) : null}
      {move ? <MoveOffer req={req} onChanged={onChanged} /> : null}
      {decided ? (
        <p role="status" className="rounded-tile bg-pill p-4 text-sm font-bold text-ink">
          {decided.status === 'accepted'
            ? `${h('moveAcceptedTitle')}${moveTransportOf(decided.transport) === 'workshop_picks_up' ? ` ${h('moveAcceptedPickup')}` : ''}`
            : h('moveDeclinedTitle')}
        </p>
      ) : null}
    </div>
  );
}

function MoveOffer({ req, onChanged }: { req: Detail; onChanged: () => Promise<void> }) {
  const h = useTranslations('homeService');
  const r = useTranslations('request');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = pendingMove(req.home);
  if (!move) return null;

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    const { answerMove } = await import('@/lib/service-api');
    const res = await answerMove(locale, req.code, accept, req.version);
    setBusy(false);
    if (!res.ok) setError(res.code);
    await onChanged();
  }

  return (
    <section
      aria-labelledby={`${req.code}-move`}
      aria-busy={busy || undefined}
      className="rounded-tile border border-accent-soft bg-accent-soft p-5"
    >
      <h3 id={`${req.code}-move`} className="font-heading font-extrabold text-accent-soft-text">
        {h('moveTitle')}
      </h3>
      <p className="mt-2 text-sm text-ink">{h(`moveReason_${moveReasonOf(move.reasonCode)}`)}</p>
      <p className="mt-1 text-sm text-ink">{h(`moveTransport_${moveTransportOf(move.transport)}`)}</p>
      <p className="mt-2 text-xs text-muted">{h('moveDeclineNote')}</p>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-error">
          {homeErrorKey(error)
            ? h(homeErrorKey(error) as 'err_NO_MOVE')
            : r(serviceErrorKey(error) as 'api_err_generic')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(true)}
          className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70"
        >
          {h('moveAccept')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(false)}
          className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-ink underline-offset-4 hover:underline disabled:opacity-70"
        >
          {h('moveDecline')}
        </button>
      </div>
    </section>
  );
}

/** The sidebar block for a home request: the mechanic, the workshop's rating, the address and the visit fee. */
export function HomeVisitAside({ req }: { req: Detail }) {
  const h = useTranslations('homeService');
  const home = req.home;
  if (!home) return null;
  const fee = home.visitFeePaise;
  const gst = visitFeeGstPaise(fee, home.gstRegistered);
  const waived = waiveReasonOf(home.feeWaivedReason);
  return (
    <div className="space-y-3 rounded-lg bg-surface-alt p-3">
      <h3 className="font-bold text-ink">{h('panelTitle')}</h3>
      <p className="text-ink">
        {home.mechanicName ? (
          <span data-user-content>{h('mechanic', { name: home.mechanicName })}</span>
        ) : (
          <span className="text-muted">{h('mechanicPending')}</span>
        )}
      </p>
      {req.workshop ? (
        <p className="flex items-center gap-1 text-muted">
          <Star aria-hidden="true" className="size-4 fill-current" />
          {req.workshop.ratingAvg !== null && req.workshop.ratingCount > 0
            ? h('ratingLine', {
                rating: req.workshop.ratingAvg.toFixed(1),
                count: req.workshop.ratingCount,
              })
            : h('noRating')}
        </p>
      ) : null}
      {home.address ? (
        <div>
          <h4 className="font-bold text-ink">{h('addressTitle')}</h4>
          <p data-user-content className="text-muted">
            {[home.address.line1, home.address.line2, home.address.landmark].filter(Boolean).join(', ')}
          </p>
        </div>
      ) : null}
      <div>
        <h4 className="font-bold text-ink">{h('feeTitle')}</h4>
        <p className="text-muted">
          {waived
            ? `${h('feeWaived')} · ${h(`feeWaivedReason_${waived}`)}`
            : gst > 0
              ? h('feeAmountGst', { fee: formatPrice(fee), gst: formatPrice(gst) })
              : h('feeAmount', { fee: formatPrice(fee) })}
        </p>
        {waived ? null : <p className="mt-1 text-xs text-muted">{h('feeNote')}</p>}
      </div>
    </div>
  );
}
