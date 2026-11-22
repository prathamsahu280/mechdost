'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { ORDER_STAGES, useOrders } from '@/demo/store';
import { DATA_MODE } from './data-mode';
import { isClosedStatus, orderStatusKey } from './order-status';
import { orderListTotalPaise } from './order-totals';

/** One line of the customer's order list, the same whether it comes from the demo or the API. */
export interface OrderRow {
  code: string;
  placedAt: string;
  totalPaise: number;
  /** Item count (demo only; the API list does not carry it). */
  items: number | null;
  /** `order` locale key for the status. */
  statusKey: ReturnType<typeof orderStatusKey>;
  /** Every part is delivered, cancelled or rejected: "Order again" is offered (audience entry 2026-11-22). */
  reorderable: boolean;
}

export interface OrderRows {
  rows: OrderRow[];
  status: 'ready' | 'loading' | 'error';
}

// Account overview shows the count and the latest three; one request serves both for a few seconds.
let shared: { locale: string; at: number; promise: Promise<OrderRows> } | null = null;

async function loadApiRows(locale: string): Promise<OrderRows> {
  const { fetchMyOrders } = await import('./orders-api');
  const res = await fetchMyOrders(locale);
  if (!res.ok) return { rows: [], status: 'error' };
  return {
    status: 'ready',
    rows: res.data.orders.map((o) => {
      // A split order shows the first part still moving, else the first part.
      const part = o.orders.find((p) => !isClosedStatus(p.status)) ?? o.orders[0];
      return {
        code: o.code,
        placedAt: o.placedAt,
        totalPaise: orderListTotalPaise(o),
        items: null,
        statusKey: orderStatusKey(part?.status ?? 'placed'),
        reorderable: o.orders.every((p) => p.status === 'delivered' || isClosedStatus(p.status)),
      };
    }),
  };
}

/**
 * The signed-in customer's orders, newest first. Demo data mode: the browser store. Real data mode
 * (`NEXT_PUBLIC_DATA_MODE=api`): `GET /v1/orders` (first page of 20).
 */
export function useOrderRows(): OrderRows {
  const locale = useLocale();
  const demo = useOrders();
  const [api, setApi] = useState<OrderRows>({ rows: [], status: 'loading' });

  useEffect(() => {
    if (DATA_MODE !== 'api') return;
    let live = true;
    if (shared?.locale !== locale || Date.now() - shared.at > 5_000)
      shared = { locale, at: Date.now(), promise: loadApiRows(locale) };
    void shared.promise.then((r) => {
      if (live) setApi(r);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  if (DATA_MODE === 'api') return api;
  return {
    status: 'ready',
    rows: demo.map((o) => ({
      code: o.code,
      placedAt: o.createdAt,
      totalPaise: o.totalPaise,
      items: o.lines.length,
      statusKey: `stage_${ORDER_STAGES[o.stage] ?? 'placed'}`,
      reorderable: o.stage === ORDER_STAGES.length - 1 || Boolean(o.cancellation ?? o.rejection),
    })),
  };
}
