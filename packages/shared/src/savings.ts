/**
 * "Your savings" (shopping personalisation phase 4; design `docs/superpowers/specs/2026-11-25-shopping-personalisation-
 * design.md`, decision 2026-11-26). One pure breakdown for every surface (cart estimate, order page, ledger, demo):
 *
 * - per line: the maker's printed MRP snapshot minus the price paid, times the quantity (never below 0);
 * - plus the coupon discount, the value of the redeemed MechDost Coins and the delivery fee waived by the free-delivery
 *   threshold, each its own component;
 * - a line without a printed MRP (null or 0) is excluded and counted, never guessed from today's catalogue.
 *
 * Refunds reverse savings in proportion to the money refunded (refund / order total), telescoping: the reversal after
 * refunds R1..Rn is floor(x · ΣR / T) for every component and line, so any split of partial refunds reverses at most
 * what was saved, and refunds adding up to the total reverse exactly all of it. Integer paise only (BigInt inside).
 * No Zod here: the db layer and the browser import it.
 */
import { istParts, istStartOfDay } from './time';

export const SAVINGS_COMPONENTS = ['mrp', 'coupon', 'coins', 'delivery'] as const;
export type SavingsComponent = (typeof SAVINGS_COMPONENTS)[number];
export const SAVINGS_PERIODS = ['month', 'year'] as const;
export type SavingsPeriod = (typeof SAVINGS_PERIODS)[number];
/** Ledger entry kinds: the order was delivered, or a refund on it was processed. */
export const SAVINGS_ENTRY_KINDS = ['delivered', 'refund'] as const;
export type SavingsEntryKind = (typeof SAVINGS_ENTRY_KINDS)[number];

export interface SavingsLineInput {
  itemId: string;
  qty: number;
  /** Price paid per unit before the coupon (the order line's `unit_paise`). */
  unitPaise: number;
  /** The printed MRP per unit when the order was placed (`order_items.mrp_paise`); null = not known. */
  mrpPaise: number | null;
}

export interface SavingsLine {
  itemId: string;
  mrpSavingPaise: number;
}

export interface SavingsBreakdown {
  mrpPaise: number;
  couponPaise: number;
  coinsPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  /** Lines with a printed MRP (their saving may be 0). */
  countedLines: number;
  /** Lines left out because no printed MRP was recorded. */
  excludedLines: number;
  /** Counted lines only, in input order. */
  lines: SavingsLine[];
}

function paise(name: string, v: number): number {
  if (!Number.isSafeInteger(v) || v < 0)
    throw new RangeError(`${name} must be a non-negative integer (paise)`);
  return v;
}

/** (MRP − price) × qty, never below 0; null when the line has no printed MRP. */
export function lineMrpSaving(l: Omit<SavingsLineInput, 'itemId'>): number | null {
  if (l.mrpPaise === null || l.mrpPaise <= 0) return null;
  paise('mrpPaise', l.mrpPaise);
  paise('unitPaise', l.unitPaise);
  if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new RangeError('qty must be a positive integer');
  return Math.max(0, l.mrpPaise - l.unitPaise) * l.qty;
}

export function savingsBreakdown(input: {
  lines: readonly SavingsLineInput[];
  couponPaise: number;
  coinsPaise: number;
  deliveryWaivedPaise: number;
}): SavingsBreakdown {
  const couponPaise = paise('couponPaise', input.couponPaise);
  const coinsPaise = paise('coinsPaise', input.coinsPaise);
  const deliveryPaise = paise('deliveryWaivedPaise', input.deliveryWaivedPaise);
  const lines: SavingsLine[] = [];
  let excludedLines = 0;
  for (const l of input.lines) {
    const s = lineMrpSaving(l);
    if (s === null) excludedLines += 1;
    else lines.push({ itemId: l.itemId, mrpSavingPaise: s });
  }
  const mrpPaise = lines.reduce((a, l) => a + l.mrpSavingPaise, 0);
  return {
    mrpPaise,
    couponPaise,
    coinsPaise,
    deliveryPaise,
    totalPaise: mrpPaise + couponPaise + coinsPaise + deliveryPaise,
    countedLines: lines.length,
    excludedLines,
    lines,
  };
}

/** floor(x · min(R, T) / T); everything once anything is refunded on an order that cost nothing (T = 0). */
function share(x: number, refunded: number, total: number): number {
  if (x === 0 || refunded <= 0) return 0;
  if (total <= 0 || refunded >= total) return x;
  return Number((BigInt(x) * BigInt(refunded)) / BigInt(total));
}

/**
 * The (negative) savings to write when a refund of `refundPaise` is processed on an order whose earlier processed
 * refunds add up to `priorRefundedPaise`. Telescoping, so the order of partial refunds never changes the sum.
 */
export function savingsReversal(
  original: SavingsBreakdown,
  r: { priorRefundedPaise: number; refundPaise: number; orderTotalPaise: number },
): SavingsBreakdown {
  const prior = paise('priorRefundedPaise', r.priorRefundedPaise);
  const now = prior + paise('refundPaise', r.refundPaise);
  const total = paise('orderTotalPaise', r.orderTotalPaise);
  const rev = (x: number) => -(share(x, now, total) - share(x, prior, total));
  const lines = original.lines.map((l) => ({ itemId: l.itemId, mrpSavingPaise: rev(l.mrpSavingPaise) }));
  const mrpPaise = lines.reduce((a, l) => a + l.mrpSavingPaise, 0);
  const couponPaise = rev(original.couponPaise);
  const coinsPaise = rev(original.coinsPaise);
  const deliveryPaise = rev(original.deliveryPaise);
  return {
    mrpPaise,
    couponPaise,
    coinsPaise,
    deliveryPaise,
    totalPaise: mrpPaise + couponPaise + coinsPaise + deliveryPaise,
    countedLines: original.countedLines,
    excludedLines: original.excludedLines,
    lines,
  };
}

/** The IST calendar month or year containing `now`, as UTC instants [from, to) and a label (YYYY-MM or YYYY). */
export function savingsPeriodBounds(
  period: SavingsPeriod,
  now: Date,
): { from: Date; to: Date; label: string } {
  const { year, month } = istParts(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (period === 'year')
    return {
      from: istStartOfDay(`${String(year)}-01-01`),
      to: istStartOfDay(`${String(year + 1)}-01-01`),
      label: String(year),
    };
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: istStartOfDay(`${String(year)}-${pad(month)}-01`),
    to: istStartOfDay(`${String(nextYear)}-${pad(nextMonth)}-01`),
    label: `${String(year)}-${pad(month)}`,
  };
}
