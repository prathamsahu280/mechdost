import { computeServiceBill, type EstimateDecision, type EstimateLine } from '@mechdost/shared/service-bill';
import type { ServiceRequestStatus } from '@mechdost/shared/state';

/**
 * Pure views of the workshop portal tabs (partner portals UI upgrade, batch B; design 2026-11-27 § 6). No React and
 * no i18n runtime: the tabs, the job card and the unit tests share them.
 */

/** The tabs of v1 (§ 6.1). Calendar waits for the accepted date and hour on the list rows (§ 6.4, P1). */
export const WORKSHOP_TABS = [
  { key: 'today', path: '/partner/workshop' },
  { key: 'jobs', path: '/partner/workshop/jobs' },
  { key: 'numbers', path: '/partner/workshop/numbers' },
  { key: 'profile', path: '/partner/workshop/profile' },
] as const;
export type WorkshopTab = (typeof WORKSHOP_TABS)[number]['key'];

/** The tab a path opens (query and hash ignored); anything else under the portal is Today. */
export function workshopTabFor(path: string): WorkshopTab {
  const bare = (path.split(/[?#]/)[0] ?? '').replace(/\/$/, '');
  const hit = WORKSHOP_TABS.find((t) => t.key !== 'today' && bare === t.path);
  return hit ? hit.key : 'today';
}

/**
 * Anchors of the one-page portal (before 2026-11-27) that moved to another tab. Today keeps `#new-requests`; a link
 * with one of these hashes is sent on to the tab that now holds the block.
 */
const LEGACY_HASH: Record<string, string> = {
  '#jobs-title': '/partner/workshop/jobs',
  '#completed-jobs': '/partner/workshop/jobs?lane=done',
};
export const legacyWorkshopTarget = (hash: string): string | null => LEGACY_HASH[hash] ?? null;

/** Job lanes (§ 6.1), in this order. */
export const WORKSHOP_LANES = ['proposed', 'confirmed', 'in_workshop', 'ready_bill', 'done'] as const;
export type WorkshopLane = (typeof WORKSHOP_LANES)[number];

const LANE_OF: Partial<Record<ServiceRequestStatus, WorkshopLane>> = {
  proposed: 'proposed',
  confirmed: 'confirmed',
  vehicle_received: 'in_workshop',
  estimate_sent: 'in_workshop',
  approved: 'in_workshop',
  no_work_approved: 'in_workshop',
  in_progress: 'in_workshop',
  ready: 'ready_bill',
  billed: 'ready_bill',
  paid: 'done',
  completed: 'done',
  cancelled: 'done',
  rejected: 'done',
};
export const laneOf = (status: ServiceRequestStatus): WorkshopLane | null => LANE_OF[status] ?? null;

/** A valid `?lane=` wins; otherwise the first lane with work, else the first lane. */
export function pickLane(param: string | null, counts: Record<WorkshopLane, number>): WorkshopLane {
  const asked = WORKSHOP_LANES.find((l) => l === param);
  if (asked) return asked;
  return WORKSHOP_LANES.find((l) => counts[l] > 0) ?? 'proposed';
}

/** A count of a paged list: "20+" when another page exists. */
export const countText = (n: number, more: boolean): string => (more ? `${String(n)}+` : String(n));

/** The six steps of the job card's rail (§ 6.3). */
export const JOB_STEPS = ['received', 'estimate', 'work', 'ready', 'bill', 'paid'] as const;
export type JobStepKey = (typeof JOB_STEPS)[number];

const STEP_OF: Partial<Record<ServiceRequestStatus, number>> = {
  vehicle_received: 0,
  estimate_sent: 1,
  approved: 1,
  no_work_approved: 1,
  in_progress: 2,
  ready: 3,
  billed: 4,
  paid: 5,
  completed: 5,
};

/** The current step (0-based) or null before the vehicle arrives; `allDone` once paid. */
export function jobStep(status: ServiceRequestStatus): { index: number; allDone: boolean } | null {
  const index = STEP_OF[status];
  return index === undefined ? null : { index, allDone: index === JOB_STEPS.length - 1 };
}

/**
 * Totals of an estimate by line state, with tax per line like the bill. "Approved" is exactly the bill's maths
 * (`computeServiceBill`, rounded to the rupee); each group is rounded on its own, so the groups need not add up to
 * the header total.
 */
export function estimateTotals(lines: readonly EstimateLine[]): {
  approvedPaise: number;
  waitingPaise: number;
  declinedPaise: number;
  anyApproved: boolean;
} {
  const total = (d: EstimateDecision) =>
    computeServiceBill(
      lines.filter((l) => l.decision === d).map((l) => ({ ...l, decision: 'approved' as const })),
      { gstRegistered: true },
    ).totalPaise;
  const anyApproved = lines.some((l) => l.decision === 'approved');
  return {
    approvedPaise: anyApproved ? total('approved') : 0,
    waitingPaise: total('pending'),
    declinedPaise: total('declined'),
    anyApproved,
  };
}

const LINE_KEY = {
  approved: 'line_approved',
  pending: 'line_waiting',
  declined: 'line_declined',
} as const satisfies Record<EstimateDecision, string>;
export const lineStateKey = (d: EstimateDecision): (typeof LINE_KEY)[EstimateDecision] => LINE_KEY[d];

/** Today's four tiles (§ 6.1) from the lists the portal already loads. No new API. */
export function workshopKpis(
  fresh: { count: number; more: boolean },
  active: { items: readonly { status: string; waitingForCustomer: boolean }[]; more: boolean },
): Record<'new_requests' | 'waiting_customer' | 'in_workshop' | 'to_bill', string> {
  const lane = (r: { status: string }) => LANE_OF[r.status as ServiceRequestStatus];
  const n = (f: (r: { status: string; waitingForCustomer: boolean }) => boolean) =>
    countText(active.items.filter(f).length, active.more);
  return {
    new_requests: countText(fresh.count, fresh.more),
    // Each tile counts exactly the lane it links to (builder ruling 2026-11-27, decisions.md).
    waiting_customer: n((r) => lane(r) === 'proposed'),
    in_workshop: n((r) => lane(r) === 'in_workshop'),
    to_bill: n((r) => lane(r) === 'ready_bill'),
  };
}

/** One proposal hour chip: the time and its free places. */
export const hourChip = (s: {
  hour: number;
  free: number;
}): { time: string; full: boolean; free: number } => ({
  time: `${String(s.hour).padStart(2, '0')}:00`,
  full: s.free <= 0,
  free: Math.max(0, s.free),
});
