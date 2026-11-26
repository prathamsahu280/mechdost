import { savingsBreakdown, savingsPeriodBounds, type SavingsPeriod } from '@mechdost/shared/savings';

/**
 * "Your savings" view helpers (decision 2026-11-26), shared by the real-mode and demo screens. Imported only by the
 * lazy savings chunks (`components/savings/*`, `components/account/savings-card.tsx`), never by first-load code.
 */
export interface SavingsTotalsLike {
  mrpPaise: number;
  couponPaise: number;
  coinsPaise: number;
  deliveryPaise: number;
}

export type SavingsRowKey = 'comp_mrp' | 'comp_coupon' | 'comp_coins' | 'comp_delivery';

/** The components that saved something, in a fixed order (message keys in the `savings` namespace). */
export function savingsRows(t: SavingsTotalsLike): { key: SavingsRowKey; paise: number }[] {
  const all: { key: SavingsRowKey; paise: number }[] = [
    { key: 'comp_mrp', paise: t.mrpPaise },
    { key: 'comp_coupon', paise: t.couponPaise },
    { key: 'comp_coins', paise: t.coinsPaise },
    { key: 'comp_delivery', paise: t.deliveryPaise },
  ];
  return all.filter((r) => r.paise > 0);
}

/** A demo-store order reduced to what the savings maths needs (the demo has no ledger; same rules as the API). */
export interface DemoSavingsOrder {
  at: Date;
  delivered: boolean;
  /** Not cancelled or rejected. */
  live: boolean;
  lines: { qty: number; unitPaise: number; mrpPaise: number | null }[];
  coinsPaise: number;
}

export interface DemoOrderSavings extends SavingsTotalsLike {
  status: 'final' | 'estimate' | 'none';
  totalPaise: number;
  excludedLines: number;
}

export function demoOrderSavings(o: DemoSavingsOrder): DemoOrderSavings {
  if (!o.live)
    return {
      status: 'none',
      mrpPaise: 0,
      couponPaise: 0,
      coinsPaise: 0,
      deliveryPaise: 0,
      totalPaise: 0,
      excludedLines: 0,
    };
  const b = savingsBreakdown({
    lines: o.lines.map((l, i) => ({ itemId: String(i), ...l })),
    couponPaise: 0,
    coinsPaise: o.coinsPaise,
    deliveryWaivedPaise: 0,
  });
  return {
    status: o.delivered ? 'final' : 'estimate',
    mrpPaise: b.mrpPaise,
    couponPaise: b.couponPaise,
    coinsPaise: b.coinsPaise,
    deliveryPaise: b.deliveryPaise,
    totalPaise: b.totalPaise,
    excludedLines: b.excludedLines,
  };
}

/** Delivered demo orders in the IST month or year containing `now`. */
export function demoPeriodSavings(orders: readonly DemoSavingsOrder[], period: SavingsPeriod, now: Date) {
  const { from, to } = savingsPeriodBounds(period, now);
  const out = {
    mrpPaise: 0,
    couponPaise: 0,
    coinsPaise: 0,
    deliveryPaise: 0,
    totalPaise: 0,
    orders: 0,
    excludedLines: 0,
  };
  for (const o of orders) {
    if (!o.live || !o.delivered || o.at < from || o.at >= to) continue;
    const s = demoOrderSavings(o);
    out.mrpPaise += s.mrpPaise;
    out.couponPaise += s.couponPaise;
    out.coinsPaise += s.coinsPaise;
    out.deliveryPaise += s.deliveryPaise;
    out.totalPaise += s.totalPaise;
    out.excludedLines += s.excludedLines;
    out.orders += 1;
  }
  return out;
}
