/**
 * DEMO workshop jobs (spec 06): odometer, itemised estimates, the customer's per-line decision, work, bill and
 * payment at the workshop. Kept out of `store.ts` so the shop pages, which load the store for the cart, do not load
 * the bill maths (JS budget, hard rule 6).
 */
import { computeServiceBill, estimateLineError, ESTIMATE_MAX_LINES } from '@mechdost/shared/service-bill';
import {
  requestsSnapshot,
  requestStage,
  stageAt,
  updateRequest,
  type DemoEstimateLine,
  type DemoServiceRequest,
  type RequestStage,
} from './store';
import { workshopGstRegistered } from './workshops';

/**
 * Demo control: performs the workshop's next real action with sample values, so the customer page, the workshop
 * portal and the admin agree (as advanceOrder does, review B12). The customer's own choices (accepting a proposal,
 * approving the estimate) are never simulated: the control does nothing at those stages.
 */
export function advanceRequest(code: string) {
  updateRequest(code, (r) => {
    const now = new Date().toISOString();
    switch (requestStage(r)) {
      case 'requested': {
        const minPaise = r.services.reduce((s, x) => s + x.minPaise, 0);
        const maxPaise = r.services.reduce((s, x) => s + x.maxPaise, 0);
        return {
          ...r,
          stage: stageAt('proposed'),
          proposal: { date: r.date, slot: r.slot, minPaise, maxPaise, note: '' },
        };
      }
      case 'confirmed':
        return { ...r, stage: stageAt('received') };
      case 'received':
        return withEstimate(
          r,
          r.services.map((x) => ({
            description: x.name,
            serviceKey: x.key,
            qty: 1,
            unitPaise: Math.round((x.minPaise + x.maxPaise) / 200) * 100,
            gstRateBp: 1800,
          })),
          now,
        );
      case 'approved':
        return { ...r, stage: stageAt('in_progress') };
      case 'in_progress':
        return { ...r, stage: stageAt('ready') };
      case 'ready':
        return withBill(r, now);
      case 'billed':
        return r.bill ? { ...r, stage: stageAt('completed'), bill: { ...r.bill, paidAt: now } } : null;
      case 'no_work_approved':
        return { ...r, stage: stageAt('completed'), closedAt: now };
      default:
        return null;
    }
  });
}

export const MAX_ODOMETER_KM = 2_000_000;

/** The highest reading recorded for this vehicle on this device's other requests (an odometer never goes back). */
export function lastOdometerKm(r: DemoServiceRequest): number {
  const same = (x: DemoServiceRequest) =>
    x.code !== r.code &&
    x.customer.phone === r.customer.phone &&
    x.vehicle.trim().toLowerCase() === r.vehicle.trim().toLowerCase();
  return Math.max(
    0,
    ...requestsSnapshot()
      .filter(same)
      .map((x) => x.odometerKm ?? 0),
  );
}

/** Workshop: the vehicle is in, with its odometer reading (spec 06: confirmed -> vehicle_received, >= last). */
export function receiveVehicle(code: string, workshopSlug: string, odometerKm: number): boolean {
  return updateRequest(code, (r) =>
    r.workshopSlug === workshopSlug &&
    requestStage(r) === 'confirmed' &&
    Number.isInteger(odometerKm) &&
    odometerKm >= lastOdometerKm(r) &&
    odometerKm <= MAX_ODOMETER_KM
      ? { ...r, stage: stageAt('received'), odometerKm }
      : null,
  );
}

/** Stages from which the workshop may send an estimate or a revision (canonical machine). */
const ESTIMATE_FROM: readonly RequestStage[] = ['received', 'approved', 'in_progress', 'no_work_approved'];

export type NewEstimateLine = Omit<DemoEstimateLine, 'id' | 'decision'>;
/** The analytics catalogue counts versions up to 99. */
export const ESTIMATE_MAX_VERSIONS = 99;

