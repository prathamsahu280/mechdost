import { shiftDate } from '@mechdost/shared/analytics-range';
import {
  ORDER_CANCEL_REASONS,
  ORDER_REJECT_REASONS,
  type OrderCancelReason,
  type OrderRejectReason,
} from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';

/**
 * Pure view helpers for Admin → Analytics (spec 08 "Analytics"): date presets in IST, percentages, funnel rows,
 * chart ticks, number and duration formatting, reason labels and localised names. No React, no Zod.
 */
export type RangePreset = 7 | 30 | 90;

/** The last `days` IST calendar days, ending today. */
export function rangePreset(days: RangePreset, now: Date): { from: string; to: string } {
  const to = istDateString(now);
  return { from: shiftDate(to, -(days - 1)), to };
}

/** Whole percentage of `part` in `whole`; null when `whole` is 0 (no "0 %" from nothing). */
export function sharePercent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 100) / whole) : null;
}

/** Visitor steps (distinct visitor ids) and order steps (orders) are different units: never divided across. */
const VISITOR_STEPS = new Set(['product_view', 'add_to_cart', 'checkout_started']);

export interface FunnelRow<S extends string> {
  step: S;
  count: number;
  /** % of the previous step when both count the same thing (visitors or orders); null otherwise. */
  ofPrevious: number | null;
  /** Bar width, % of the largest step. */
  width: number;
}

export function funnelRows<S extends string>(funnel: readonly { step: S; count: number }[]): FunnelRow<S>[] {
  const max = Math.max(0, ...funnel.map((f) => f.count));
  return funnel.map((f, i) => {
    const prev = i > 0 ? funnel[i - 1] : undefined;
    const sameUnit = prev !== undefined && VISITOR_STEPS.has(prev.step) === VISITOR_STEPS.has(f.step);
    return {
      step: f.step,
      count: f.count,
      ofPrevious: prev && sameUnit ? (sharePercent(f.count, prev.count) ?? 0) : null,
      width: max > 0 ? Math.round((f.count * 100) / max) : 0,
    };
  });
}

/** The smallest 1, 2 or 5 × 10ⁿ that is ≥ x (whole numbers only: counts and paise). */
function niceStep(x: number): number {
  if (x <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * power >= x) return m * power;
  return 10 * power;
}

/** Axis ticks from 0: two round steps covering the largest value (calm axes, one gridline in between). */
export function chartTicks(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return [0, 1];
  const step = niceStep(max / 2);
  return [0, step, step * 2];
}

/** A count with Indian digit grouping (12,34,567), Latin digits in both languages like the rest of the site. */
export function formatCount(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { numberingSystem: 'latn' }).format(n);
}

/** A duration as one unit for the locale strings: seconds under a minute, minutes under an hour, then hours. */
export function durationParts(seconds: number): { unit: 's' | 'min' | 'h'; value: number } {
  if (seconds < 60) return { unit: 's', value: Math.round(seconds) };
  if (seconds < 3600) return { unit: 'min', value: Math.round(seconds / 60) };
  return { unit: 'h', value: Math.round(seconds / 3600) };
}

/** "1 Nov" for an IST calendar date (YYYY-MM-DD). */
export function shortDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${date}T12:00:00+05:30`));
}

const CANCEL: readonly string[] = ORDER_CANCEL_REASONS;
const REJECT: readonly string[] = ORDER_REJECT_REASONS;
const isCancel = (code: string): code is OrderCancelReason => CANCEL.includes(code);
const isReject = (code: string): code is OrderRejectReason => REJECT.includes(code);

/** The `order` namespace key for a cancel/reject reason code; codes the web does not know read as "other". */
export function reasonLabelKey(
  kind: 'cancelled' | 'rejected',
  code: string,
): `cancelReason_${OrderCancelReason}` | `rejectReason_${OrderRejectReason}` {
  if (kind === 'cancelled') return `cancelReason_${isCancel(code) ? code : 'other'}`;
  return `rejectReason_${isReject(code) ? code : 'other'}`;
}

/** Hindi name on /hi when there is one (hard rule 10), else the English name. */
export function localName(row: { name: string; nameHi: string | null }, locale: string): string {
  return locale === 'hi' && row.nameHi ? row.nameHi : row.name;
}
