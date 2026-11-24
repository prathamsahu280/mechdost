import { and, eq, type SQL } from 'drizzle-orm';
import { rsaMachine, type RsaStatus } from '@mechdost/shared/state';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { auditLog, rsaEvents, rsaRequests } from '../schema';
import type { ActorContext } from './actor';
import { ConflictError, NotFoundError } from './errors';
import { resolveNotices } from './notices';
import type { Tx } from './orders';

/**
 * Core of roadside assistance (spec 22): the locked request row and the one function that moves it. Every status change
 * is `rsaMachine.assert` + a conditional UPDATE on (id, status, version) + an `rsa_events` row + an audit row in the
 * caller's transaction, so a stale or racing writer gets `STALE_REQUEST` and changes nothing. Lock order everywhere:
 * request -> offer -> payment -> refund.
 */
export type RsaActor = ActorContext & { type: 'customer' | 'workshop' | 'admin' | 'system' };

export interface RsaCore {
  id: string;
  code: string;
  userId: string;
  cityId: string;
  workshopId: string | null;
  status: RsaStatus;
  version: number;
  vehicleType: VehicleType;
  problemType: string | null;
  advancePaise: number;
  totalPaise: number | null;
  balancePaise: number | null;
}

const CORE = {
  id: rsaRequests.id,
  code: rsaRequests.code,
  userId: rsaRequests.userId,
  cityId: rsaRequests.cityId,
  workshopId: rsaRequests.workshopId,
  status: rsaRequests.status,
  version: rsaRequests.version,
  vehicleType: rsaRequests.vehicleType,
  problemType: rsaRequests.problemType,
  advancePaise: rsaRequests.advancePaise,
  totalPaise: rsaRequests.totalPaise,
  balancePaise: rsaRequests.balancePaise,
};

/** Locks the request row (404 when none matches: the caller's scope is part of `where`). */
export async function lockRsa(tx: Tx, where: SQL | undefined): Promise<RsaCore> {
  const [r] = await tx.select(CORE).from(rsaRequests).where(where).limit(1).for('update');
  if (!r) throw new NotFoundError('Roadside request not found');
  return { ...r, status: r.status as RsaStatus, vehicleType: r.vehicleType as VehicleType };
}

/** Wrong step for the current status: 409 with the status, before any write. */
export function requireRsaStatus(r: RsaCore, allowed: readonly RsaStatus[]): void {
  if (!allowed.includes(r.status))
    throw new ConflictError(`This request is ${r.status.replace(/_/g, ' ')}`, 'WRONG_STEP');
}

type RsaPatch = Partial<
  Pick<
    typeof rsaRequests.$inferInsert,
    | 'workshopId'
    | 'advancePaidAt'
    | 'totalPaise'
    | 'balancePaise'
    | 'overpaidPaise'
    | 'balanceMethod'
    | 'balancePaidAt'
    | 'billedAt'
    | 'completedAt'
    | 'cancelledAt'
    | 'cancelReason'
    | 'cancelNote'
  >
>;

/** Notices that ask for something stop being true once the request leaves the status that asked. */
const ASKS: Partial<Record<RsaStatus, 'rsa.offer' | 'rsa.bill_ready'>> = {
  offered: 'rsa.offer',
  billed: 'rsa.bill_ready',
};

export async function transitionRsa(
  tx: Tx,
  args: {
    request: RsaCore;
    to: RsaStatus;
    expectedVersion: number;
    actor: RsaActor;
    patch?: RsaPatch;
    payload?: Record<string, unknown>;
    visibleToCustomer?: boolean;
  },
): Promise<{ status: RsaStatus; version: number }> {
  const { request: r } = args;
  const from = r.status;
  rsaMachine.assert(from, args.to, args.actor.type);
  const [row] = await tx
    .update(rsaRequests)
    .set({ status: args.to, ...args.patch })
    .where(
      and(
        eq(rsaRequests.id, r.id),
        eq(rsaRequests.status, from),
        eq(rsaRequests.version, args.expectedVersion),
      ),
    )
    .returning({ status: rsaRequests.status, version: rsaRequests.version });
  if (!row)
    throw new ConflictError('This request changed meanwhile; reload it and try again', 'STALE_REQUEST');
  await tx.insert(rsaEvents).values({
    requestId: r.id,
    fromStatus: from,
    toStatus: args.to,
    actorType: args.actor.type,
    actorId: args.actor.userId ?? null,
    visibleToCustomer: args.visibleToCustomer ?? true,
    payload: args.payload ?? {},
  });
  await tx.insert(auditLog).values({
    actorUserId: args.actor.userId ?? null,
    actorRole: args.actor.type,
    action: `rsa_request.${args.to}`,
    entity: 'rsa_request',
    entityId: r.id,
    before: { status: from },
    after: { status: args.to, ...args.payload },
  });
  r.status = row.status as RsaStatus;
  r.version = row.version;
  if (args.patch?.workshopId !== undefined) r.workshopId = args.patch.workshopId;
  const ask = ASKS[from];
  if (ask) await resolveNotices(tx, { kinds: [ask], entityIds: [r.id] });
  return { status: r.status, version: r.version };
}
