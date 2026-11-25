'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ADMIN_REFUND_VIEWS,
  type AdminRefund,
  type AdminRefundView,
  type RefundDestinationInput,
} from '@mechdost/shared/refunds-api';
import { REFUND_REJECT_REASONS, type RefundRejectReason } from '@mechdost/shared/state';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { isRefundReference, refundErrorKey, refundFailureKey } from '@/lib/refund-views';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { RefundSettleForm } from './refund-settle-form';
import { StatusBadge, adminCard } from './admin-ui';

type List =
  | { kind: 'loading' }
  | { kind: 'error'; code: string }
  | { kind: 'ok'; items: AdminRefund[]; nextCursor: string | null };

const POLL_MS = 20_000;
const click = (id: string) => {
  track('click', { id, path: window.location.pathname });
};

/**
 * Admin refund queue on the API (real sign-in; spec 05, decision 2026-11-15 "All need approval"): every refund waits
 * here. One primary action per refund: finance approves it (not the person who asked), or declines it with a reason
 * code. A cash-on-delivery refund, once approved, is paid by hand: finance sees the payout details, pays, and records
 * the UTR. Every change sends the refund's `version`; a 409 reloads it. Refreshes every 20 s.
 */
export function RefundQueueApi() {
  const t = useTranslations('refunds');
  const locale = useLocale();
  const [view, setView] = useState<AdminRefundView>('waiting');
  const [list, setList] = useState<List>({ kind: 'loading' });
  const [counts, setCounts] = useState<{ waiting: number; overdue: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const { fetchRefunds } = await import('@/lib/refunds-api');
      const res = await fetchRefunds(locale, view, cursor);
      if (!res.ok) {
        setList({ kind: 'error', code: res.code });
        return;
      }
      setCounts(res.data.counts);
      setList((prev) =>
        cursor && prev.kind === 'ok'
          ? { kind: 'ok', items: [...prev.items, ...res.data.items], nextCursor: res.data.nextCursor }
          : { kind: 'ok', items: res.data.items, nextCursor: res.data.nextCursor },
      );
    },
    [locale, view],
  );

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);

  const replace = (next: AdminRefund) => {
    setList((prev) =>
      prev.kind === 'ok' ? { ...prev, items: prev.items.map((i) => (i.id === next.id ? next : i)) } : prev,
    );
    void load();
  };

  const current = list.kind === 'ok' ? list.items.find((i) => i.id === selected) : undefined;

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
      <section aria-labelledby="refund-list">
        <h3 id="refund-list" className="font-heading text-xl font-extrabold text-ink">
          {t('title')}
        </h3>
        <p className="mt-1 text-sm text-muted">{t('intro')}</p>
        {counts ? (
          <p className="mt-2 text-sm font-bold text-ink" role="status">
            {t('waitingCount', { count: counts.waiting, overdue: counts.overdue })}
          </p>
        ) : null}
        <div role="group" aria-label={t('viewsLabel')} className="mt-3 flex flex-wrap gap-2">
          {ADMIN_REFUND_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                click(`admin_refund_view_${v}`);
                setView(v);
                setSelected(null);
                setList({ kind: 'loading' });
              }}
              className={`press min-h-10 rounded-pill px-3 text-sm font-bold ${
                view === v
                  ? 'bg-accent-soft text-accent-soft-text'
                  : 'border border-line-card text-ink hover:bg-pill'
              }`}
            >
              {t(`view_${v}`)}
            </button>
          ))}
        </div>
        {list.kind === 'loading' ? (
          <p role="status" className="mt-3 text-sm text-muted">
            {t('loading')}
          </p>
        ) : null}
        {list.kind === 'error' ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm font-bold text-ink">
              {t(refundErrorKey(list.code))}
            </p>
            <button type="button" onClick={() => void load()} className={portalQuiet}>
              {t('retry')}
            </button>
          </div>
        ) : null}
        {list.kind === 'ok' && list.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t('empty')}</p>
        ) : null}
        {list.kind === 'ok' && list.items.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {list.items.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  aria-pressed={selected === x.id}
                  onClick={() => {
                    setSelected(x.id);
                  }}
                  className={`press w-full rounded-tile border p-3 text-left ${
                    selected === x.id
                      ? 'border-accent-button bg-accent-soft'
                      : x.overdue
                        ? 'border-line-card bg-error-bg hover:bg-pill'
                        : 'border-line-card bg-surface hover:bg-pill'
                  }`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-heading text-base font-extrabold text-error tabular-nums">
                      {formatPrice(x.amountPaise)}
                    </span>
                    <StatusBadge code={x.status === 'approved' ? 'in_progress' : x.status}>
                      {t(`status_${x.status}`)}
                    </StatusBadge>
                  </span>
                  <span className="mt-1 block text-sm text-ink">
                    {x.orderCode ?? x.groupCode} · {t(`source_${x.source}`)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {t('asked', { date: formatDate(x.requestedAt, locale) })}
                    {x.overdue ? <StatusBadge tone="danger">{t('overdueBadge')}</StatusBadge> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {list.kind === 'ok' && list.nextCursor ? (
          <button
            type="button"
            onClick={() => void load(list.nextCursor ?? undefined)}
            className={`${portalQuiet} mt-3`}
          >
            {t('loadMore')}
          </button>
        ) : null}
      </section>
      {current ? <RefundDetail key={current.id} refund={current} onChanged={replace} /> : null}
    </div>
  );
}

function RefundDetail({
  refund,
  onChanged,
}: {
  refund: AdminRefund;
  onChanged: (next: AdminRefund) => void;
}) {
  const t = useTranslations('refunds');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<'approved' | 'declined' | 'paid' | 'settled' | null>(null);
  const [settling, setSettling] = useState(false);
  const settleOpener = useRef<HTMLButtonElement>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<RefundRejectReason>('not_eligible');
  const [reference, setReference] = useState('');
  const [destination, setDestination] = useState<RefundDestinationInput | null>(null);

  const run = async (action: 'approve' | 'reject' | 'markPaid', done: 'approved' | 'declined' | 'paid') => {
    setBusy(true);
    setError(null);
    const api = await import('@/lib/refunds-api');
    const res =
      action === 'approve'
        ? await api.approveRefund(locale, refund.id, refund.version)
        : action === 'reject'
          ? await api.rejectRefund(locale, refund.id, { version: refund.version, reasonCode: reason })
          : await api.markRefundPaid(locale, refund.id, {
              version: refund.version,
              reference: reference.trim(),
            });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      // A refund that changed meanwhile is reloaded so the next try uses its current version.
      if (res.code === 'STALE_REFUND' || res.code === 'NOT_PENDING') {
        const fresh = await api.fetchRefund(locale, refund.id);
        if (fresh.ok) onChanged(fresh.data);
      }
      return;
    }
    setMessage(done);
    onChanged(res.data);
  };

  const showDestination = async () => {
    click('admin_refund_show_destination');
    setError(null);
    const { fetchRefundDestination } = await import('@/lib/refunds-api');
    const res = await fetchRefundDestination(locale, refund.id);
    if (res.ok) setDestination(res.data);
    else setError(res.code);
  };

  const submitPaid = (e: SyntheticEvent) => {
    e.preventDefault();
    if (!isRefundReference(reference)) {
      setError('REFUND_REFERENCE');
      return;
    }
    click('admin_refund_mark_paid');
    void run('markPaid', 'paid');
  };

  const manualApproved = refund.mode === 'bank_upi' && refund.status === 'approved';
  const closeSettle = () => {
    setSettling(false);
    // Focus goes back to the button that opened the form (a form opened by a button can always be closed).
    window.setTimeout(() => settleOpener.current?.focus(), 0);
  };

  return (
    <section aria-labelledby="refund-detail" className={adminCard}>
      <h3 id="refund-detail" className="font-heading text-xl font-extrabold text-ink">
        {formatPrice(refund.amountPaise)} · {t(`status_${refund.status}`)}
      </h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">{t('order')}</dt>
          <dd className="font-bold text-ink">{refund.orderCode ?? refund.groupCode}</dd>
        </div>
        <div>
          <dt className="text-muted">{t(`source_${refund.source}`)}</dt>
          <dd className="font-bold text-ink">{t(`reason_${refund.reasonCode}`)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('asked', { date: formatDate(refund.requestedAt, locale) })}</dt>
          <dd className="font-bold text-ink">
            {refund.requestedBy ? t('requestedByStaff') : t('requestedBySystem')}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('modeLabel')}</dt>
          <dd className="font-bold text-ink">{t(`mode_${refund.mode}`)}</dd>
        </div>
        {refund.note ? (
          <div className="sm:col-span-2">
            <dt className="text-muted">{t('note')}</dt>
            <dd className="text-ink" data-user-content>
              {refund.note}
            </dd>
          </div>
        ) : null}
        {refund.providerRefundId ? (
          <div className="sm:col-span-2">
            <dt className="text-muted">{t('providerRefund')}</dt>
            <dd className="font-mono text-ink">{refund.providerRefundId}</dd>
          </div>
        ) : null}
      </dl>
      {refund.overdue ? <p className="mt-3 text-sm font-bold text-ink">{t('overdueNote')}</p> : null}
      {refund.status === 'needs_reconciliation' ? (
        <p className="mt-3 text-sm font-bold text-ink">
          {t('reconcileNote', { reason: t(refundFailureKey(refund.failureCode ?? '')) })}
        </p>
      ) : null}
      {refund.providerReportedPaise ? (
        <p className="mt-3 text-sm text-ink">
          {t('reportedNote', { amount: formatPrice(refund.providerReportedPaise) })}
        </p>
      ) : null}
      {refund.status === 'failed' ? (
        <p className="mt-3 text-sm text-ink">
          {t('failureNote', { reason: t(refundFailureKey(refund.failureCode ?? '')) })}
        </p>
      ) : null}
      {refund.status === 'rejected' && refund.rejectReasonCode ? (
        <p className="mt-3 text-sm text-ink">{t(`rejectReason_${refund.rejectReasonCode}`)}</p>
      ) : null}
      {refund.settleReasonCode ? (
        <p className="mt-3 text-sm text-ink">
          {t('settledBy', { reason: t(`settleReason_${refund.settleReasonCode}`) })}
        </p>
      ) : null}
      {refund.creditNote ? (
        <p className="mt-3 text-sm font-bold text-ink">
          {t('creditNote', {
            number: refund.creditNote.number,
            amount: formatPrice(refund.creditNote.totalPaise),
          })}
        </p>
      ) : null}
      {refund.manualReference ? (
        <p className="mt-3 text-sm font-bold text-ink">
          <span>{t('paidWith')}</span> <span data-user-content>{refund.manualReference}</span>
        </p>
      ) : null}
      {refund.destinationMasked && !destination ? (
        <p className="mt-3 text-sm text-ink">{t('destinationMasked', { value: refund.destinationMasked })}</p>
      ) : null}
      {destination ? (
        <p className="mt-3 text-sm font-bold text-ink">
          {destination.kind === 'upi'
            ? t('destinationUpi', { value: destination.upiId })
            : t('destinationBank', {
                name: destination.accountName,
                number: destination.accountNumber,
                ifsc: destination.ifsc,
              })}
        </p>
      ) : null}

      {refund.status === 'requested' ? (
        <div className="mt-5">
          {refund.canApprove ? (
            <>
              {!declining ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      click('admin_refund_approve');
                      void run('approve', 'approved');
                    }}
                    className={portalPrimary}
                  >
                    {busy ? t('approveBusy') : t('approve')}
                  </button>
                  <button
                    data-disclosure-trigger={`reject-${refund.id}`}
                    type="button"
                    onClick={() => {
                      setDeclining(true);
                    }}
                    className={portalQuiet}
                  >
                    {t('reject')}
                  </button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-bold text-ink">
                    {t('rejectReasonLabel')}
                    <select
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value as RefundRejectReason);
                      }}
                      className={portalField}
                    >
                      {REFUND_REJECT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`rejectReason_${r}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-xs text-muted">{t('rejectNote')}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        click('admin_refund_reject');
                        void run('reject', 'declined');
                      }}
                      className={portalPrimary}
                    >
                      {t('rejectConfirm')}
                    </button>
                    <button
                      data-panel-cancel={`reject-${refund.id}`}
                      type="button"
                      onClick={() => {
                        setDeclining(false);
                      }}
                      className={portalQuiet}
                    >
                      {t('rejectKeep')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm font-bold text-ink">{t('fourEyes')}</p>
          )}
        </div>
      ) : null}

      {refund.status === 'needs_reconciliation' ? (
        refund.canSettle ? (
          settling ? (
            <RefundSettleForm
              refund={refund}
              onClose={closeSettle}
              onStale={onChanged}
              onSettled={(next) => {
                setSettling(false);
                setMessage('settled');
                onChanged(next);
              }}
            />
          ) : (
            <button
              ref={settleOpener}
              data-testid="refund-settle-open"
              type="button"
              onClick={() => {
                click('admin_refund_settle_open');
                setSettling(true);
              }}
              className={`${portalPrimary} mt-5`}
            >
              {t('settleOpen')}
            </button>
          )
        ) : (
          <p className="mt-5 text-sm font-bold text-ink">{t('settleFourEyes')}</p>
        )
      ) : null}

      {manualApproved ? (
        <form onSubmit={submitPaid} className="mt-5" noValidate>
          <h4 className="font-heading text-base font-extrabold text-ink">{t('payTitle')}</h4>
          <p className="mt-1 text-sm text-muted">{t('payIntro')}</p>
          {!destination ? (
            <button type="button" onClick={() => void showDestination()} className={`${portalQuiet} mt-3`}>
              {t('showDestination')}
            </button>
          ) : null}
          <label className="mt-3 block text-sm font-bold text-ink">
            {t('referenceLabel')}
            <input
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
              }}
              autoComplete="off"
              maxLength={35}
              aria-describedby="refund-reference-hint"
              className={portalField}
            />
          </label>
          <p id="refund-reference-hint" className="mt-1 text-xs text-muted">
            {t('referenceHint')}
          </p>
          <button type="submit" disabled={busy} className={`${portalPrimary} mt-3`}>
            {busy ? t('markPaidBusy') : t('markPaid')}
          </button>
        </form>
      ) : null}

      {message ? (
        <p role="status" className="mt-4 text-sm font-bold text-ink">
          {t(message)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm font-bold text-ink">
          {t(refundErrorKey(error))}
        </p>
      ) : null}
    </section>
  );
}
