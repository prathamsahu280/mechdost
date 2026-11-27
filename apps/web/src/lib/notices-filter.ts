/**
 * Notification centre filter chips and day groups (Ustaad UI upgrade U4, design § 3.9). Pure: the centre reads the
 * filter from `?filter=` (URL state, Back works) and groups the already-loaded rows by IST calendar day.
 */

export const NOTICE_FILTERS = ['all', 'ustaad', 'orders', 'service'] as const;
export type NoticeFilter = (typeof NOTICE_FILTERS)[number];

/** Kind families (the part before the first dot of a notice kind, `notice-catalogue.ts`). */
const FAMILIES: Record<Exclude<NoticeFilter, 'all'>, readonly string[]> = {
  ustaad: ['ustaad'],
  orders: ['order', 'payment', 'refund', 'delivery', 'cod'],
  service: ['service', 'quote', 'rsa'],
};

export function noticeFilterOf(raw: string | null | undefined): NoticeFilter {
  return (NOTICE_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as NoticeFilter) : 'all';
}

export function passesFilter(kind: string, filter: NoticeFilter): boolean {
  if (filter === 'all') return true;
  const family = kind.split('.')[0] ?? '';
  return FAMILIES[filter].includes(family);
}

export type DayGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Whole IST calendar days since the epoch (business days are IST, CLAUDE.md conventions). */
function istDay(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

export function dayGroup(iso: string, now: Date): DayGroup {
  const diff = istDay(now) - istDay(new Date(iso));
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return diff < 7 ? 'thisWeek' : 'earlier';
}

/** Consecutive runs of the same group, keeping the feed's newest-first order. */
export function groupByDay<T extends { createdAt: string }>(
  rows: readonly T[],
  now: Date,
): { group: DayGroup; items: T[] }[] {
  const out: { group: DayGroup; items: T[] }[] = [];
  for (const row of rows) {
    const group = dayGroup(row.createdAt, now);
    const last = out.at(-1);
    if (last?.group === group) last.items.push(row);
    else out.push({ group, items: [row] });
  }
  return out;
}
