import { randomInt } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import {
  AGENT_VEHICLE_TYPES,
  HANDOVER_CODE_MAX_ATTEMPTS,
  subOrderDeliveryMode,
  type AgentVehicleType,
  type OrderDeliveryMode,
} from '@mechdost/shared/delivery/codes';
import { OPERATIONAL_SETTINGS, type SettingKey } from '@mechdost/shared/settings';
import { deliveryJobMachine, type Actor, type DeliveryJobStatus } from '@mechdost/shared/state';
import { decryptField, encryptField, safeEqual, type Keyring } from '../crypto';
import {
  auditLog,
  deliveryAgents,
  deliveryHandoverCodes,
  deliveryJobEvents,
  deliveryJobs,
  orderGroups,
  orders,
  shops,
} from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * Shared pieces of the delivery-agent repositories (spec 24): city settings, the agent of a signed-in user, job
 * locking and moves (machine + conditional UPDATE on version), the append-only job timeline, audit rows and the
 * pickup / return codes. Nothing here is exported over HTTP directly.
 */

export interface DeliverySettings {
  agentsEnabled: boolean;
  offerTimeoutMin: number;
  maxActiveJobs: number;
  photosRequired: boolean;
  maxAttempts: number;
  inviteHours: number;
  maxLoadKg: Record<AgentVehicleType, number>;
  rankRatingWeightPct: number;
  lowRatingAlertX10: number;
  lowRatingMinCount: number;
}

/** Every `delivery.*` setting for a city in one read (city value wins over the global one; else the default). */
export async function deliverySettings(tx: Tx, cityId: string): Promise<DeliverySettings> {
  const rows = rowsOf<{ key: string; city_id: string | null; value: unknown }>(
    await tx.execute(sql`select key, city_id, value from settings
      where key like 'delivery.%' and (city_id = ${cityId}::uuid or city_id is null)`),
  );
  const pick = (key: SettingKey): unknown => {
    const v = (
      rows.find((r) => r.key === key && r.city_id === cityId) ??
      rows.find((r) => r.key === key && r.city_id === null)
    )?.value;
    const d = OPERATIONAL_SETTINGS[key].default;
    return typeof v === typeof d ? v : d;
  };
  const maxLoadKg = Object.fromEntries(
    AGENT_VEHICLE_TYPES.map((v) => [v, Number(pick(`delivery.max_load_${v}_kg` as SettingKey))]),
  ) as Record<AgentVehicleType, number>;
  return {
    agentsEnabled: pick('delivery.agents_enabled') === true,
    offerTimeoutMin: Number(pick('delivery.offer_timeout_min')),
    maxActiveJobs: Number(pick('delivery.max_active_jobs')),
    photosRequired: pick('delivery.photos_required') !== false,
    maxAttempts: Number(pick('delivery.max_attempts')),
    inviteHours: Number(pick('delivery.invite_hours')),
    maxLoadKg,
    rankRatingWeightPct: Number(pick('delivery.rank_rating_weight_pct')),
    lowRatingAlertX10: Number(pick('delivery.low_rating_alert_x10')),
    lowRatingMinCount: Number(pick('delivery.low_rating_min_count')),
  };
}

export interface AgentRow {
  id: string;
  userId: string;
  cityId: string;
  name: string;
  status: string;
  online: boolean;
  vehicleType: AgentVehicleType;
  version: number;
}

/** The delivery agent of a signed-in user; anyone else gets 404 (the agent id never comes from the client). */
export async function agentOfUser(tx: Tx, userId: string, opts: { lock?: boolean } = {}): Promise<AgentRow> {
  const q = tx
    .select({
      id: deliveryAgents.id,
      userId: deliveryAgents.userId,
      cityId: deliveryAgents.cityId,
      name: deliveryAgents.name,
      status: deliveryAgents.status,
      online: deliveryAgents.online,
      vehicleType: deliveryAgents.vehicleType,
      version: deliveryAgents.version,
    })
    .from(deliveryAgents)
    .where(eq(deliveryAgents.userId, userId));
  const [a] = opts.lock ? await q.for('update') : await q.limit(1);
  if (!a) throw new NotFoundError('Delivery agent not found');
  return { ...a, vehicleType: a.vehicleType as AgentVehicleType };
}

export type JobRow = typeof deliveryJobs.$inferSelect;

/** Locks a job row (after the order row, spec 14 lock order). */
export async function lockJob(tx: Tx, jobId: string): Promise<JobRow> {
  const [j] = await tx.select().from(deliveryJobs).where(eq(deliveryJobs.id, jobId)).for('update');
  if (!j) throw new NotFoundError('Delivery job not found');
  return j;
}

