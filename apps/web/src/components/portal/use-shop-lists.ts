'use client';

import { ShopOrderList, type ShopOrderDto } from '@mechdost/shared/order-views';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { liveOffers } from '@/lib/shop-tier1';
import { useNoticeRefresh } from '../notices/use-notice-refresh';
import { useNow } from './use-now';
import { useApiList } from './use-api-list';

const OFFER_POLL_MS = 30_000;

type Name = 'offers' | 'active' | 'done';

/**
 * The three order lists of the shop portal (`GET /v1/shop/orders?view=offers|active|done`), shared by the Today and
 * Orders tabs: offers polled every 30 s and refreshed by the bell at once, the others on demand. `openOffers` leaves
 * the list at its end time, not at the next poll (assessment 2026-11-15, item 2). Every tab loads its own copy: the
 * lists are small and the API scopes them to the signed-in person's shops.
 */
export function useShopLists() {
  const locale = useLocale();
  const now = useNow();
  const view = useCallback(
    (name: Name) => async (cursor: string | null) => {
      const q = new URLSearchParams({ view: name });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/shop/orders?${q.toString()}`, ShopOrderList);
      return res.ok
        ? { ok: true as const, data: { items: res.data.orders, next: res.data.nextCursor } }
        : res;
    },
    [locale],
  );
  const offersPage = useCallback((c: string | null) => view('offers')(c), [view]);
  const activePage = useCallback((c: string | null) => view('active')(c), [view]);
  const donePage = useCallback((c: string | null) => view('done')(c), [view]);
  const offers = useApiList<ShopOrderDto>(offersPage, OFFER_POLL_MS);
  const active = useApiList<ShopOrderDto>(activePage);
  const done = useApiList<ShopOrderDto>(donePage);
  const refresh = useCallback(async () => {
    await Promise.all([offers.reload(), active.reload(), done.reload()]);
  }, [offers, active, done]);
  // A new order (or its "about to expire" reminder) reaches the bell within seconds: show it without the 30 s wait.
  useNoticeRefresh(['shop.order_routed', 'shop.offer_expiring'], offers.reload);
  const openOffers = liveOffers(offers.items, now);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!offers.loading) setLoadedAt(Date.now());
  }, [offers.loading, offers.items]);
  return { offers, active, done, openOffers, refresh, loadedAt };
}
