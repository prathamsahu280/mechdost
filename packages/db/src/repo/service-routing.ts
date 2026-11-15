import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  ServiceRejectReason,
  ServiceRequestStatus,
  ServiceStaffCancelReason,
} from '@mechdost/shared/state';
import { auditLog, serviceBills, serviceEvents, serviceRequests } from '../schema';
import { queueServiceCancelledEmail } from './email-events';
import { recordServerEvent } from './events';
import { requestRefundForServiceBill } from './refunds';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import {
  loadRequestView,
  lockRequest,
  pageSummaries,
  requireStatus,
  transitionRequest,
  withdrawPendingProposals,
  type ServiceLocale,
} from './service-requests';
import { rowsOf } from './sql-rows';

/**
 * Staff routing of service requests (spec 06): see requests in their cities, send one to an eligible workshop
 * (from needs_routing, or move it away from a workshop that has not confirmed it yet) or reject it with a reason and
 * a message. Eligible = bookable (published, location verified, approved standing, not busy), same city, serves the
 * vehicle type — a paused, suspended or unpublished workshop is never offered. Out-of-city codes are 404.
 */
const inScope = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : inArray(serviceRequests.cityId, [...scope.cityIds]);

const inScopeRaw = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`r.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

export type AdminServiceView = 'needs_routing' | 'awaiting' | 'active' | 'closed';

const VIEW_SQL: Record<AdminServiceView, SQL> = {
  needs_routing: sql`r.status = 'needs_routing'`,
  awaiting: sql`r.status in ('awaiting_workshop', 'proposed')`,
  active: sql`r.status in ('confirmed', 'vehicle_received', 'estimate_sent', 'approved', 'no_work_approved',
    'in_progress', 'ready', 'billed', 'paid')`,
  closed: sql`r.status in ('completed', 'cancelled', 'rejected')`,
};

export async function listAdminServiceRequests(
  db: Tx,
  scope: CityScope,
  view: AdminServiceView,
  page: { cursor?: string | null; limit?: number },
  locale: ServiceLocale,
) {
  return pageSummaries(
    db,
    sql`${inScopeRaw(scope)} and ${VIEW_SQL[view]}`,
    view === 'closed' ? 'updated_at' : 'created_at',
    page,
    locale,
  );
}

const scoped = (scope: CityScope, code: string) => and(eq(serviceRequests.code, code), inScope(scope));

export async function getAdminServiceRequest(db: Tx, scope: CityScope, code: string, locale: ServiceLocale) {
  const [r] = await db.select({ id: serviceRequests.id }).from(serviceRequests).where(scoped(scope, code));
  if (!r) throw new NotFoundError('Service request not found');
  return loadRequestView(db, r.id, 'admin', locale);
}

/**
 * Send the request to `workshopId`: needs_routing → awaiting_workshop; from awaiting_workshop the request moves to
 * the new workshop (same status, new version); from proposed the open proposal is withdrawn
 * (proposed → needs_routing → awaiting_workshop).
 */
export async function reassignServiceRequest(
  db: Tx,
  input: { scope: CityScope; code: string; workshopId: string; expectedVersion: number; staffUserId: string },
) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, scoped(input.scope, input.code));
    requireStatus(r, ['needs_routing', 'awaiting_workshop', 'proposed']);
    if (r.workshopId === input.workshopId)
      throw new ConflictError('The request is already with this workshop', 'SAME_WORKSHOP');
    // FOR SHARE: a concurrent pause or unpublish waits for this assignment (and then applies to it).
    const [w] = rowsOf<{
      id: string;
      city_id: string;
      vehicle_types: string[];
      home_service: boolean;
      in_radius: boolean;
    }>(
      await tx.execute(sql`select w.id, w.city_id, w.vehicle_types, w.home_service,
          exists (select 1 from service_requests sr where sr.id = ${r.id} and sr.location is not null
            and ST_DWithin(w.location, sr.location, w.home_radius_km * 1000)) as in_radius
        from workshops w
        where w.id = ${input.workshopId} and w.published and w.location_verified and w.status = 'approved'
          and not w.busy
        for share`),
    );
    if (!w) throw new ValidationError('This workshop cannot take requests now', 'WORKSHOP_NOT_ELIGIBLE');
    if (w.city_id !== r.cityId)
      throw new ValidationError('This workshop is in another city', 'WORKSHOP_OUT_OF_AREA');
    if (!w.vehicle_types.includes(r.vehicleType))
      throw new ValidationError('This workshop does not service that vehicle type', 'VEHICLE_NOT_SERVED');
    // A home visit only goes to a workshop that does home visits and travels as far as the customer's pin.
    if (r.serviceMode === 'home' && !(w.home_service && w.in_radius))
      throw new ValidationError('This workshop does not do home visits that far', 'WORKSHOP_OUT_OF_RADIUS');
    const actor = { type: 'admin' as const, userId: input.staffUserId };
    const payload = { from: r.workshopId, to: w.id };
    let version = input.expectedVersion;
    if (r.status === 'proposed') {
      await withdrawPendingProposals(tx, r.id);
      version = (
        await transitionRequest(tx, {
          request: r,
          to: 'needs_routing',
          expectedVersion: version,
          actor,
          patch: { workshopId: null, visitingMechanic: null },
          payload,
          visibleToCustomer: false,
        })
      ).version;
    }
    if (r.status === 'awaiting_workshop') {
      const [row] = await tx
        .update(serviceRequests)
        .set({ workshopId: w.id, visitingMechanic: null })
        .where(
          and(
            eq(serviceRequests.id, r.id),
            eq(serviceRequests.status, 'awaiting_workshop'),
            eq(serviceRequests.version, version),
          ),
        )
        .returning({ status: serviceRequests.status, version: serviceRequests.version });
      if (!row)
        throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
      // Same status, new workshop: the timeline and audit still record the move (staff only).
      await tx.insert(serviceEvents).values({
        requestId: r.id,
        fromStatus: 'awaiting_workshop',
        toStatus: 'awaiting_workshop',
        actorType: 'admin',
        actorId: input.staffUserId,
        visibleToCustomer: false,
        payload,
      });
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'admin',
        action: 'service_request.reassigned',
        entity: 'service_request',
        entityId: r.id,
        after: payload,
      });
      return { status: 'awaiting_workshop' as const, version: row.version };
    }
    return transitionRequest(tx, {
      request: r,
      to: 'awaiting_workshop',
      expectedVersion: version,
      actor,
      patch: { workshopId: w.id, visitingMechanic: null },
      payload,
    });
  });
}

/** Reject a request nobody can take, with a reason code and a message for the customer (needs_routing only). */
export async function rejectServiceRequest(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reasonCode: ServiceRejectReason;
    message: string;
    expectedVersion: number;
    staffUserId: string;
  },
) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, scoped(input.scope, input.code));
    requireStatus(r, ['needs_routing']);
    return transitionRequest(tx, {
      request: r,
      to: 'rejected',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { statusReasonCode: input.reasonCode, customerMessage: input.message },
      payload: { reasonCode: input.reasonCode },
      reasonCode: input.reasonCode,
    });
  });
}

/** States a staff cancel may start from: every live one (the machine lists the same edges for `admin`). */
const STAFF_CANCELLABLE: readonly ServiceRequestStatus[] = [
  'requested',
  'needs_routing',
  'awaiting_workshop',
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

/**
 * Staff cancel (spec 06 "Staff cancel", permission `service:cancel`, city-scoped): a reason code, the held workshop hour
 * goes back (once, in `transitionRequest`), pending proposals are withdrawn, and when the bill was paid online ONE
 * refund request is raised through the refunds queue (finance approves; idempotent per payment). The customer is
 * told through the email / bell / push catalogues in the same transaction. An unpaid open Razorpay order is left
 * alone: a capture that still arrives is recorded and refunded (`applyBillPayment`).
 */
export async function cancelServiceRequestByStaff(
  db: Tx,
  input: {
    scope: CityScope;
    code: string;
    reasonCode: ServiceStaffCancelReason;
    expectedVersion: number;
    staffUserId: string;
  },
) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, scoped(input.scope, input.code));
    requireStatus(r, STAFF_CANCELLABLE);
    const fromStatus = r.status;
    const workshopId = r.workshopId;
    const out = await transitionRequest(tx, {
      request: r,
      to: 'cancelled',
      expectedVersion: input.expectedVersion,
      actor: { type: 'admin', userId: input.staffUserId },
      patch: { statusReasonCode: input.reasonCode },
      payload: { reasonCode: input.reasonCode, by: 'staff', fromStatus },
      reasonCode: input.reasonCode,
    });
    await withdrawPendingProposals(tx, r.id);
    const [bill] = await tx
      .select({ id: serviceBills.id })
      .from(serviceBills)
      .where(eq(serviceBills.requestId, r.id))
      .limit(1);
    const refundId = bill
      ? await requestRefundForServiceBill(tx, { billId: bill.id, source: 'service_cancelled' })
      : null;
    await queueServiceCancelledEmail(tx, {
      request: { id: r.id, code: r.code, userId: r.userId, workshopId },
      version: out.version,
      reasonCode: input.reasonCode,
      refundRequested: refundId !== null,
    });
    await recordServerEvent(tx, 'service_cancelled_by_staff', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: {
        requestCode: r.code,
        workshopId,
        fromStatus,
        reasonCode: input.reasonCode,
        refundRequested: refundId !== null,
      },
    });
    return { ...out, refundRequested: refundId !== null };
  });
}
