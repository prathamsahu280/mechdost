'use client';

import type { ShopOrderDto } from '@mechdost/shared/order-views';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { LaneTabs } from '@/components/partner';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { countText } from '@/lib/partner-kit';
import { lanesFor, pickShopLane, shopLaneOf, type ShopLane } from '@/lib/shop-portal-view';
import { ApiListState, LoadMore } from './api-list-state';
import { portalCard, portalQuiet } from './portal-styles';
import { ActiveOrder, GivenUpWhy, OrderLines, StatusPill } from './shop-portal-api';
import { FlashNote, useFlash, type Flash } from './shop-flash';
import { useShopLists } from './use-shop-lists';

const laneOfOrder = (o: ShopOrderDto): ShopLane => shopLaneOf(o.status, o.deliveryMode);

/**
 * Shop portal, Orders tab (design 2026-11-27 § 5.1): lanes with counts by real order state over the `active` and
 * `done` lists. `?lane=` keeps the lane; `?order=CODE` opens one order in place with a way back (it stays open while it
 * moves from lane to lane). "Ready for pickup" shows only for shops with MechDost agent delivery.
 */
export function ShopOrdersTabApi() {
  const ps = useTranslations('partnerShop');
  const params = useSearchParams();
  const { flash, show } = useFlash();
  const { active, done, refresh } = useShopLists();
  const all = [...active.items, ...done.items];
  const loading = active.loading || done.loading;
  const agentMode = all.some((o) => o.deliveryMode === 'agent');
  const lanes = lanesFor(agentMode);
  const counts = Object.fromEntries(
    lanes.map((l) => [l, all.filter((o) => laneOfOrder(o) === l).length]),
  ) as Record<ShopLane, number>;
  const lane = pickShopLane(params.get('lane'), counts, agentMode);
  const orderCode = params.get('order');
  const more = (l: ShopLane) => Boolean(l === 'delivered' || l === 'given_up' ? done.next : active.next);

  // Logged once the lists are in, so the "first lane with work" default is the lane actually shown.
  useEffect(() => {
    if (!orderCode && !loading) track('partner_lane_viewed', { portal: 'shop', lane });
  }, [lane, orderCode, loading]);

  if (orderCode) {
    const order = all.find((o) => o.code === orderCode);
    const back = `/partner/shop/orders?lane=${order ? laneOfOrder(order) : lane}`;
    return (
      <section aria-labelledby="order-open" className="grid gap-3">
        <h2 id="order-open" className="sr-only">
          {orderCode}
        </h2>
        <FlashNote flash={flash} sticky />
        <LocalLink href={back} className={portalQuiet}>
          {ps('back_to_orders')}
        </LocalLink>
        {order ? (
          <OrderCard order={order} onChanged={refresh} onFlash={show} />
        ) : loading ? (
          <div className="skeleton h-64 rounded-card" aria-hidden="true" />
        ) : (
          <p className="text-sm text-muted">{ps('order_missing')}</p>
        )}
      </section>
    );
  }

  const items = all.filter((o) => laneOfOrder(o) === lane);
  return (
    <section aria-labelledby="orders-title" className="grid gap-3">
      <h2 id="orders-title" className="font-heading text-xl font-extrabold text-ink">
        {ps('tab_orders')}
      </h2>
      <FlashNote flash={flash} sticky />
      <LaneTabs
        portal="shop"
        label={ps('lanes_label')}
        current={lane}
        hrefFor={(id) => `/partner/shop/orders?lane=${id}`}
        lanes={lanes.map((l) => {
          const count = countText(counts[l], more(l));
          return {
            id: l,
            label: ps(`lane_${l}`),
            count: loading ? null : count,
            name: ps('lane_count', { lane: ps(`lane_${l}`), count }),
          };
        })}
      />
      <ApiListState
        loading={loading}
        error={lane === 'delivered' || lane === 'given_up' ? done.error : active.error}
        count={items.length}
        empty={ps('lane_empty')}
        onRetry={() => void refresh()}
      />
      {items.length > 0 ? (
        <ul className="grid gap-3 nav:grid-cols-2">
          {items.map((o) => (
            <li key={`${o.code}-${o.status}`} className="flex">
              <OrderCard order={o} onChanged={refresh} onFlash={show} />
            </li>
          ))}
        </ul>
      ) : null}
      <LoadMore
        show={more(lane)}
        onClick={() =>
          void (lane === 'delivered' || lane === 'given_up' ? done.loadMore() : active.loadMore())
        }
      />
    </section>
  );
}

/** An order in progress keeps its one next step; a finished one is a history row with its status and reason. */
function OrderCard({
  order,
  onChanged,
  onFlash,
}: {
  order: ShopOrderDto;
  onChanged: () => Promise<void>;
  onFlash: (f: Flash) => void;
}) {
  const lane = laneOfOrder(order);
  if (lane === 'delivered' || lane === 'given_up')
    return (
      <div className={`${portalCard} w-full`}>
        <StatusPill status={order.status} />
        <OrderLines order={order} />
        <GivenUpWhy reason={order.givenUpReason} />
      </div>
    );
  return <ActiveOrder order={order} onChanged={onChanged} onFlash={onFlash} />;
}
