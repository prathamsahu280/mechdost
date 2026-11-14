import { and, eq, inArray } from 'drizzle-orm';
import type {
  MoveReason,
  MoveTransport,
  ServiceRequestStatus,
  VisitFeeWaiveReason,
} from '@mechdost/shared/state';
import { auditLog, estimates, serviceEvents, serviceMoves, serviceRequests } from '../schema';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { receiveInTx } from './service-jobs';
import { lockRequest, requireStatus, transitionRequest, type RequestCore } from './service-requests';

/**
 * Home servicing after the visit is confirmed (spec 06, design 2026-11-15): the workshop's offer to move the job to its
 * workshop (a side record `service_moves`, not a state), waiving the visit fee, and the audited admin arrival
 * override. Every write locks the request row first (spec 14 lock order). Changes that are not a status move
 * (mode switch, fee waiver) are conditional UPDATEs on (id, status, version) and write the timeline and audit row.
 */
const MOVE_FROM: readonly ServiceRequestStatus[] = ['vehicle_received', 'estimate_sent'];
const WAIVE_FROM: readonly ServiceRequestStatus[] = [
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
];

/** A change that keeps the status: CAS on (id, status, version), then the timeline and audit rows. */
async function changeKeepingStatus(
  tx: Tx,
  input: {
    r: RequestCore;
    expectedVersion: number;
    set: Partial<typeof serviceRequests.$inferInsert>;
    actor: { type: 'customer' | 'workshop'; userId: string };
    action: string;
    payload: Record<string, unknown>;
  },
): Promise<{ status: ServiceRequestStatus; version: number }> {
  const { r } = input;
  const [row] = await tx
    .update(serviceRequests)
    .set(input.set)
    .where(
      and(
        eq(serviceRequests.id, r.id),
        eq(serviceRequests.status, r.status),
        eq(serviceRequests.version, input.expectedVersion),
      ),
    )
    .returning({ version: serviceRequests.version });
  if (!row)
    throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
  await tx.insert(serviceEvents).values({
    requestId: r.id,
    fromStatus: r.status,
    toStatus: r.status,
    actorType: input.actor.type,
    actorId: input.actor.userId,
    payload: input.payload,
  });
  await tx.insert(auditLog).values({
    actorUserId: input.actor.userId,
    actorRole: input.actor.type,
    action: input.action,
    entity: 'service_request',
    entityId: r.id,
    before: { status: r.status },
    after: input.payload,
  });
  return { status: r.status, version: row.version };
}

const workshopRequest = (workshopIds: readonly string[], code: string) =>
  and(
    eq(serviceRequests.code, code),
    workshopIds.length === 0
      ? eq(serviceRequests.id, '00000000-0000-0000-0000-000000000000')
      : inArray(serviceRequests.workshopId, [...workshopIds]),
  );

function workshopOf(r: RequestCore): string {
  if (!r.workshopId) throw new ConflictError('This request has no workshop', 'NO_WORKSHOP');
  return r.workshopId;
}

/** The workshop offers to move a home job to its workshop. One open offer per request. */
export async function proposeMove(
  db: Tx,
  input: {
    workshopIds: readonly string[];
    code: string;
    expectedVersion: number;
    staffUserId: string;
    reasonCode: MoveReason;
    transport: MoveTransport;
  },
): Promise<{ id: string; status: ServiceRequestStatus; version: number }> {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, workshopRequest(input.workshopIds, input.code));
    requireStatus(r, MOVE_FROM);
    if (r.serviceMode !== 'home') throw new ConflictError('This job is not a home visit', 'NOT_HOME');
    if (r.version !== input.expectedVersion)
      throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
    let id: string;
    try {
      const [move] = await tx.transaction(async (sp) =>
        sp
          .insert(serviceMoves)
          .values({
            requestId: r.id,
            reasonCode: input.reasonCode,
            transport: input.transport,
            proposedBy: input.staffUserId,
          })
          .returning({ id: serviceMoves.id }),
      );
      if (!move) throw new Error('move insert returned no row');
      id = move.id;
    } catch (err) {
      if (pgCode(err) === '23505')
        throw new ConflictError('An offer is already waiting for the customer', 'MOVE_PENDING');
      throw err;
    }
    const payload = {
      move: 'proposed',
      moveId: id,
      reasonCode: input.reasonCode,
      transport: input.transport,
    };
    await tx.insert(serviceEvents).values({
      requestId: r.id,
      fromStatus: r.status,
      toStatus: r.status,
      actorType: 'workshop',
      actorId: input.staffUserId,
      payload,
    });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'workshop',
      action: 'service_request.move_proposed',
      entity: 'service_request',
      entityId: r.id,
      after: payload,
    });
    await recordServerEvent(tx, 'home_move_proposed', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        workshopId: workshopOf(r),
        reasonCode: input.reasonCode,
        transport: input.transport,
      },
    });
    return { id, status: r.status, version: r.version };
  });
}

