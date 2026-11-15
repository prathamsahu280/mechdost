import { workshopRates, type WorkshopStats } from '@mechdost/shared/workshop-analytics-api';
import {
  SERVICE_CANCEL_REASONS,
  SERVICE_REJECT_REASONS,
  type ServiceCancelReason,
  type ServiceRejectReason,
} from '@mechdost/shared/state';

/**
 * Pure view helpers for the workshop analytics screens (admin "Workshops" tab, portal "Performance"; design
 * 2026-11-15): the funnel rows, the sortable workshops table, reason labels and the comparison with the city median.
 * No React, no Zod runtime beyond the shared rate helpers.
 */
export const FUNNEL_STEPS = [
  'requested',
  'proposed',
  'confirmed',
  'received',
  'estimateSent',
  'approved',
  'completed',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelBar {
  step: FunnelStep;
  count: number;
  /** % of the step before (null for the first; never above 100: a later step cannot exceed an earlier one). */
  ofPrevious: number | null;
  /** Bar width, % of the first step. */
  width: number;
}

export function funnelBars(stats: WorkshopStats): FunnelBar[] {
  const top = stats.funnel.requested;
  return FUNNEL_STEPS.map((step, i) => {
    const count = stats.funnel[step];
    const prev = i > 0 ? stats.funnel[FUNNEL_STEPS[i - 1] ?? 'requested'] : 0;
    return {
      step,
      count,
      ofPrevious: i > 0 && prev > 0 ? Math.min(100, Math.round((count * 100) / prev)) : null,
      width: top > 0 ? Math.min(100, Math.round((count * 100) / top)) : 0,
    };
  });
}

/** Locale key suffix of a cancel or reject reason; codes the web does not know read as "other". */
export function reasonKey(
  kind: 'cancelled' | 'rejected',
  code: string,
): `cancel_${ServiceCancelReason}` | `reject_${ServiceRejectReason}` {
  if (kind === 'cancelled') return `cancel_${SERVICE_CANCEL_REASONS.find((c) => c === code) ?? 'other'}`;
  return `reject_${SERVICE_REJECT_REASONS.find((c) => c === code) ?? 'other'}`;
}

export const SORT_KEYS = [
  'name',
  'requests',
  'acceptance',
  'propose',
  'approval',
  'bill',
  'rating',
  'returned',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

interface Row extends WorkshopStats {
  name: string;
}

function valueOf(row: Row, key: Exclude<SortKey, 'name'>): number | null {
  const r = workshopRates(row);
  switch (key) {
    case 'requests':
      return row.requests;
    case 'acceptance':
      return r.acceptancePercent;
    case 'propose':
      return row.medianMinutesToPropose;
    case 'approval':
      return r.approvalPercent;
    case 'bill':
      return r.averageBillPaise;
    case 'rating':
      return row.ratingTenths;
    case 'returned':
      return r.returnedPercent;
  }
}

/** Rows sorted by a column; workshops without a value for it always come last, ties by name. */
export function sortWorkshops<T extends Row>(rows: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name);
    const x = valueOf(a, key);
    const y = valueOf(b, key);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return x === y ? a.name.localeCompare(b.name) : sign * (x - y);
  });
}

/** A rating in tenths as "4.7". */
export function ratingText(tenths: number): string {
  return (tenths / 10).toFixed(1);
}
