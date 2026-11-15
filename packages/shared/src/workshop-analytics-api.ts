/**
 * Workshop analytics (spec 08 "Analytics → Workshops", spec 07 "Performance"; design 2026-11-15): the response shapes
 * of `GET /v1/admin/analytics/workshops` and `GET /v1/workshop/analytics`, and the pure rates derived from the counts
 * (the API's city medians and the screens share them). Every number is an integer: counts, minutes, paise, and the
 * rating in tenths (47 = 4.7). No customer data: counts, codes and workshop names (admin only; the portal never
 * carries another workshop's name).
 */
import { z } from 'zod';

const Count = z.number().int().min(0);
const Paise = z.number().int().min(0);
const Minutes = z.number().int().min(0).nullable();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ReasonCount = z.object({ code: z.string(), count: Count });

/** One workshop's counts for a range (requests created in the range; declined offers counted for the decliner). */
export const WorkshopStatsDto = z.object({
  /** Requests the workshop received: assigned to it now, plus those it declined (a declined request moves on). */
  requests: Count,
  byMode: z.object({ workshop: Count, home: Count }),
  /** Requests that reached each step (from the append-only timeline); cancelled ones keep the steps they reached. */
  funnel: z.object({
    requested: Count,
    proposed: Count,
    confirmed: Count,
    received: Count,
    estimateSent: Count,
    approved: Count,
    completed: Count,
  }),
  cancelled: Count,
  cancelReasons: z.array(ReasonCount),
  rejected: Count,
  rejectReasons: z.array(ReasonCount),
  /** Answered offers: a slot and cost proposed, or the request declined (there is no timeout for workshops). */
  offersProposed: Count,
  offersDeclined: Count,
  medianMinutesToPropose: Minutes,
  medianMinutesToEstimate: Minutes,
  medianMinutesJob: Minutes,
  /** Requests with an estimate; of those, with at least one declined line (latest version). */
  estimates: Count,
  estimatesWithDeclinedLine: Count,
  linesSent: Count,
  linesApproved: Count,
  /** Quantity x unit price before GST, of the latest estimate versions. */
  linesSentPaise: Paise,
  linesApprovedPaise: Paise,
  billed: Count,
  billedPaise: Paise,
  /** Home visit fees kept (not waived) on requests that were billed. */
  visitFeesPaise: Paise,
  /** Bills marked paid at the workshop by method; services are not paid online yet. */
  paidCash: Count,
  paidUpi: Count,
  paidCard: Count,
  billsUnpaid: Count,
  ratingTenths: z.number().int().min(10).max(50).nullable(),
  ratingCount: Count,
  /** Completed jobs, and of those, a new request by the same customer for the same vehicle within 30 days. */
  completedJobs: Count,
  returnedWithin30Days: Count,
  /** Requests where the vehicle was received, and of those with at least one photo attached. */
  withPhotos: Count,
});
export type WorkshopStats = z.infer<typeof WorkshopStatsDto>;

/** Rates shown next to the counts, as whole percents (null when there is nothing to divide by). */
export interface WorkshopRates {
  acceptancePercent: number | null;
  approvalPercent: number | null;
  declinedLinePercent: number | null;
  averageBillPaise: number | null;
  returnedPercent: number | null;
  photosPercent: number | null;
}

const share = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part * 100) / whole) : null;

export function workshopRates(s: WorkshopStats): WorkshopRates {
  return {
    acceptancePercent: share(s.offersProposed, s.offersProposed + s.offersDeclined),
    approvalPercent: share(s.linesApproved, s.linesSent),
    declinedLinePercent: share(s.estimatesWithDeclinedLine, s.estimates),
    averageBillPaise: s.billed > 0 ? Math.round(s.billedPaise / s.billed) : null,
    returnedPercent: share(s.returnedWithin30Days, s.completedJobs),
    photosPercent: share(s.withPhotos, s.funnel.received),
  };
}

