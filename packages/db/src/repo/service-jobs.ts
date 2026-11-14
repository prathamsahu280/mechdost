import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { computeServiceBill, estimateLineError, type EstimateLine } from '@mechdost/shared/service-bill';
import type { SendEstimateInput, ServicePaymentMethod, ServiceSlot } from '@mechdost/shared/service-requests';
import type { ServiceDeclineReason, ServiceRequestStatus } from '@mechdost/shared/state';
import {
  estimateItems,
  estimates,
  serviceBills,
  serviceProposals,
  serviceRequests,
  vehicles,
  workshops,
} from '../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { queueServiceWhatsApp } from './service-notifications';
import {
  assertBookableDate,
  ESTIMATE_FROM,
  loadRequestView,
  lockRequest,
  pageSummaries,
  requireStatus,
  transitionRequest,
  type ServiceLocale,
  type RequestCore,
} from './service-requests';
import { num, rowsOf } from './sql-rows';

/**
 * The workshop's job card (spec 06): propose a slot and expected cost or decline (back to MechDost), receive the
 * vehicle with its odometer, send itemised estimates (a new revision clears every approval), start and finish only
 * approved work, bill the approved lines (GST by the workshop's registration, rupee round-off) and record payment at
 * the workshop; a job with no approved work closes when the vehicle goes back. Every query is scoped to the
 * workshops in the caller's grants: another workshop's request is 404.
 */
const inWorkshops = (ids: readonly string[]): SQL =>
  ids.length === 0 ? sql`false` : inArray(serviceRequests.workshopId, [...ids]);

const inWorkshopsRaw = (ids: readonly string[]): SQL =>
  ids.length === 0
    ? sql`false`
    : sql`r.workshop_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`;

export type WorkshopView = 'new' | 'active' | 'done';

const ACTIVE: readonly ServiceRequestStatus[] = [
  'proposed',
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
  'billed',
  'paid',
];
const list = (statuses: readonly string[]) => sql.raw(statuses.map((s) => `'${s}'`).join(','));

/** New requests and the live job list (newest first, paged); done = completed or cancelled in the last 90 days. */
export async function listWorkshopRequests(
  db: Tx,
  workshopIds: readonly string[],
  view: WorkshopView,
  page: { cursor?: string | null; limit?: number },
  locale: ServiceLocale,
) {
  const status =
    view === 'new'
      ? sql`r.status = 'awaiting_workshop'`
      : view === 'active'
        ? sql`r.status in (${list(ACTIVE)})`
        : sql`r.status in ('completed', 'cancelled') and r.updated_at > now() - interval '90 days'`;
  return pageSummaries(
    db,
    sql`${inWorkshopsRaw(workshopIds)} and ${status}`,
    view === 'done' ? 'updated_at' : 'created_at',
    page,
    locale,
  );
}

const byCode = (workshopIds: readonly string[], code: string) =>
  and(eq(serviceRequests.code, code), inWorkshops(workshopIds));

export async function getWorkshopRequest(
  db: Tx,
  workshopIds: readonly string[],
  code: string,
  locale: ServiceLocale,
) {
  const [r] = await db
    .select({ id: serviceRequests.id })
    .from(serviceRequests)
    .where(byCode(workshopIds, code));
  if (!r) throw new NotFoundError('Service request not found');
  return loadRequestView(db, r.id, 'workshop', locale);
}

interface StepInput {
  workshopIds: readonly string[];
  code: string;
  expectedVersion: number;
  staffUserId: string;
}

/** Lock the request (first), then make sure its workshop may still work (paused/suspended take no new work). */
async function jobFor(tx: Tx, input: StepInput, opts: { newWork?: boolean } = {}): Promise<RequestCore> {
  const r = await lockRequest(tx, byCode(input.workshopIds, input.code));
  if (opts.newWork && r.workshopId) {
    const [w] = await tx
      .select({ status: workshops.status })
      .from(workshops)
      .where(eq(workshops.id, r.workshopId))
      .for('share');
    if (w?.status !== 'approved')
      throw new ForbiddenError(
        'Your workshop is paused or suspended and cannot take new requests',
        'WORKSHOP_NOT_ACTIVE',
      );
  }
  return r;
}

/** The workshop of a request a workshop is acting on (always set from awaiting_workshop on; CHECK enforced). */
function workshopOf(r: RequestCore): string {
  if (!r.workshopId) throw new ConflictError('This request has no workshop', 'NO_WORKSHOP');
  return r.workshopId;
}

const workshopActor = (userId: string) => ({ type: 'workshop' as const, userId });

