'use client';
import dynamic from 'next/dynamic';

import {
  OrderChanged,
  OrderRouted,
  RoutingOrder,
  RoutingQueue,
  type RankedShopDto,
  type RoutingOrderDto,
  type RoutingQueueItemDto,
} from '@mechdost/shared/order-views';
import {
  ASSIGNMENT_GIVE_UP_REASONS,
  ORDER_REJECT_REASONS,
  PERSON_CANCEL_REASONS,
} from '@mechdost/shared/state';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import type { BadgeTone } from '@/lib/admin-status-tone';
import { formatDate, formatPrice } from '@/lib/format';
import {
  adminActions,
  closedGroup,
  historyReasonKey,
  routeEmptyReason,
  routeSuggestions,
  shopStageKey,
  type AdminGroup,
} from '@/lib/order-views';
import { deadlineView, istDayTime } from '@/lib/admin-shop-form';
import { ApiError, ApiListState, LoadMore } from './api-list-state';
import { useNow } from './use-now';
import { StatusBadge, adminCard } from './admin-ui';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { offerLeftParams } from '@/lib/offer-time';
import { useNoticeRefresh } from '../notices/use-notice-refresh';
import { useApiList, type ApiList } from './use-api-list';

/** The delivery jobs of an agent-delivered order (spec 24), loaded only where an order shows it. */
const OrderDeliveryTimeline = dynamic(
  () => import('../delivery/admin-delivery').then((m) => m.OrderDeliveryTimeline),
  { ssr: false },
);

const POLL_MS = 30_000;
/** Why nobody can be offered the order (QA 2026-11-16, bug 8): the `portal` key per reason. */
const NO_SHOP_KEY = {
  none_cover: 'noShopCover',
  none_stock: 'noShopStock',
  all_tried: 'noShopUntried',
} as const;
type View = 'needs_routing' | 'awaiting_shop' | 'in_progress' | 'closed';

/**
 * Admin → Orders on the API (spec 04/08, real sign-in only; loaded by `admin-console.tsx` with a dynamic import):
 * the routing queue in the staff member's cities, oldest first. Orders to route show the API's ranked shops (paused,
 * suspended, busy and already-tried shops are never offered) with one-click routing; offers show their timer; staff
 * can reject unrouted orders with a reason code and a customer message, cancel with a reason code, and confirm a
 * delivery without the customer's code (audited). Every change sends the order `version`; lists reload after each
 * action and the open queues poll every 30 s.
 */
/** The queue's tone (user ruling 2026-11-25): waiting amber, in progress blue, delivered green, rejected red, cancelled grey. */
const QUEUE_TONE: Record<AdminGroup, BadgeTone> = {
  needs: 'warning',
  awaiting: 'warning',
  done: 'info',
  delivered: 'success',
  rejected: 'danger',
  cancelled: 'muted',
};