/** The metrics a city median is given for (the median of workshops that have data for it). */
export const WORKSHOP_MEDIAN_KEYS = [
  'requests',
  'acceptancePercent',
  'minutesToPropose',
  'minutesToEstimate',
  'minutesJob',
  'approvalPercent',
  'averageBillPaise',
  'ratingTenths',
  'returnedPercent',
  'photosPercent',
] as const;
export type WorkshopMedianKey = (typeof WORKSHOP_MEDIAN_KEYS)[number];

const MedianValue = z.number().int().min(0).nullable();
export const WorkshopMediansDto = z.object({
  /** Workshops with at least one request in the range; medians are given only from three of them (anonymity). */
  workshops: Count,
  values: z.object({
    requests: MedianValue,
    acceptancePercent: MedianValue,
    minutesToPropose: MedianValue,
    minutesToEstimate: MedianValue,
    minutesJob: MedianValue,
    approvalPercent: MedianValue,
    averageBillPaise: MedianValue,
    ratingTenths: MedianValue,
    returnedPercent: MedianValue,
    photosPercent: MedianValue,
  }),
});
export type WorkshopMedians = z.infer<typeof WorkshopMediansDto>;

/** Medians are shown only when at least this many workshops have data (a median of one or two names a workshop). */
export const WORKSHOP_MEDIAN_MIN = 3;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const low = sorted[mid - 1] ?? 0;
  const high = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? high : Math.round((low + high) / 2);
}

/**
 * City medians over the workshops that had requests in the range. Anonymity (security review 2026-11-15): each
 * metric needs at least `WORKSHOP_MEDIAN_MIN` workshops that have that figure, else it is null; and `excludeId` (the
 * asking workshop in its portal) is left out, so a workshop cannot combine its own figure with the median to work back
 * to another workshop's.
 */
export function workshopMedians(
  all: readonly (WorkshopStats & { id?: string })[],
  opts: { excludeId?: string } = {},
): WorkshopMedians {
  const active = all.filter(
    (s) => s.requests > 0 && (opts.excludeId === undefined || s.id !== opts.excludeId),
  );
  const rates = active.map((s) => ({ s, r: workshopRates(s) }));
  const pick = (f: (x: { s: WorkshopStats; r: WorkshopRates }) => number | null) => {
    const values = rates.map(f).filter((v): v is number => v !== null);
    return values.length < WORKSHOP_MEDIAN_MIN ? null : median(values);
  };
  return {
    workshops: active.length,
    values: {
      requests: pick(({ s }) => s.requests),
      acceptancePercent: pick(({ r }) => r.acceptancePercent),
      minutesToPropose: pick(({ s }) => s.medianMinutesToPropose),
      minutesToEstimate: pick(({ s }) => s.medianMinutesToEstimate),
      minutesJob: pick(({ s }) => s.medianMinutesJob),
      approvalPercent: pick(({ r }) => r.approvalPercent),
      averageBillPaise: pick(({ r }) => r.averageBillPaise),
      ratingTenths: pick(({ s }) => s.ratingTenths),
      returnedPercent: pick(({ r }) => r.returnedPercent),
      photosPercent: pick(({ r }) => r.photosPercent),
    },
  };
}

const RangeDto = z.object({ from: Day, to: Day, days: z.number().int().min(1).max(180) });
const Named = { name: z.string(), nameHi: z.string().nullable() };

export const AdminWorkshopAnalyticsDto = z.object({
  range: RangeDto,
  city: z.string(),
  cities: z.array(z.object({ code: z.string(), ...Named })),
  totals: WorkshopStatsDto,
  medians: WorkshopMediansDto,
  workshops: z.array(WorkshopStatsDto.extend({ id: z.string(), ...Named })),
});
export type AdminWorkshopAnalytics = z.infer<typeof AdminWorkshopAnalyticsDto>;

export const PortalWorkshopAnalyticsDto = z.object({
  range: RangeDto,
  workshop: z.object({ id: z.string(), ...Named }),
  stats: WorkshopStatsDto,
  /** Anonymised city medians for the same range; the values are null below three workshops with data. */
  cityMedians: WorkshopMediansDto,
});
export type PortalWorkshopAnalytics = z.infer<typeof PortalWorkshopAnalyticsDto>;