/**
 * The customer answers the offer. Accept: the job becomes a workshop job (mode switch; pickup follows the chosen
 * transport; the visit fee stays unless waived) and the workshop sends or revises the estimate. Decline: any open
 * estimate is withdrawn and the request goes to no_work_approved, so the workshop bills the visit fee (or waives it).
 */
export async function decideMove(
  db: Tx,
  input: { userId: string; code: string; accept: boolean; expectedVersion: number },
): Promise<{ status: ServiceRequestStatus; version: number }> {
  return db.transaction(async (tx) => {
    const r = await lockRequest(
      tx,
      and(eq(serviceRequests.userId, input.userId), eq(serviceRequests.code, input.code)),
    );
    requireStatus(r, MOVE_FROM);
    if (r.serviceMode !== 'home') throw new ConflictError('This job is not a home visit', 'NOT_HOME');
    const [move] = await tx
      .select()
      .from(serviceMoves)
      .where(and(eq(serviceMoves.requestId, r.id), eq(serviceMoves.status, 'proposed')))
      .limit(1)
      .for('update');
    if (!move) throw new ConflictError('There is no offer waiting for you', 'NO_MOVE');
    await tx
      .update(serviceMoves)
      .set({ status: input.accept ? 'accepted' : 'declined', decidedAt: new Date() })
      .where(eq(serviceMoves.id, move.id));
    const payload = { move: input.accept ? 'accepted' : 'declined', moveId: move.id };
    const actor = { type: 'customer' as const, userId: input.userId };
    let out: { status: ServiceRequestStatus; version: number };
    if (input.accept) {
      out = await changeKeepingStatus(tx, {
        r,
        expectedVersion: input.expectedVersion,
        set: { serviceMode: 'workshop', pickupRequested: move.transport === 'workshop_picks_up' },
        actor,
        action: 'service_request.move_accepted',
        payload: { ...payload, mode: 'workshop' },
      });
    } else {
      if (r.status === 'estimate_sent')
        await tx
          .update(estimates)
          .set({ status: 'superseded' })
          .where(and(eq(estimates.requestId, r.id), eq(estimates.status, 'sent')));
      out = await transitionRequest(tx, {
        request: r,
        to: 'no_work_approved',
        expectedVersion: input.expectedVersion,
        actor,
        payload,
      });
    }
    await recordServerEvent(tx, 'home_move_answered', {
      userId: input.userId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: workshopOf(r), accepted: input.accept },
    });
    return out;
  });
}

/** The workshop waives the home visit fee, with a reason code. The bill keeps the line at 0 (no silent change). */
export async function waiveVisitFee(
  db: Tx,
  input: {
    workshopIds: readonly string[];
    code: string;
    expectedVersion: number;
    staffUserId: string;
    reasonCode: VisitFeeWaiveReason;
  },
): Promise<{ status: ServiceRequestStatus; version: number }> {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, workshopRequest(input.workshopIds, input.code));
    requireStatus(r, WAIVE_FROM);
    const [cur] = await tx
      .select({ fee: serviceRequests.visitFeePaise, waived: serviceRequests.visitFeeWaivedReason })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, r.id))
      .limit(1);
    if (cur?.fee === null || cur?.fee === undefined)
      throw new ConflictError('This job has no home visit fee', 'NO_VISIT_FEE');
    if (cur.waived !== null) throw new ConflictError('The visit fee is already waived', 'ALREADY_WAIVED');
    const out = await changeKeepingStatus(tx, {
      r,
      expectedVersion: input.expectedVersion,
      set: { visitFeeWaivedReason: input.reasonCode },
      actor: { type: 'workshop', userId: input.staffUserId },
      action: 'service_request.visit_fee_waived',
      payload: { feeWaived: true, reasonCode: input.reasonCode, feePaise: cur.fee },
    });
    await recordServerEvent(tx, 'home_visit_fee_waived', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: workshopOf(r), reasonCode: input.reasonCode },
    });
    return out;
  });
}

const inScope = (scope: CityScope, cityId: string) => scope.all || scope.cityIds.includes(cityId);

/**
 * Staff confirm the mechanic's arrival without the code (customer unreachable, code lost or locked). The reason is
 * kept on the request and in the audit row in the same transaction; the odometer is still required.
 */
export async function overrideArrival(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reason: string;
    odometerKm: number;
    expectedVersion: number;
    staffUserId: string;
  },
): Promise<{ status: ServiceRequestStatus; version: number }> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300)
    throw new ValidationError('Give a reason (5 to 300 characters)', 'OVERRIDE_REASON');
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, eq(serviceRequests.code, input.code));
    if (!inScope(input.scope, r.cityId)) throw new NotFoundError('Service request not found');
    requireStatus(r, ['confirmed']);
    if (r.serviceMode !== 'home') throw new ConflictError('This job is not a home visit', 'NOT_HOME');
    return receiveInTx(
      tx,
      r,
      { expectedVersion: input.expectedVersion, odometerKm: input.odometerKm },
      { type: 'admin', userId: input.staffUserId },
      {
        patch: { arrivalOverrideReason: reason, arrivalOverrideBy: input.staffUserId },
        payload: { arrivalOverride: true, reason },
      },
    );
  });
}