export type JobActor = Extract<Actor, 'delivery_agent' | 'shop' | 'admin' | 'system'>;

/** Appends one row to the job's timeline (append-only table). */
export async function jobEvent(
  tx: Tx,
  input: {
    job: Pick<JobRow, 'id' | 'orderId'>;
    kind: (typeof deliveryJobEvents.$inferInsert)['kind'];
    from?: DeliveryJobStatus | null;
    to?: DeliveryJobStatus | null;
    reasonCode?: string | null;
    offerId?: string | null;
    agentId?: string | null;
    mediaId?: string | null;
    actor: JobActor;
    actorId?: string | null;
  },
): Promise<void> {
  await tx.insert(deliveryJobEvents).values({
    jobId: input.job.id,
    orderId: input.job.orderId,
    kind: input.kind,
    fromStatus: input.from ?? null,
    toStatus: input.to ?? null,
    reasonCode: input.reasonCode ?? null,
    offerId: input.offerId ?? null,
    agentId: input.agentId ?? null,
    mediaId: input.mediaId ?? null,
    actorType: input.actor,
    actorId: input.actorId ?? null,
  });
}

/**
 * The only way to change a job's status: the machine checks the move and the actor, a conditional UPDATE on
 * (status, version) applies it (zero rows ⇒ 409), and the timeline row is written in the same transaction.
 */
export async function transitionJob(
  tx: Tx,
  input: {
    job: JobRow;
    to: DeliveryJobStatus;
    actor: JobActor;
    actorId?: string | null;
    expectedVersion?: number;
    patch?: Partial<typeof deliveryJobs.$inferInsert>;
    reasonCode?: string | null;
    offerId?: string | null;
    mediaId?: string | null;
  },
): Promise<JobRow> {
  const from = input.job.status as DeliveryJobStatus;
  deliveryJobMachine.assert(from, input.to, input.actor);
  const expected = input.expectedVersion ?? input.job.version;
  const [row] = await tx
    .update(deliveryJobs)
    .set({ status: input.to, ...input.patch })
    .where(
      and(
        eq(deliveryJobs.id, input.job.id),
        eq(deliveryJobs.status, from),
        eq(deliveryJobs.version, expected),
      ),
    )
    .returning();
  if (!row) throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
  await jobEvent(tx, {
    job: row,
    kind: 'status',
    from,
    to: input.to,
    reasonCode: input.reasonCode ?? null,
    offerId: input.offerId ?? null,
    agentId: row.agentId,
    mediaId: input.mediaId ?? null,
    actor: input.actor,
    actorId: input.actorId ?? null,
  });
  return row;
}

export async function auditDelivery(
  tx: Tx,
  input: {
    actorUserId: string | null;
    actorRole: 'staff' | 'delivery_agent' | 'shop' | 'customer' | 'system';
    action: string;
    entity: 'delivery_job' | 'delivery_agent' | 'delivery_invite' | 'shop' | 'order';
    entityId: string;
    after?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    after: input.after ?? null,
    reason: input.reason ?? null,
  });
}

// ── pickup and return codes ───────────────────────────────────────────────────────────────────────────────────────

export type HandoverPurpose = 'pickup' | 'return';
const aadOf = (purpose: HandoverPurpose) => `delivery_handover_codes.${purpose}`;

function needKeyring(keyring: Keyring | null): Keyring {
  if (!keyring)
    throw new ConflictError('Delivery codes are not configured on this server', 'DELIVERY_CODES_UNAVAILABLE');
  return keyring;
}

/** Issues (or re-issues, resetting the tries) the 4-digit pickup or return code of a job. */
export async function issueHandoverCode(
  tx: Tx,
  keyring: Keyring | null,
  jobId: string,
  purpose: HandoverPurpose,
): Promise<void> {
  const codeEnc = encryptField(
    String(randomInt(0, 10_000)).padStart(4, '0'),
    needKeyring(keyring),
    aadOf(purpose),
  );
  await tx
    .insert(deliveryHandoverCodes)
    .values({ jobId, purpose, codeEnc })
    .onConflictDoUpdate({
      target: [deliveryHandoverCodes.jobId, deliveryHandoverCodes.purpose],
      set: { codeEnc, attempts: 0, usedAt: null },
    });
}

