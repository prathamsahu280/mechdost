import { findProduct } from '@/demo/catalogue';
import { isClosed, ORDER_STAGES, storeCore } from '@/demo/store';
import { demoPeriodSavings, type DemoSavingsOrder } from '@/lib/savings-view';
import type { PeriodFigures } from './savings-card';

/**
 * Demo store figures for the account "Your savings" card (decision 2026-11-26): the browser's orders through the same
 * maths as the API (delivered only, IST month / year). The demo keeps no MRP snapshot, so each line reads the demo
 * catalogue's MRP (demo prices never move). Loaded only by the demo branch of `savings-card.tsx`.
 */
export function demoSavings(now: Date): { month: PeriodFigures; year: PeriodFigures } {
  const orders: DemoSavingsOrder[] = storeCore.ordersSnapshot().map((o) => ({
    at: new Date(o.createdAt),
    delivered: o.stage === ORDER_STAGES.length - 1,
    live: !isClosed(o),
    lines: o.lines.map((l) => {
      const p = findProduct(l.slug);
      const size = l.sku ? p?.sizes?.find((x) => x.sku === l.sku) : undefined;
      return { qty: l.qty, unitPaise: l.unitPaise, mrpPaise: size?.mrpPaise ?? p?.mrpPaise ?? null };
    }),
    coinsPaise: o.coins?.discountPaise ?? 0,
  }));
  return { month: demoPeriodSavings(orders, 'month', now), year: demoPeriodSavings(orders, 'year', now) };
}