/** A new estimate version: every decision back to pending, so earlier approvals never carry over. */
function withEstimate(
  r: DemoServiceRequest,
  lines: readonly NewEstimateLine[],
  now: string,
): DemoServiceRequest | null {
  const registered = workshopGstRegistered(r.workshopSlug);
  const version = (r.estimate?.version ?? 0) + 1;
  if (version > ESTIMATE_MAX_VERSIONS) return null;
  const next: DemoEstimateLine[] = lines.map((l, i) => ({
    ...l,
    description: l.description.trim(),
    gstRateBp: registered ? l.gstRateBp : 0,
    id: `v${String(version)}-${String(i + 1)}`,
    decision: 'pending',
  }));
  if (
    next.length < 1 ||
    next.length > ESTIMATE_MAX_LINES ||
    next.some((l) => estimateLineError(l) !== null)
  ) {
    return null;
  }
  return {
    ...r,
    stage: stageAt('estimate_sent'),
    estimate: { version, sentAt: now, lines: next, decidedAt: null },
  };
}

/** Workshop sends the itemised estimate, or a revision of it (new version, approvals cleared). */
export function sendEstimate(code: string, workshopSlug: string, lines: readonly NewEstimateLine[]): boolean {
  return updateRequest(code, (r) =>
    r.workshopSlug === workshopSlug && ESTIMATE_FROM.includes(requestStage(r))
      ? withEstimate(r, lines, new Date().toISOString())
      : null,
  );
}

/**
 * Customer approves or declines every line of the current version, with consent (spec 06). At least one approved
 * line -> approved; none -> no work approved. A stale version (the workshop revised meanwhile) is refused.
 */
export function decideEstimate(
  code: string,
  version: number,
  decisions: Readonly<Record<string, 'approved' | 'declined'>>,
  consent: boolean,
): 'approved' | 'no_work_approved' | null {
  let outcome: 'approved' | 'no_work_approved' | null = null;
  updateRequest(code, (r) => {
    const est = r.estimate;
    if (!consent || !est || requestStage(r) !== 'estimate_sent' || est.version !== version) return null;
    const lines = est.lines.map((l) => ({ ...l, decision: decisions[l.id] ?? l.decision }));
    if (lines.some((l) => l.decision === 'pending')) return null;
    const result = lines.some((l) => l.decision === 'approved') ? 'approved' : 'no_work_approved';
    outcome = result;
    return {
      ...r,
      stage: stageAt(result),
      estimate: { ...est, lines, decidedAt: new Date().toISOString() },
    };
  });
  return outcome;
}

function withBill(r: DemoServiceRequest, now: string): DemoServiceRequest | null {
  if (!r.estimate) return null;
  const bill = computeServiceBill(r.estimate.lines, { gstRegistered: workshopGstRegistered(r.workshopSlug) });
  const keys = new Map(r.estimate.lines.map((l) => [l.id, l.serviceKey]));
  return {
    ...r,
    stage: stageAt('billed'),
    bill: {
      ...bill,
      lines: bill.lines.map((l) => ({ ...l, serviceKey: keys.get(l.id) })),
      billedAt: now,
      paidAt: null,
    },
  };
}

export type WorkshopStep = 'start' | 'ready' | 'bill' | 'paid' | 'return';
const STEP_FROM: Record<WorkshopStep, RequestStage> = {
  start: 'approved',
  ready: 'in_progress',
  bill: 'ready',
  paid: 'billed',
  return: 'no_work_approved',
};

/** Workshop job steps after approval: start -> ready -> bill -> paid at the workshop; or return with no work. */
export function workshopStep(code: string, workshopSlug: string, step: WorkshopStep): boolean {
  return updateRequest(code, (r) => {
    if (r.workshopSlug !== workshopSlug || requestStage(r) !== STEP_FROM[step]) return null;
    const now = new Date().toISOString();
    switch (step) {
      case 'start':
        return { ...r, stage: stageAt('in_progress') };
      case 'ready':
        return { ...r, stage: stageAt('ready') };
      case 'bill':
        return withBill(r, now);
      case 'paid':
        return r.bill ? { ...r, stage: stageAt('completed'), bill: { ...r.bill, paidAt: now } } : null;
      case 'return':
        return { ...r, stage: stageAt('completed'), closedAt: now };
    }
  });
}