/** The code (decrypted) for the party that shows it, and whether it is locked; null when none is open. */
export async function readHandoverCode(
  tx: Tx,
  keyring: Keyring | null,
  jobId: string,
  purpose: HandoverPurpose,
): Promise<{ code: string | null; locked: boolean } | null> {
  const [row] = await tx
    .select({
      enc: deliveryHandoverCodes.codeEnc,
      attempts: deliveryHandoverCodes.attempts,
      usedAt: deliveryHandoverCodes.usedAt,
    })
    .from(deliveryHandoverCodes)
    .where(and(eq(deliveryHandoverCodes.jobId, jobId), eq(deliveryHandoverCodes.purpose, purpose)))
    .limit(1);
  if (!row || row.usedAt) return null;
  return {
    code: keyring ? decryptField(row.enc, keyring, aadOf(purpose)) : null,
    locked: row.attempts >= HANDOVER_CODE_MAX_ATTEMPTS,
  };
}

export type HandoverCheck =
  { ok: true } | { ok: false; reason: 'wrong'; attemptsLeft: number } | { ok: false; reason: 'locked' };

/**
 * Checks an entered code like the delivery code: the try is reserved first (atomic, so parallel guesses never get more
 * than 5 comparisons), compared in constant time, locked after 5. A wrong try must be committed by the caller.
 */
export async function verifyHandoverCode(
  tx: Tx,
  keyring: Keyring | null,
  jobId: string,
  purpose: HandoverPurpose,
  entered: string,
): Promise<HandoverCheck> {
  const ring = needKeyring(keyring);
  if (!/^\d{4}$/.test(entered)) throw new ValidationError('Enter the 4-digit code', 'CODE_FORMAT');
  const [reserved] = await tx
    .update(deliveryHandoverCodes)
    .set({ attempts: sql`${deliveryHandoverCodes.attempts} + 1` })
    .where(
      and(
        eq(deliveryHandoverCodes.jobId, jobId),
        eq(deliveryHandoverCodes.purpose, purpose),
        sql`${deliveryHandoverCodes.usedAt} is null`,
        lt(deliveryHandoverCodes.attempts, HANDOVER_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ enc: deliveryHandoverCodes.codeEnc, attempts: deliveryHandoverCodes.attempts });
  if (!reserved) {
    const [row] = await tx
      .select({ usedAt: deliveryHandoverCodes.usedAt })
      .from(deliveryHandoverCodes)
      .where(and(eq(deliveryHandoverCodes.jobId, jobId), eq(deliveryHandoverCodes.purpose, purpose)))
      .limit(1);
    if (!row || row.usedAt) throw new ConflictError('No code is open for this step', 'NO_CODE');
    return { ok: false, reason: 'locked' };
  }
  if (safeEqual(entered, decryptField(reserved.enc, ring, aadOf(purpose)))) {
    await tx
      .update(deliveryHandoverCodes)
      .set({ usedAt: sql`now()` })
      .where(and(eq(deliveryHandoverCodes.jobId, jobId), eq(deliveryHandoverCodes.purpose, purpose)));
    return { ok: true };
  }
  return reserved.attempts >= HANDOVER_CODE_MAX_ATTEMPTS
    ? { ok: false, reason: 'locked' }
    : { ok: false, reason: 'wrong', attemptsLeft: HANDOVER_CODE_MAX_ATTEMPTS - reserved.attempts };
}

/** Marks an open code used without checking it (the audited admin override). */
export async function closeHandoverCode(tx: Tx, jobId: string, purpose: HandoverPurpose): Promise<void> {
  await tx
    .update(deliveryHandoverCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(deliveryHandoverCodes.jobId, jobId),
        eq(deliveryHandoverCodes.purpose, purpose),
        sql`${deliveryHandoverCodes.usedAt} is null`,
      ),
    );
}

/**
 * Who delivers a sub-order routed to `shopId` (Lead's calls 8, 9, 11): agents only for a prepaid sub-order of an
 * `agents`-mode shop in a city where agents are switched on; COD and everything else stays with the shop.
 */
export async function deliveryModeFor(
  tx: Tx,
  input: { orderId: string; shopId: string; cityId: string },
): Promise<OrderDeliveryMode> {
  const [row] = await tx
    .select({ method: orderGroups.paymentMethod, shopMode: shops.deliveryMode })
    .from(orders)
    .innerJoin(orderGroups, eq(orderGroups.id, orders.groupId))
    .innerJoin(shops, eq(shops.id, input.shopId))
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!row) return 'shop';
  const settings = await deliverySettings(tx, input.cityId);
  return subOrderDeliveryMode({
    shopMode: row.shopMode === 'agents' ? 'agents' : 'self',
    paymentMethod: row.method === 'online' ? 'online' : 'cod',
    agentsEnabled: settings.agentsEnabled,
  });
}
