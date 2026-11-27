/**
 * Rider numbers for the earnings card (design 2026-11-27 "Partner portals UI upgrade" § 7). Pure functions:
 * `test/rider-earnings-view.test.ts`.
 */

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });

/** `YYYY-MM-DD` of an instant in IST. */
export function istDay(at: Date | number | string): string {
  return IST_DAY.format(new Date(at));
}

/** `days` IST days ending on the IST day of `now`, oldest first, each with how many of `instants` fell on it. */
export function dailyCounts(instants: readonly string[], days: number, now: number) {
  const out: { date: string; delivered: number }[] = [];
  const byDay = new Map<string, number>();
  for (const at of instants) byDay.set(istDay(at), (byDay.get(istDay(at)) ?? 0) + 1);
  for (let i = days - 1; i >= 0; i--) {
    const date = istDay(now - i * 86_400_000);
    out.push({ date, delivered: byDay.get(date) ?? 0 });
  }
  return { days: out, totalDelivered: out.reduce((n, d) => n + d.delivered, 0) };
}

/**
 * Net paid per payout period (corrections included, so a ₹50 payment and its −₹50 correction net to ₹0), oldest
 * period first, for the money-green bars. The rows themselves stay listed (a correction is never hidden).
 */
export function payoutBars(payouts: readonly { periodFrom: string; amountPaise: number }[]) {
  const byPeriod = new Map<string, number>();
  for (const p of payouts) byPeriod.set(p.periodFrom, (byPeriod.get(p.periodFrom) ?? 0) + p.amountPaise);
  return [...byPeriod.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value: Math.max(0, value) }));
}

/** History rows grouped by IST day (newest day first, rows kept in their order); `label` = the day for the section. */
export function groupByIstDay<T extends { updatedAt: string }>(rows: readonly T[]) {
  const groups: { day: string; label: string; items: T[] }[] = [];
  for (const row of rows) {
    const day = istDay(row.updatedAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(row);
    else groups.push({ day, label: day, items: [row] });
  }
  return groups;
}
