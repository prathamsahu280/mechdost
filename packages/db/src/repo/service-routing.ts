import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { ServiceRejectReason } from '@mechdost/shared/state';
import { auditLog, serviceEvents, serviceRequests } from '../schema';
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
    const [w] = rowsOf<{ id: string; city_id: string; vehicle_types: string[] }>(
      await tx.execute(sql`select w.id, w.city_id, w.vehicle_types from workshops w
        where w.id = ${input.workshopId} and w.published and w.location_verified and w.status = 'approved'
          and not w.busy
        for share`),
    );
    if (!w) throw new ValidationError('This workshop cannot take requests now', 'WORKSHOP_NOT_ELIGIBLE');
    if (w.city_id !== r.cityId)
      throw new ValidationError('This workshop is in another city', 'WORKSHOP_OUT_OF_AREA');
    if (!w.vehicle_types.includes(r.vehicleType))
      throw new ValidationError('This workshop does not service that vehicle type', 'VEHICLE_NOT_SERVED');
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
          patch: { workshopId: null },
          payload,
          visibleToCustomer: false,
        })
      ).version;
    }
    if (r.status === 'awaiting_workshop') {
      const [row] = await tx
        .update(serviceRequests)
        .set({ workshopId: w.id })
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
      patch: { workshopId: w.id },
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