/** Propose a date, part of the day and expected cost range (awaiting_workshop → proposed). */
export async function proposeSlot(
  db: Tx,
  input: StepInput & {
    date: string;
    slot: ServiceSlot;
    lowPaise: number;
    highPaise: number;
    note: string | null;
  },
) {
  if (input.highPaise < input.lowPaise) throw new ValidationError('High is below low', 'RANGE');
  assertBookableDate(input.date, 60);
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input, { newWork: true });
    requireStatus(r, ['awaiting_workshop']);
    const out = await transitionRequest(tx, {
      request: r,
      to: 'proposed',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      payload: { date: input.date, slot: input.slot, lowPaise: input.lowPaise, highPaise: input.highPaise },
    });
    await tx.insert(serviceProposals).values({
      requestId: r.id,
      workshopId: workshopOf(r),
      proposedDate: input.date,
      slot: input.slot,
      lowPaise: input.lowPaise,
      highPaise: input.highPaise,
      note: input.note,
      createdBy: input.staffUserId,
    });
    return out;
  });
}

/** Decline with a reason code: the request goes back to MechDost (needs_routing) and leaves this workshop. */
export async function declineRequest(db: Tx, input: StepInput & { reasonCode: ServiceDeclineReason }) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ['awaiting_workshop']);
    const declinedBy = r.workshopId;
    return transitionRequest(tx, {
      request: r,
      to: 'needs_routing',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      patch: { workshopId: null },
      payload: { declinedBy, reasonCode: input.reasonCode },
      reasonCode: input.reasonCode,
      visibleToCustomer: false,
    });
  });
}

/**
 * The vehicle is at the workshop (confirmed → vehicle_received). The odometer may not go back: it must be at least
 * the highest reading recorded for this customer's vehicle (earlier requests and the saved vehicle).
 */
export async function receiveVehicle(db: Tx, input: StepInput & { odometerKm: number }) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ['confirmed']);
    const [prev] = rowsOf<{ km: unknown }>(
      await tx.execute(sql`select max(odometer_km) as km from service_requests
        where user_id = ${r.userId} and vehicle_key = ${r.vehicleKey} and id <> ${r.id} and odometer_km is not null`),
    );
    let last = prev?.km === null || prev?.km === undefined ? null : num(prev.km);
    if (r.vehicleId) {
      const [v] = await tx
        .select({ km: vehicles.odometerKm })
        .from(vehicles)
        .where(eq(vehicles.id, r.vehicleId))
        .limit(1);
      if (v?.km !== undefined && v.km !== null) last = Math.max(last ?? 0, v.km);
    }
    if (last !== null && input.odometerKm < last)
      throw new ValidationError(
        'The odometer reading is below the last one recorded',
        'ODOMETER_BELOW_LAST',
        {
          lastKm: last,
        },
      );
    return transitionRequest(tx, {
      request: r,
      to: 'vehicle_received',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      patch: { odometerKm: input.odometerKm, receivedAt: new Date() },
      payload: { odometerKm: input.odometerKm },
    });
  });
}

/**
 * Send an itemised estimate (a new revision). Allowed after the vehicle is received and again from approved, in
 * progress or no work approved — never while the customer is still deciding one. The previous revision is
 * superseded, so every decision starts pending again. The customer gets the WhatsApp "estimate ready" (outbox).
 */
export async function sendEstimate(db: Tx, input: StepInput & { lines: SendEstimateInput['lines'] }) {
  const lines: EstimateLine[] = input.lines.map((l, i) => ({
    id: String(i + 1),
    description: l.description.trim(),
    qty: l.qty,
    unitPaise: l.unitPaise,
    gstRateBp: l.gstRateBp,
    decision: 'pending',
  }));
  const errors = lines.map((l) => estimateLineError(l));
  const bad = errors.findIndex((e) => e !== null);
  if (bad >= 0)
    throw new ValidationError('An estimate line is not valid', 'ESTIMATE_LINE', {
      line: bad + 1,
      field: errors[bad],
    });
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ESTIMATE_FROM);
    const superseded = await tx
      .update(estimates)
      .set({ status: 'superseded' })
      .where(and(eq(estimates.requestId, r.id), ne(estimates.status, 'superseded')))
      .returning({ revision: estimates.revision });
    const [top] = rowsOf<{ rev: unknown }>(
      await tx.execute(
        sql`select coalesce(max(revision), 0) as rev from estimates where request_id = ${r.id}`,
      ),
    );
    const revision = num(top?.rev ?? 0) + 1;
    const [est] = await tx
      .insert(estimates)
      .values({ requestId: r.id, revision, createdBy: input.staffUserId })
      .returning({ id: estimates.id });
    if (!est) throw new Error('estimate insert returned no row');
    await tx.insert(estimateItems).values(
      input.lines.map((l, i) => ({
        estimateId: est.id,
        lineNo: i + 1,
        description: l.description.trim(),
        serviceKey: l.serviceKey ?? null,
        qty: l.qty,
        unitPaise: l.unitPaise,
        gstRateBp: l.gstRateBp,
      })),
    );
    const out = await transitionRequest(tx, {
      request: r,
      to: 'estimate_sent',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      payload: { revision, lines: lines.length, superseded: superseded.length },
    });
    await recordServerEvent(tx, 'service_estimate_sent', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: workshopOf(r), revision, lines: lines.length },
    });
    await queueServiceWhatsApp(tx, {
      requestId: r.id,
      event: 'service.estimate_sent',
      requestVersion: out.version,
    });
    return { ...out, revision };
  });
}