export function OrderRoutingApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const page = useCallback(
    (view: View) => async (cursor: string | null) => {
      const q = new URLSearchParams({ view, locale: locale === 'hi' ? 'hi' : 'en' });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/admin/orders?${q.toString()}`, RoutingQueue);
      return res.ok ? { ok: true as const, data: { items: res.data.items, next: res.data.nextCursor } } : res;
    },
    [locale],
  );
  const needsPage = useCallback((c: string | null) => page('needs_routing')(c), [page]);
  const awaitingPage = useCallback((c: string | null) => page('awaiting_shop')(c), [page]);
  const progressPage = useCallback((c: string | null) => page('in_progress')(c), [page]);
  const closedPage = useCallback((c: string | null) => page('closed')(c), [page]);
  const needs = useApiList(needsPage, POLL_MS);
  const awaiting = useApiList(awaitingPage, POLL_MS);
  const progress = useApiList(progressPage);
  const closed = useApiList(closedPage);
  const refresh = useCallback(async () => {
    await Promise.all([needs.reload(), awaiting.reload(), progress.reload(), closed.reload()]);
  }, [needs, awaiting, progress, closed]);
  // New orders to route and shops that declined, timed out or gave an order back arrive through the bell (spec 10).
  useNoticeRefresh(
    ['staff.order_needs_routing', 'staff.shop_declined', 'staff.shop_timed_out', 'staff.shop_gave_up'],
    refresh,
  );

  const groups: { key: AdminGroup; list: ApiList<RoutingQueueItemDto>; items: RoutingQueueItemDto[] }[] = [
    { key: 'needs', list: needs, items: needs.items },
    { key: 'awaiting', list: awaiting, items: awaiting.items },
    { key: 'done', list: progress, items: progress.items },
    ...(['delivered', 'rejected', 'cancelled'] as const).map((key) => ({
      key,
      list: closed,
      items: closed.items.filter((i) => closedGroup(i.status) === key),
    })),
  ];

  return (
    <div className="space-y-8">
      {groups.map(({ key, list, items }) => (
        <section key={key} aria-labelledby={`queue-${key}`}>
          <h3 id={`queue-${key}`} className="font-heading text-xl font-extrabold text-ink">
            {t(`queue_${key}`)}{' '}
            {list.loading ? null : (
              <StatusBadge tone={QUEUE_TONE[key]} className="align-middle tabular-nums">
                {items.length}
              </StatusBadge>
            )}
          </h3>
          <ApiListState
            loading={list.loading}
            error={list.error}
            count={items.length}
            empty={t('emptyQueue')}
            onRetry={() => void list.reload()}
          />
          {items.length > 0 ? (
            <ul className="mt-3 grid gap-3 xl:grid-cols-2">
              {items.map((o) => (
                <li key={o.code}>
                  <RoutingCard
                    item={o}
                    detailed={key === 'needs' || key === 'awaiting'}
                    onChanged={refresh}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {/* The closed view is shared by three lists: its "Load more" sits under the last one only. */}
          {key === 'needs' || key === 'awaiting' || key === 'done' || key === 'cancelled' ? (
            <LoadMore show={Boolean(list.next)} onClick={() => void list.loadMore()} />
          ) : null}
        </section>
      ))}
    </div>
  );
}

function RoutingCard({
  item,
  detailed,
  onChanged,
}: {
  item: RoutingQueueItemDto;
  detailed: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const g = useTranslations('shopGiveUp');
  const a = useTranslations('account');
  const ord = useTranslations('order');
  const locale = useLocale();
  const now = useNow();
  const [detail, setDetail] = useState<RoutingOrderDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = adminActions(item.status);
  const version = detail?.version ?? item.version;

  // Items, offer history and ranked shops come with the order itself; loaded for the open queues only.
  useEffect(() => {
    if (!detailed) return;
    const alive: { current: boolean } = { current: true };
    void (async () => {
      const res = await adminApi(
        locale,
        `/admin/orders/${item.code}?locale=${locale === 'hi' ? 'hi' : 'en'}`,
        RoutingOrder,
      );
      if (!alive.current) return;
      if (res.ok) {
        setDetail(res.data);
        setDetailError(null);
      } else setDetailError(res.code);
    })();
    return () => {
      alive.current = false;
    };
  }, [detailed, item.code, item.version, locale]);

  async function act(path: string, body: unknown, tracked: () => void): Promise<boolean> {
    setBusy(true);
    const schema: ResponseSchema<unknown> = path === 'route' ? OrderRouted : OrderChanged;
    const res = await adminApi(locale, `/admin/orders/${item.code}/${path}`, schema, {
      method: 'POST',
      body,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      await onChanged();
      return false;
    }
    setError(null);
    tracked();
    await onChanged();
    return true;
  }

  const suggestions = detail ? routeSuggestions(detail.shops) : [];
  const stage = item.status;

  return (
    <article
      className={`${adminCard} ${can.route ? 'border-accent-button/60' : ''}`}
      aria-busy={busy || undefined}
    >
      <p className="font-heading text-lg font-extrabold text-ink">{item.code}</p>
      <p className="text-xs text-muted">
        {formatDate(item.placedAt, locale)} ·{' '}
        {t('orderMeta', {
          items: a('items', { count: item.items }),
          total: formatPrice(item.totalPaise),
          pin: item.pincode,
        })}
      </p>
      {detail ? (
        <p className="mt-2 text-sm text-ink">
          {detail.items.map((l) => `${l.title} × ${String(l.qty)}`).join(', ')}
        </p>
      ) : null}
      {detailError ? (
        <div className="mt-2">
          <ApiError code={detailError} />
        </div>
      ) : null}

      {(detail?.history ?? [])
        .filter((h) => h.status === 'given_up')
        .map((h) => {
          const code = ASSIGNMENT_GIVE_UP_REASONS.find((r) => r === h.giveUpReason);
          return (
            <p key={`gu-${h.shop}-${h.offeredAt}`} className="mt-2 text-xs font-bold text-warning">
              {g('adminGaveUp', { shop: h.shop, reason: code ? g(`reason_${code}`) : g('reason_other') })}
            </p>
          );
        })}
      {(detail?.history ?? [])
        .filter((h) => h.status === 'declined' || h.status === 'expired')
        .map((h) => (
          <p key={`${h.shop}-${h.offeredAt}`} className="mt-2 text-xs font-bold text-warning">
            {t('declinedBy', { shop: h.shop, reason: t(historyReasonKey(h) as 'reason_declined') })}
          </p>
        ))}

      {stage === 'awaiting_shop' && item.offer ? (
        <p className="mt-3 rounded-lg bg-warning-bg p-3 text-sm font-bold text-warning">
          <span aria-hidden="true">⏱️ </span>
          {t('offeredTo', { shop: item.offer.shop })} ·{' '}
          {(() => {
            // Routed while the shop was closed: the offer waits for its opening (+ grace), so show that time.
            const d = deadlineView(item.offer.expiresAt, now);
            return d.kind === 'minutes'
              ? t('expiresIn', offerLeftParams(d.minutes))
              : t('shops_api_waitsUntil', { time: istDayTime(d.at, locale) });
          })()}
        </p>
      ) : null}
      {['confirmed', 'packed', 'shipped', 'delivered'].includes(stage) ? (
        <p className="mt-3 rounded-lg bg-success-bg p-3 text-sm font-bold text-success">
          <span aria-hidden="true">✅ </span>
          {ord(shopStageKey(stage))}
        </p>
      ) : null}
      {stage === 'rejected' || stage === 'cancelled' ? (
        <p className="mt-3 rounded-lg bg-pill p-3 text-sm text-muted">{t(`queue_${stage}`)}</p>
      ) : null}
      {['packed', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'returned'].includes(stage) ? (
        <OrderDeliveryTimeline orderCode={item.code} />
      ) : null}
      {can.override ? (
        <DeliveryOverride
          code={item.code}
          busy={busy}
          onSubmit={(reason) =>
            act('deliver-override', { reason, version }, () => {
              track('click', { id: 'admin_delivery_override', path: window.location.pathname });
            })
          }
        />
      ) : null}

      {error ? (
        <div className="mt-3">
          <ApiError code={error} />
        </div>
      ) : null}

      {can.route && detail ? (
        <div className="mt-4">
          <h3 className="text-xs font-extrabold text-muted">{t('suggestions')}</h3>
          {suggestions.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-warning">
              {t(NO_SHOP_KEY[routeEmptyReason(detail.shops)])}
            </p>
          ) : null}
          <ul className="mt-2 space-y-2">
            {suggestions.map((s, i) => (
              <li
                key={s.shopId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-line-card p-3"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-bold text-ink">🏪 {s.name}</span>
                  {i === 0 ? (
                    <StatusBadge tone="success" className="ml-2">
                      {t('recommended')}
                    </StatusBadge>
                  ) : null}
                  {/* Working hours (user 2026-11-14): open shops are ranked first; a closed one can still take it. */}
                  <StatusBadge tone={s.openNow ? 'success' : 'muted'} className="ml-2">
                    {s.openNow || !s.opensAt
                      ? t('shops_api_openNow')
                      : t('shops_api_closedOpens', { time: istDayTime(s.opensAt, locale) })}
                  </StatusBadge>
                  <ShopFacts shop={s} />
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void act('route', { shopId: s.shopId, version }, () => {
                      track('click', { id: 'admin_order_routed', path: window.location.pathname });
                    })
                  }
                  className={i === 0 ? portalPrimary : portalQuiet}
                >
                  {t('routeTo', { shop: s.name })}
                </button>
              </li>
            ))}
          </ul>
          {suggestions.some((s) => !s.openNow) ? (
            <p className="mt-2 text-xs text-muted">{t('shops_api_closedRouteNote')}</p>
          ) : null}
        </div>
      ) : null}

      {can.cancel ? (
        <ReasonForm
          kind="cancel"
          code={item.code}
          busy={busy}
          onSubmit={(reasonCode) =>
            act('cancel', { reasonCode, version }, () => {
              const code = PERSON_CANCEL_REASONS.find((r) => r === reasonCode);
              if (code) track('order_cancel_submitted', { code: item.code, by: 'staff', reasonCode: code });
            })
          }
        />
      ) : null}
      {can.reject ? (
        <ReasonForm
          kind="reject"
          code={item.code}
          busy={busy}
          onSubmit={(reasonCode, message) =>
            act('reject', { reasonCode, message, version }, () => {
              track('click', { id: 'admin_order_rejected', path: window.location.pathname });
            })
          }
        />
      ) : null}
    </article>
  );
}

function ShopFacts({ shop }: { shop: RankedShopDto }) {
  const t = useTranslations('portal');
  const g = useTranslations('shopGiveUp');
  const facts = [
    shop.distanceKm === null ? null : t('api_distanceKm', { km: shop.distanceKm.toFixed(1) }),
    t('api_stockItems', { n: shop.stockedItems, total: shop.totalItems }),
    shop.acceptanceRate === null
      ? t('api_acceptanceNew')
      : t('api_acceptanceRate', { rate: Math.round(shop.acceptanceRate * 100) }),
    shop.gaveUpBefore ? g('adminGaveUpBefore') : null,
  ].filter((f): f is string => f !== null);
  return <span className="block text-xs text-muted">{facts.join(' · ')}</span>;
}

/**
 * Exception path for proof of delivery: the customer cannot give the code (phone dead, code lost, locked after
 * 5 wrong tries). Staff confirm only with a written reason, which the API audits.
 */
function DeliveryOverride({
  code,
  busy,
  onSubmit,
}: {
  code: string;
  busy: boolean;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const t = useTranslations('portal');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const fieldId = `override-${code}`;

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      setError(true);
      document.getElementById(fieldId)?.focus();
      return;
    }
    if (await onSubmit(reason.trim())) setOpen(false);
  }

  return (
    <div className="mt-3 rounded-lg bg-pill p-3 text-sm">
      <p className="text-ink">
        <span aria-hidden="true">🚚 </span>
        {t('api_outForDelivery')}
      </p>
      {open ? (
        <form noValidate onSubmit={(e) => void submit(e)} className="mt-2">
          <label htmlFor={fieldId} className="text-sm font-bold text-ink">
            {t('overrideReason')}
          </label>
          <input
            id={fieldId}
            name="reason"
            maxLength={300}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            onChange={() => {
              setError(false);
            }}
            className={portalField}
          />
          {error ? (
            <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm font-bold text-error">
              {t('overrideReasonError')}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalQuiet}>
              {t('overrideConfirm')}
            </button>
            <button
              type="button"
              data-panel-cancel={fieldId}
              onClick={() => {
                setOpen(false);
                setError(false);
              }}
              className={portalQuiet}
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          data-disclosure-trigger={fieldId}
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="mt-1 inline-flex min-h-11 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
        >
          {t('overrideOpen')}
        </button>
      )}
    </div>
  );
}

/** Cancel (reason code) or reject (reason code + customer message); no reason is ever preselected (rule 16). */
function ReasonForm({
  kind,
  code,
  busy,
  onSubmit,
}: {
  kind: 'cancel' | 'reject';
  code: string;
  busy: boolean;
  onSubmit: (reasonCode: string, message: string) => Promise<boolean>;
}) {
  const t = useTranslations('portal');
  const a = useTranslations('account');
  const ord = useTranslations('order');
  const [open, setOpen] = useState(false);
  const [noReason, setNoReason] = useState(false);
  const [shortNote, setShortNote] = useState(false);
  const options: (readonly [string, string])[] =
    kind === 'cancel'
      ? PERSON_CANCEL_REASONS.map((r) => [r, ord(`cancelReason_${r}`)] as const)
      : ORDER_REJECT_REASONS.map((r) => [r, ord(`rejectReason_${r}`)] as const);
  const selectId = `${kind}-reason-${code}`;
  const noteId = `reject-${code}`;

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const picked = options.find(([r]) => r === data.get('reasonCode'))?.[0];
    if (!picked) {
      setNoReason(true);
      document.getElementById(selectId)?.focus();
      return;
    }
    const message = data.get('message');
    const note = typeof message === 'string' ? message.trim() : '';
    if (kind === 'reject' && note.length < 10) {
      setShortNote(true);
      document.getElementById(noteId)?.focus();
      return;
    }
    if (await onSubmit(picked, note)) setOpen(false);
  }

  if (!open)
    return (
      <button
        data-disclosure-trigger={`${kind}-${code}`}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="mt-3 mr-4 inline-flex min-h-11 items-center text-sm font-bold text-muted underline-offset-4 hover:underline"
      >
        {kind === 'cancel' ? t('cancelOrder') : t('reject')}
      </button>
    );

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 space-y-2">
      <label htmlFor={selectId} className="text-sm font-bold text-ink">
        {kind === 'cancel' ? t('cancelReason') : t('rejectReason')}
      </label>
      <select
        id={selectId}
        name="reasonCode"
        defaultValue=""
        aria-invalid={noReason ? true : undefined}
        aria-describedby={noReason ? `${selectId}-error` : undefined}
        onChange={() => {
          setNoReason(false);
        }}
        className={portalField}
      >
        <option value="">{t('reasonChoose')}</option>
        {options.map(([r, label]) => (
          <option key={r} value={r}>
            {label}
          </option>
        ))}
      </select>
      {noReason ? (
        <p id={`${selectId}-error`} className="text-xs font-bold text-error">
          {t('reasonRequired')}
        </p>
      ) : null}
      {kind === 'reject' ? (
        <>
          <label htmlFor={noteId} className="text-sm font-bold text-ink">
            {t('rejectMessage')}
          </label>
          <textarea
            id={noteId}
            name="message"
            rows={3}
            maxLength={500}
            aria-invalid={shortNote ? true : undefined}
            aria-describedby={shortNote ? `${noteId}-error` : undefined}
            onChange={() => {
              setShortNote(false);
            }}
            className={`${portalField} py-2`}
          />
          {shortNote ? (
            <p id={`${noteId}-error`} className="text-xs font-bold text-error">
              {t('rejectMessageShort')}
            </p>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {kind === 'cancel' ? t('cancelConfirm', { code }) : t('rejectSend')}
        </button>
        <button
          data-panel-cancel={`${kind}-${code}`}
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={portalQuiet}
        >
          {a('cancel')}
        </button>
      </div>
    </form>
  );
}
