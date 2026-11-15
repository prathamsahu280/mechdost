/**
 * Shop performance (design 2026-11-15, item 6; spec 07): how a shop did over the last 30 or 90 days next to the
 * anonymous median of the other shops in its city. Zod-free, pure, shared by the repository and the portal.
 *
 * Anonymity (same rules as the workshop benchmark, decisions "Workshop benchmark anonymity"): the median leaves out
 * every shop the owner holds, and a metric is shown only when at least `SHOP_BENCHMARK_MIN` other shops have a value
 * for it; below that it is hidden rather than computed from a handful. Nothing identifies another shop.
 */

export const PERFORMANCE_WINDOWS = [30, 90] as const;
export type PerformanceWindow = (typeof PERFORMANCE_WINDOWS)[number];

/** A metric needs this many OTHER shops with data before the city median is shown. */
export const SHOP_BENCHMARK_MIN = 5;

/** "On time" = packed and handed over within this many hours of accepting the order (queued as Q116: admin setting). */
export const SHOP_ON_TIME_HOURS = 24;

/** The raw counts of one shop (or the sum of an owner's shops) over a window. */
export interface ShopCounts {
  /** Offers the shop answered: accepted + declined + expired (open and withdrawn offers do not count). */
  accepted: number;
  declined: number;
  expired: number;
  /** Orders accepted and then given up (a subset of the accepted ones). */
  givenUp: number;
  /** Seconds from offer to accept, one per accepted offer. */
  acceptSeconds: number[];
  /** Accepted orders whose hand-over window has ended (or that were handed over), and how many made it. */
  due: number;
  onTime: number;
  ratingSum: number;
  ratingCount: number;
}

export interface ShopMetrics {
  offers: number;
  /** Basis points (10000 = 100 %), null when there is nothing to measure. */
  acceptanceBp: number | null;
  medianAcceptSeconds: number | null;
  giveUps: number;
  giveUpBp: number | null;
  onTimeBp: number | null;
  /** Average stars × 100 (450 = 4.5), null without reviews. */
  ratingX100: number | null;
  ratingCount: number;
}

export type Benchmark = Omit<ShopMetrics, 'offers' | 'giveUps' | 'ratingCount'>;

export const emptyCounts = (): ShopCounts => ({
  accepted: 0,
  declined: 0,
  expired: 0,
  givenUp: 0,
  acceptSeconds: [],
  due: 0,
  onTime: 0,
  ratingSum: 0,
  ratingCount: 0,
});

export function addCounts(a: ShopCounts, b: ShopCounts): ShopCounts {
  return {
    accepted: a.accepted + b.accepted,
    declined: a.declined + b.declined,
    expired: a.expired + b.expired,
    givenUp: a.givenUp + b.givenUp,
    acceptSeconds: [...a.acceptSeconds, ...b.acceptSeconds],
    due: a.due + b.due,
    onTime: a.onTime + b.onTime,
    ratingSum: a.ratingSum + b.ratingSum,
    ratingCount: a.ratingCount + b.ratingCount,
  };
}

const bp = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part * 10_000) / whole);

/** Median of whole numbers (the mean of the two middle values when even), rounded; null for no values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  const low = sorted[mid - 1];
  const high = sorted[mid];
  if (high === undefined) return null;
  return sorted.length % 2 === 1 || low === undefined ? high : Math.round((low + high) / 2);
}

export function metricsOf(c: ShopCounts): ShopMetrics {
  const answered = c.accepted + c.declined + c.expired;
  return {
    offers: answered,
    acceptanceBp: bp(c.accepted, answered),
    medianAcceptSeconds: median(c.acceptSeconds),
    giveUps: c.givenUp,
    giveUpBp: bp(c.givenUp, c.accepted),
    onTimeBp: bp(c.onTime, c.due),
    ratingX100: c.ratingCount === 0 ? null : Math.round((c.ratingSum * 100) / c.ratingCount),
    ratingCount: c.ratingCount,
  };
}

/**
 * The anonymous city median per metric from OTHER shops' metrics (the caller already left out all of the owner's
 * shops). A metric with fewer than `SHOP_BENCHMARK_MIN` other values is null.
 */
export function benchmarkOf(others: readonly ShopMetrics[]): Benchmark {
  const pick = (get: (m: ShopMetrics) => number | null): number | null => {
    const values = others.map(get).filter((v): v is number => v !== null);
    return values.length < SHOP_BENCHMARK_MIN ? null : median(values);
  };
  return {
    acceptanceBp: pick((m) => m.acceptanceBp),
    medianAcceptSeconds: pick((m) => m.medianAcceptSeconds),
    giveUpBp: pick((m) => m.giveUpBp),
    onTimeBp: pick((m) => m.onTimeBp),
    ratingX100: pick((m) => m.ratingX100),
  };
}