/** Start approved work (approved → in_progress) or mark it ready (in_progress → ready). */
export async function advanceJob(db: Tx, input: StepInput & { to: 'in_progress' | 'ready' }) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, [input.to === 'in_progress' ? 'approved' : 'in_progress']);
    return transitionRequest(tx, {
      request: r,
      to: input.to,
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
    });
  });
}

/** Bill the approved lines of the decided estimate (ready → billed): a frozen snapshot with GST and round-off. */
export async function billJob(db: Tx, input: StepInput) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ['ready']);
    const [est] = await tx
      .select({ id: estimates.id })
      .from(estimates)
      .where(and(eq(estimates.requestId, r.id), eq(estimates.status, 'decided')))
      .limit(1);
    if (!est) throw new ConflictError('There is no approved estimate to bill', 'NO_APPROVED_ESTIMATE');
    const items = await tx
      .select()
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, est.id))
      .orderBy(asc(estimateItems.lineNo));
    const [w] = await tx
      .select({ gstRegistered: workshops.gstRegistered })
      .from(workshops)
      .where(eq(workshops.id, workshopOf(r)))
      .limit(1);
    if (!w) throw new NotFoundError('Workshop not found');
    const bill = computeServiceBill(
      items.map((i) => ({
        id: i.id,
        description: i.description,
        qty: i.qty,
        unitPaise: i.unitPaise,
        gstRateBp: i.gstRateBp,
        decision: i.decision as EstimateLine['decision'],
      })),
      { gstRegistered: w.gstRegistered },
    );
    if (bill.lines.length === 0) throw new ConflictError('No approved line to bill', 'NO_APPROVED_LINES');
    const out = await transitionRequest(tx, {
      request: r,
      to: 'billed',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      payload: { totalPaise: bill.totalPaise },
    });
    await tx.insert(serviceBills).values({
      requestId: r.id,
      estimateId: est.id,
      lines: bill.lines,
      gstRegistered: w.gstRegistered,
      taxablePaise: bill.taxablePaise,
      cgstPaise: bill.cgstPaise,
      sgstPaise: bill.sgstPaise,
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
      billedBy: input.staffUserId,
    });
    await recordServerEvent(tx, 'service_billed', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        workshopId: workshopOf(r),
        totalPaise: bill.totalPaise,
        lines: bill.lines.length,
      },
    });
    return { ...out, totalPaise: bill.totalPaise };
  });
}

/** Paid at the workshop (billed → paid → completed): the bill records the method and time once. */
export async function markJobPaid(db: Tx, input: StepInput & { method: ServicePaymentMethod }) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ['billed']);
    const now = new Date();
    const [paid] = await tx
      .update(serviceBills)
      .set({ paidAt: now, method: input.method, paidRecordedBy: input.staffUserId })
      .where(and(eq(serviceBills.requestId, r.id), sql`${serviceBills.paidAt} is null`))
      .returning({ id: serviceBills.id });
    if (!paid) throw new ConflictError('This bill is already paid', 'ALREADY_PAID');
    const step = await transitionRequest(tx, {
      request: r,
      to: 'paid',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      payload: { method: input.method, at: 'workshop' },
    });
    return transitionRequest(tx, {
      request: r,
      to: 'completed',
      expectedVersion: step.version,
      actor: { type: 'system', userId: null },
      patch: { completedAt: now },
    });
  });
}

/** No work approved: the vehicle goes back unchanged and the job closes (no_work_approved → completed). */
export async function returnVehicle(db: Tx, input: StepInput) {
  return db.transaction(async (tx) => {
    const r = await jobFor(tx, input);
    requireStatus(r, ['no_work_approved']);
    return transitionRequest(tx, {
      request: r,
      to: 'completed',
      expectedVersion: input.expectedVersion,
      actor: workshopActor(input.staffUserId),
      patch: { completedAt: new Date() },
      payload: { vehicleReturned: true },
    });
  });
}
