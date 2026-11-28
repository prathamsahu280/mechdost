import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  AGENT_VEHICLE_TYPES,
  LOAD_CLASSES,
  contactStage,
  ratingAverageX10,
  retryAllowed,
  returnRefundKind,
  subOrderLoad,
  vehicleCarries,
  type AgentVehicleType,
  type DeliveryDeclineReason,
  type DeliveryFailReason,
  type DeliveryGiveUpReason,
  type DeliveryRetryAgent,
  type DeliveryWithdrawReason,
  type LoadClass,
} from '@mechdost/shared/delivery/codes';
import {
  deliveryJobMachine,
  deliveryOfferMachine,
  type DeliveryJobStatus,
  type OrderStatus,
} from '@mechdost/shared/state';
import type { Keyring } from '../crypto';
import {
  deliveryAgents,
  deliveryJobEvents,
  deliveryJobOffers,
  deliveryJobs,
  mediaObjects,
  orderDeliverySwitches,
  orderItems,
  orders,
  productVariants,
  products,
  shipments,
  shopUsers,
  users,
} from '../schema';
import {
  activeAgentOfUser,
  agentOfUser,
  allDocumentsVerified,
  auditDelivery,
  closeHandoverCode,
  deliverySettings,
  issueHandoverCode,
  jobEvent,
  lockJob,
  readHandoverCode,
  transitionJob,
  verifyHandoverCode,
  type JobRow,
} from './delivery-common';
import { issueDeliveryCode, overrideShipmentInTx, verifyDeliveryCode } from './delivery';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { restoreCommittedStock } from './inventory';
import { queueNotice, queueStaffNotice } from './notices';
import { enqueueNotification } from './notify';
import { notificationChannelEnabled } from './notification-admin';
import { lockOrder, transitionOrder, type Tx } from './orders';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Delivery jobs (spec 24): one active job per agent-mode sub-order (partial unique index). Lock order everywhere:
 * the order row first (`lockOrder`), then the job, then offers and codes (spec 14). Every job move goes through
 * `transitionJob` (machine + CAS) and every order move through `transitionOrder`; both in one transaction.
 * Agents act only on jobs offered to or held by them (404 otherwise); staff by city scope.
 */

const ACTIVE_AGENT_JOBS = ['accepted', 'picked_up', 'failed', 'returning'] as const;
const inScope = (scope: CityScope, cityId: string) => scope.all || scope.cityIds.includes(cityId);
const secondsBetween = (a: Date | null, b: Date) =>
  a ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000)) : 0;

async function orderInfo(tx: Tx, orderId: string) {
  const [o] = await tx
    .select({
      id: orders.id,
      code: orders.code,
      userId: orders.userId,
      cityId: orders.cityId,
      shopId: orders.shopId,
      status: orders.status,
      version: orders.version,
      deliveryMode: orders.deliveryMode,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o) throw new NotFoundError('Order not found');
  return o;
}

async function shopMembers(tx: Tx, shopId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: shopUsers.userId })
    .from(shopUsers)
    .where(eq(shopUsers.shopId, shopId));
  return [...new Set(rows.map((r) => r.userId))];
}

async function noticeShop(
  tx: Tx,
  shopId: string,
  kind: 'shop.delivery_agent_assigned' | 'shop.delivery_switch' | 'shop.delivery_returning',
  orderId: string,
  orderCode: string,
  version: number | string,
) {
  for (const userId of await shopMembers(tx, shopId))
    await queueNotice(tx, { kind, userId, entityId: orderId, version, params: { orderCode } });
}

/** The sub-order's load: known weights summed, the heaviest class of lines without a weight (Lead's call 12). */
async function loadOf(tx: Tx, orderId: string) {
  const lines = await tx
    .select({ qty: orderItems.qty, weightG: productVariants.weightG, loadClass: products.loadClass })
    .from(orderItems)
    .innerJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderItems.orderId, orderId));
  const load = subOrderLoad(
    lines.map((l) => ({ quantity: l.qty, weightG: l.weightG, loadClass: l.loadClass as LoadClass })),
  );
  const heaviest = lines.reduce((r, l) => Math.max(r, LOAD_CLASSES.indexOf(l.loadClass as LoadClass)), 0);
  return { load, loadClass: LOAD_CLASSES[Math.max(heaviest, 0)] ?? 'light' };
}

/**
 * Opens a job for a sub-order that is ready for pickup (called in the shop's "ready for pickup" transaction, and when
 * a parcel came back for another agent): issues the shop's pickup code and alerts staff in the city.
 */
export async function openDeliveryJob(
  tx: Tx,
  input: {
    orderId: string;
    keyring: Keyring | null;
    seq?: number;
    failedAttempts?: number;
    actor: 'shop' | 'admin' | 'system';
    actorId?: string | null;
  },
): Promise<JobRow> {
  const o = await orderInfo(tx, input.orderId);
  if (!o.shopId) throw new ConflictError('The order has no shop', 'NO_SHOP');
  const { load, loadClass } = await loadOf(tx, o.id);
  const [job] = await tx
    .insert(deliveryJobs)
    .values({
      orderId: o.id,
      cityId: o.cityId,
      shopId: o.shopId,
      seq: input.seq ?? 1,
      failedAttempts: input.failedAttempts ?? 0,
      loadWeightG: load.knownWeightG,
      loadClass,
      unknownWeight: load.unknownClass !== null,
    })
    .returning();
  if (!job) throw new Error('job insert returned no row');
  await issueHandoverCode(tx, input.keyring, job.id, 'pickup');
  await jobEvent(tx, {
    job,
    kind: 'created',
    to: 'needs_agent',
    actor: input.actor,
    actorId: input.actorId ?? null,
  });
  await queueStaffNotice(tx, {
    kind: 'staff.delivery_needs_agent',
    cityId: o.cityId,
    entityId: job.id,
    version: 1,
    params: { orderCode: o.code },
  });
  await recordServerEvent(tx, 'delivery_job_created', {
    userId: input.actorId ?? null,
    cityId: o.cityId,
    props: { jobId: job.id, orderCode: o.code, seq: job.seq, loadClass, loadWeightG: load.knownWeightG },
  });
  return job;
}

/** The active job of a sub-order, locked (after the order row). */
async function activeJobOf(tx: Tx, orderId: string): Promise<JobRow | null> {
  const [j] = await tx
    .select()
    .from(deliveryJobs)
    .where(
      and(
        eq(deliveryJobs.orderId, orderId),
        inArray(deliveryJobs.status, [
          'needs_agent',
          'offered',
          'accepted',
          'picked_up',
          'failed',
          'returning',
        ]),
      ),
    )
    .for('update');
  return j ?? null;
}

/**
 * Cancels the active job of a sub-order that is cancelled or switched to the shop's own delivery before pickup
 * (called inside the caller's transaction, after the order row was locked). Open offers are withdrawn.
 */
export async function cancelActiveDeliveryJob(
  tx: Tx,
  input: { orderId: string; reason: string; actor: 'admin' | 'system' | 'shop'; actorId?: string | null },
): Promise<boolean> {
  const job = await activeJobOf(tx, input.orderId);
  if (!job) return false;
  if (!['needs_agent', 'offered', 'accepted'].includes(job.status))
    throw new ConflictError('The parcel is already with an agent', 'JOB_PICKED_UP');
  await tx
    .update(deliveryJobOffers)
    .set({ status: 'withdrawn', respondedAt: sql`now()`, reasonCode: 'order_changed' })
    .where(
      and(eq(deliveryJobOffers.jobId, job.id), inArray(deliveryJobOffers.status, ['offered', 'accepted'])),
    );
  await transitionJob(tx, {
    job,
    to: 'cancelled',
    actor: input.actor === 'shop' ? 'system' : input.actor,
    actorId: input.actorId ?? null,
    patch: { cancelReason: input.reason, closedAt: new Date() },
    reasonCode: input.reason,
  });
  await closeHandoverCode(tx, job.id, 'pickup');
  if (job.agentId) {
    const [a] = await tx
      .select({ userId: deliveryAgents.userId })
      .from(deliveryAgents)
      .where(eq(deliveryAgents.id, job.agentId))
      .limit(1);
    const o = await orderInfo(tx, input.orderId);
    if (a)
      await queueNotice(tx, {
        kind: 'delivery.job_withdrawn',
        userId: a.userId,
        entityId: job.id,
        version: job.version + 1,
        params: { orderCode: o.code },
      });
  }
  return true;
}

// ── suggestions and offers (staff) ─────────────────────────────────────────────────────────────────────────────

export interface AgentSuggestionRow {
  agentId: string;
  name: string;
  vehicleType: AgentVehicleType;
  distanceM: number | null;
  activeJobs: number;
  acceptanceRateBp: number | null;
  carriesLoad: boolean;
  ratingAvgX10: number | null;
  ratingCount: number;
  eligible: boolean;
  /** Declined, let the offer run out or gave this job up already (DC-B10). */
  declinedBefore: boolean;
}

/**
 * Ranked agents for a job (Lead's call 1 + founder 2026-11-26 ratings): active, verified, online agents of the job's
 * city who can carry the load and hold fewer than the maximum jobs, not already tried on this job. Order: nearest to
 * the shop, fewest active jobs, acceptance rate (30 days), rating (weight `delivery.rank_rating_weight_pct`).
 */
export async function suggestAgents(tx: Tx, job: JobRow): Promise<AgentSuggestionRow[]> {
  const settings = await deliverySettings(tx, job.cityId);
  const rows = rowsOf<{
    id: string;
    name: string;
    vehicle_type: string;
    distance_m: unknown;
    active_jobs: unknown;
    offers: unknown;
    accepted: unknown;
    rating_sum: unknown;
    rating_count: unknown;
    tried: boolean;
  }>(
    await tx.execute(sql`
      select a.id, a.name, a.vehicle_type,
        case when a.home_location is null or s.location is null then null
          else st_distance(a.home_location, s.location) end as distance_m,
        (select count(*) from delivery_jobs j where j.agent_id = a.id and j.status in ('accepted','picked_up','failed','returning')) as active_jobs,
        (select count(*) from delivery_job_offers o where o.agent_id = a.id and o.offered_at > now() - interval '30 days' and o.status <> 'offered') as offers,
        (select count(*) from delivery_job_offers o where o.agent_id = a.id and o.offered_at > now() - interval '30 days' and o.status in ('accepted','given_up')) as accepted,
        a.rating_sum, a.rating_count,
        exists (select 1 from delivery_job_offers o where o.job_id = ${job.id}::uuid and o.agent_id = a.id
          and o.status in ('declined','expired','given_up')) as tried
      from delivery_agents a
      join shops s on s.id = ${job.shopId}::uuid
      where a.city_id = ${job.cityId}::uuid and a.status = 'active' and a.online and a.verified_at is not null
        and (select count(*) from delivery_agent_documents d where d.agent_id = a.id and d.status = 'verified') >= 3
      limit 200`),
  );
  const load = {
    knownWeightG: job.loadWeightG,
    unknownClass: job.unknownWeight ? (job.loadClass as LoadClass) : null,
  };
  const out = rows.map((r) => {
    const vehicleType = r.vehicle_type as AgentVehicleType;
    const offers = num(r.offers);
    const activeJobs = num(r.active_jobs);
    const carries =
      vehicleCarries(vehicleType, load, settings.maxLoadKg) &&
      // A line without a weight still needs a vehicle for the job's class.
      (job.unknownWeight ||
        vehicleCarries(
          vehicleType,
          { knownWeightG: 0, unknownClass: job.loadClass as LoadClass },
          settings.maxLoadKg,
        ));
    return {
      agentId: r.id,
      name: r.name,
      vehicleType,
      distanceM: numOrNull(r.distance_m) === null ? null : Math.round(num(r.distance_m)),
      activeJobs,
      acceptanceRateBp: offers > 0 ? Math.round((num(r.accepted) * 10_000) / offers) : null,
      carriesLoad: carries,
      ratingAvgX10: ratingAverageX10(num(r.rating_sum), num(r.rating_count)),
      ratingCount: num(r.rating_count),
      eligible: carries && !r.tried && activeJobs < settings.maxActiveJobs,
      declinedBefore: r.tried,
    };
  });
  const w = settings.rankRatingWeightPct / 100;
  const score = (s: AgentSuggestionRow) => {
    const dist = s.distanceM === null ? 1 : Math.min(1, s.distanceM / 20_000);
    const busy = Math.min(1, s.activeJobs / Math.max(1, settings.maxActiveJobs));
    const accept = s.acceptanceRateBp === null ? 0.5 : 1 - s.acceptanceRateBp / 10_000;
    const rating = s.ratingAvgX10 === null ? 0.5 : 1 - (s.ratingAvgX10 - 10) / 40;
    return (1 - w) * (0.6 * dist + 0.25 * busy + 0.15 * accept) + w * rating;
  };
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || score(a) - score(b));
}

async function scopedJob(
  tx: Tx,
  scope: CityScope,
  jobId: string,
): Promise<{ job: JobRow; orderVersion: number; orderStatus: OrderStatus }> {
  const [probe] = await tx
    .select({ orderId: deliveryJobs.orderId, cityId: deliveryJobs.cityId })
    .from(deliveryJobs)
    .where(eq(deliveryJobs.id, jobId))
    .limit(1);
  if (!probe || !inScope(scope, probe.cityId)) throw new NotFoundError('Delivery job not found');
  const o = await lockOrder(tx, probe.orderId);
  const job = await lockJob(tx, jobId);
  return { job, orderVersion: o.version, orderStatus: o.status };
}

/** Staff offer a job to one agent (offer timer from the city setting, default 15 min). */
export async function offerDeliveryJob(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; jobId: string; agentId: string; expectedVersion: number },
): Promise<{ offerId: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    const { job } = await scopedJob(tx, input.scope, input.jobId);
    if (job.status !== 'needs_agent') throw new ConflictError(`The job is ${job.status}`, 'JOB_CHANGED');
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    const settings = await deliverySettings(tx, job.cityId);
    if (!settings.agentsEnabled)
      throw new ConflictError('Delivery agents are not switched on in this city', 'AGENTS_DISABLED');
    // FOR SHARE: a concurrent pause of this agent waits for the offer (and then withdraws it).
    await tx.execute(sql`select id from delivery_agents where id = ${input.agentId}::uuid for share`);
    const pick = (await suggestAgents(tx, job)).find((s) => s.agentId === input.agentId);
    if (!pick) throw new ValidationError('This agent cannot take jobs now', 'AGENT_NOT_ELIGIBLE');
    if (!pick.carriesLoad)
      throw new ValidationError("This agent's vehicle cannot carry this order", 'VEHICLE_CANNOT_CARRY');
    if (!pick.eligible) throw new ValidationError('This agent cannot take this job', 'AGENT_NOT_ELIGIBLE');
    const [offer] = await tx
      .insert(deliveryJobOffers)
      .values({
        jobId: job.id,
        agentId: input.agentId,
        offeredBy: input.staffUserId,
        expiresAt: sql`now() + make_interval(mins => ${settings.offerTimeoutMin})`,
        distanceM: pick.distanceM,
      })
      .returning({ id: deliveryJobOffers.id, expiresAt: deliveryJobOffers.expiresAt });
    if (!offer) throw new Error('offer insert returned no row');
    await transitionJob(tx, {
      job,
      to: 'offered',
      actor: 'admin',
      actorId: input.staffUserId,
      offerId: offer.id,
    });
    await jobEvent(tx, {
      job,
      kind: 'offered',
      offerId: offer.id,
      agentId: input.agentId,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    const o = await orderInfo(tx, job.orderId);
    const [agentUser] = await tx
      .select({
        userId: users.id,
        phone: users.phone,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        language: users.language,
      })
      .from(deliveryAgents)
      .innerJoin(users, eq(users.id, deliveryAgents.userId))
      .where(eq(deliveryAgents.id, input.agentId))
      .limit(1);
    if (agentUser) {
      const minutes = settings.offerTimeoutMin;
      await queueNotice(tx, {
        kind: 'delivery.offer',
        userId: agentUser.userId,
        entityId: offer.id,
        version: 1,
        params: { orderCode: o.code, minutes },
      });
      const locale = agentUser.language === 'hi' ? 'hi' : 'en';
      if (agentUser.phone && (await notificationChannelEnabled(tx, 'delivery.offer', 'whatsapp')))
        await enqueueNotification(tx, {
          dedupeKey: `delivery.offer:${offer.id}:whatsapp`,
          channel: 'whatsapp',
          recipientUserId: agentUser.userId,
          recipient: agentUser.phone,
          templateKey: 'delivery.offer',
          locale,
          payload: { orderCode: o.code, minutes },
        });
      if (agentUser.email && agentUser.emailVerifiedAt)
        await enqueueNotification(tx, {
          dedupeKey: `delivery_offer:${offer.id}:email`,
          channel: 'email',
          recipientUserId: agentUser.userId,
          recipient: agentUser.email,
          templateKey: 'delivery_offer',
          locale,
          payload: { orderCode: o.code, minutes },
        });
    }
    const attempt = await tx.$count(deliveryJobOffers, eq(deliveryJobOffers.jobId, job.id));
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_job.offered',
      entity: 'delivery_job',
      entityId: job.id,
      after: { agentId: input.agentId, offerId: offer.id, attempt },
    });
    await recordServerEvent(tx, 'delivery_job_offered', {
      userId: input.staffUserId,
      cityId: job.cityId,
      props: {
        jobId: job.id,
        orderCode: o.code,
        agentId: input.agentId,
        offerId: offer.id,
        attempt,
        distanceM: pick.distanceM,
      },
    });
    return { offerId: offer.id, expiresAt: offer.expiresAt };
  });
}

/** The agent's own open offer, locked after the order and the job rows; anyone else's offer is 404. */
async function lockOwnOffer(tx: Tx, agentId: string, offerId: string) {
  const [probe] = await tx
    .select({
      jobId: deliveryJobOffers.jobId,
      agentId: deliveryJobOffers.agentId,
      orderId: deliveryJobs.orderId,
    })
    .from(deliveryJobOffers)
    .innerJoin(deliveryJobs, eq(deliveryJobs.id, deliveryJobOffers.jobId))
    .where(eq(deliveryJobOffers.id, offerId))
    .limit(1);
  if (probe?.agentId !== agentId) throw new NotFoundError('Offer not found');
  await lockOrder(tx, probe.orderId);
  const job = await lockJob(tx, probe.jobId);
  const [offer] = await tx
    .select({
      id: deliveryJobOffers.id,
      status: deliveryJobOffers.status,
      offeredAt: deliveryJobOffers.offeredAt,
      live: sql<boolean>`${deliveryJobOffers.expiresAt} > now()`,
    })
    .from(deliveryJobOffers)
    .where(eq(deliveryJobOffers.id, offerId))
    .for('update');
  if (!offer) throw new NotFoundError('Offer not found');
  return { job, offer };
}

export async function acceptDeliveryOffer(
  db: Tx,
  input: { userId: string; offerId: string },
): Promise<{ jobId: string }> {
  return db.transaction(async (tx) => {
    const agent = await agentOfUser(tx, input.userId);
    const { job, offer } = await lockOwnOffer(tx, agent.id, input.offerId);
    if (offer.status !== 'offered' || job.status !== 'offered')
      throw new ConflictError('This offer is no longer open', 'OFFER_EXPIRED');
    if (!offer.live) throw new ConflictError('This offer has run out of time', 'OFFER_EXPIRED');
    // Standing re-checked under a share lock: a pause after the offer went out wins.
    const [standing] = rowsOf<{ status: string }>(
      await tx.execute(sql`select status from delivery_agents where id = ${agent.id}::uuid for share`),
    );
    if (standing?.status !== 'active')
      throw new ForbiddenError('Your account is not active for deliveries', 'AGENT_NOT_ACTIVE');
    if (!(await allDocumentsVerified(tx, agent.id)))
      throw new ForbiddenError('Your documents must be verified again', 'DOCUMENTS_NOT_VERIFIED');
    const settings = await deliverySettings(tx, job.cityId);
    const held = await tx.$count(
      deliveryJobs,
      and(eq(deliveryJobs.agentId, agent.id), inArray(deliveryJobs.status, [...ACTIVE_AGENT_JOBS])),
    );
    if (held >= settings.maxActiveJobs)
      throw new ConflictError('You already hold the most jobs you can', 'TOO_MANY_ACTIVE_JOBS');
    deliveryOfferMachine.assert('offered', 'accepted', 'delivery_agent');
    const taken = await tx
      .update(deliveryJobOffers)
      .set({ status: 'accepted', respondedAt: sql`now()` })
      .where(and(eq(deliveryJobOffers.id, offer.id), eq(deliveryJobOffers.status, 'offered')))
      .returning({ id: deliveryJobOffers.id });
    if (taken.length === 0) throw new ConflictError('This offer is no longer open', 'OFFER_EXPIRED');
    const now = new Date();
    const row = await transitionJob(tx, {
      job,
      to: 'accepted',
      actor: 'delivery_agent',
      actorId: input.userId,
      patch: { agentId: agent.id, acceptedAt: now },
      offerId: offer.id,
    });
    const o = await orderInfo(tx, job.orderId);
    if (o.shopId) await noticeShop(tx, o.shopId, 'shop.delivery_agent_assigned', o.id, o.code, row.version);
    await recordServerEvent(tx, 'delivery_offer_accepted', {
      userId: input.userId,
      cityId: job.cityId,
      props: {
        jobId: job.id,
        offerId: offer.id,
        agentId: agent.id,
        secondsToAccept: secondsBetween(offer.offeredAt, now),
      },
    });
    return { jobId: job.id };
  });
}

export async function declineDeliveryOffer(
  db: Tx,
  input: { userId: string; offerId: string; reasonCode: DeliveryDeclineReason; note?: string | undefined },
): Promise<void> {
  await db.transaction(async (tx) => {
    const agent = await activeAgentOfUser(tx, input.userId);
    const { job, offer } = await lockOwnOffer(tx, agent.id, input.offerId);
    if (offer.status !== 'offered') throw new ConflictError('This offer is no longer open', 'OFFER_EXPIRED');
    deliveryOfferMachine.assert('offered', 'declined', 'delivery_agent');
    await tx
      .update(deliveryJobOffers)
      .set({
        status: 'declined',
        respondedAt: sql`now()`,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
      })
      .where(and(eq(deliveryJobOffers.id, offer.id), eq(deliveryJobOffers.status, 'offered')));
    await transitionJob(tx, {
      job,
      to: 'needs_agent',
      actor: 'delivery_agent',
      actorId: input.userId,
      reasonCode: input.reasonCode,
      offerId: offer.id,
    });
    await jobEvent(tx, {
      job,
      kind: 'offer_declined',
      reasonCode: input.reasonCode,
      offerId: offer.id,
      agentId: agent.id,
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    const o = await orderInfo(tx, job.orderId);
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_declined',
      cityId: job.cityId,
      entityId: offer.id,
      version: 1,
      params: { orderCode: o.code },
    });
    await recordServerEvent(tx, 'delivery_offer_declined', {
      userId: input.userId,
      cityId: job.cityId,
      props: { jobId: job.id, offerId: offer.id, agentId: agent.id, reasonCode: input.reasonCode },
    });
  });
}

/**
 * The worker: offers past their time go back to the admin queue, one transaction each; a failing offer is reported and
 * skipped (the rest still expire).
 */
export async function expireDueDeliveryOffers(
  db: Tx,
  limit = 50,
): Promise<{ due: number; expired: number; failed: { offerId: string; error: unknown }[] }> {
  const due = await db
    .select({
      id: deliveryJobOffers.id,
      jobId: deliveryJobOffers.jobId,
      agentId: deliveryJobOffers.agentId,
      orderId: deliveryJobs.orderId,
    })
    .from(deliveryJobOffers)
    .innerJoin(deliveryJobs, eq(deliveryJobs.id, deliveryJobOffers.jobId))
    .where(and(eq(deliveryJobOffers.status, 'offered'), lte(deliveryJobOffers.expiresAt, sql`now()`)))
    .orderBy(deliveryJobOffers.expiresAt)
    .limit(limit);
  let n = 0;
  const failed: { offerId: string; error: unknown }[] = [];
  for (const d of due) {
    let done = false;
    try {
      done = await db.transaction(async (tx) => {
        await lockOrder(tx, d.orderId);
        const job = await lockJob(tx, d.jobId);
        deliveryOfferMachine.assert('offered', 'expired', 'system');
        const closed = await tx
          .update(deliveryJobOffers)
          .set({ status: 'expired', respondedAt: sql`now()` })
          .where(
            and(
              eq(deliveryJobOffers.id, d.id),
              eq(deliveryJobOffers.status, 'offered'),
              lte(deliveryJobOffers.expiresAt, sql`now()`),
            ),
          )
          .returning({ id: deliveryJobOffers.id });
        if (closed.length === 0) return false;
        if (job.status === 'offered')
          await transitionJob(tx, { job, to: 'needs_agent', actor: 'system', offerId: d.id });
        await jobEvent(tx, {
          job,
          kind: 'offer_expired',
          offerId: d.id,
          agentId: d.agentId,
          actor: 'system',
        });
        // Every mutation is audited (hard rule 3); the sweep had none (DC-B11, QA 2026-11-27).
        await auditDelivery(tx, {
          actorUserId: null,
          actorRole: 'system',
          action: 'delivery_job.offer_expired',
          entity: 'delivery_job',
          entityId: job.id,
          after: { offerId: d.id, agentId: d.agentId },
        });
        const o = await orderInfo(tx, job.orderId);
        await queueStaffNotice(tx, {
          kind: 'staff.delivery_offer_expired',
          cityId: job.cityId,
          entityId: d.id,
          version: 1,
          params: { orderCode: o.code },
        });
        await recordServerEvent(tx, 'delivery_offer_expired', {
          cityId: job.cityId,
          props: { jobId: job.id, offerId: d.id, agentId: d.agentId },
        });
        return true;
      });
    } catch (error) {
      failed.push({ offerId: d.id, error });
    }
    if (done) n += 1;
  }
  return { due: due.length, expired: n, failed };
}

/** Staff take an offered or accepted (not yet picked up) job back; it returns to the queue. */
export async function withdrawDeliveryJob(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    jobId: string;
    reasonCode: DeliveryWithdrawReason;
    expectedVersion: number;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const { job } = await scopedJob(tx, input.scope, input.jobId);
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    if (job.status !== 'offered' && job.status !== 'accepted')
      throw new ConflictError(`The job is ${job.status}`, 'JOB_CHANGED');
    const [offer] = await tx
      .update(deliveryJobOffers)
      .set({ status: 'withdrawn', respondedAt: sql`now()`, reasonCode: input.reasonCode })
      .where(
        and(eq(deliveryJobOffers.jobId, job.id), inArray(deliveryJobOffers.status, ['offered', 'accepted'])),
      )
      .returning({ id: deliveryJobOffers.id, agentId: deliveryJobOffers.agentId });
    await transitionJob(tx, {
      job,
      to: 'needs_agent',
      actor: 'admin',
      actorId: input.staffUserId,
      patch: { agentId: null, acceptedAt: null },
      reasonCode: input.reasonCode,
      offerId: offer?.id ?? null,
    });
    const o = await orderInfo(tx, job.orderId);
    if (offer) {
      await jobEvent(tx, {
        job,
        kind: 'offer_withdrawn',
        reasonCode: input.reasonCode,
        offerId: offer.id,
        agentId: offer.agentId,
        actor: 'admin',
        actorId: input.staffUserId,
      });
      const [a] = await tx
        .select({ userId: deliveryAgents.userId })
        .from(deliveryAgents)
        .where(eq(deliveryAgents.id, offer.agentId))
        .limit(1);
      if (a)
        await queueNotice(tx, {
          kind: 'delivery.job_withdrawn',
          userId: a.userId,
          entityId: offer.id,
          version: 1,
          params: { orderCode: o.code },
        });
      await recordServerEvent(tx, 'delivery_offer_withdrawn', {
        userId: input.staffUserId,
        cityId: job.cityId,
        props: { jobId: job.id, offerId: offer.id, agentId: offer.agentId, reasonCode: input.reasonCode },
      });
    }
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_job.withdrawn',
      entity: 'delivery_job',
      entityId: job.id,
      after: { reasonCode: input.reasonCode },
    });
  });
}

/** The agent's own job (held or offered to them), locked after the order row; 404 for anyone else. */
async function lockOwnJob(tx: Tx, agentId: string, jobId: string) {
  const [probe] = await tx
    .select({ orderId: deliveryJobs.orderId, agentId: deliveryJobs.agentId })
    .from(deliveryJobs)
    .where(eq(deliveryJobs.id, jobId))
    .limit(1);
  if (probe?.agentId !== agentId) throw new NotFoundError('Delivery job not found');
  const o = await lockOrder(tx, probe.orderId);
  const job = await lockJob(tx, jobId);
  if (job.agentId !== agentId) throw new NotFoundError('Delivery job not found');
  return { job, order: o };
}

/** The agent gives up an accepted job before pickup (reason code); it returns to the queue. */
export async function giveUpDeliveryJob(
  db: Tx,
  input: {
    userId: string;
    jobId: string;
    reasonCode: DeliveryGiveUpReason;
    note?: string | undefined;
    expectedVersion: number;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const agent = await activeAgentOfUser(tx, input.userId);
    const { job } = await lockOwnJob(tx, agent.id, input.jobId);
    if (job.status !== 'accepted') throw new ConflictError(`The job is ${job.status}`, 'JOB_CHANGED');
    deliveryOfferMachine.assert('accepted', 'given_up', 'delivery_agent');
    const [offer] = await tx
      .update(deliveryJobOffers)
      .set({
        status: 'given_up',
        respondedAt: sql`now()`,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
      })
      .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'accepted')))
      .returning({ id: deliveryJobOffers.id });
    await transitionJob(tx, {
      job,
      to: 'needs_agent',
      actor: 'delivery_agent',
      actorId: input.userId,
      expectedVersion: input.expectedVersion,
      patch: { agentId: null, acceptedAt: null },
      reasonCode: input.reasonCode,
      offerId: offer?.id ?? null,
    });
    await jobEvent(tx, {
      job,
      kind: 'offer_given_up',
      reasonCode: input.reasonCode,
      offerId: offer?.id ?? null,
      agentId: agent.id,
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    const o = await orderInfo(tx, job.orderId);
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_needs_agent',
      cityId: job.cityId,
      entityId: job.id,
      version: job.version + 1,
      params: { orderCode: o.code },
    });
    await recordServerEvent(tx, 'delivery_job_given_up', {
      userId: input.userId,
      cityId: job.cityId,
      props: { jobId: job.id, agentId: agent.id, reasonCode: input.reasonCode },
    });
  });
}

// ── pickup, delivery, failure (agent) ──────────────────────────────────────────────────────────────────────────

/** The photo must be one this agent uploaded for this job (owner `delivery_photo`), when photos are required. */
async function checkPhoto(
  tx: Tx,
  input: { jobId: string; userId: string; mediaId: string | undefined; required: boolean },
): Promise<string | null> {
  if (!input.mediaId) {
    if (input.required) throw new ValidationError('Take a photo first', 'PHOTO_REQUIRED');
    return null;
  }
  const [m] = await tx
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, input.mediaId),
        eq(mediaObjects.ownerKind, 'delivery_photo'),
        eq(mediaObjects.ownerId, input.jobId),
        eq(mediaObjects.uploadedBy, input.userId),
        sql`${mediaObjects.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (!m) throw new NotFoundError('Photo not found');
  return m.id;
}

export interface CodeStep {
  ok: boolean;
  attemptsLeft: number;
  locked: boolean;
  status: DeliveryJobStatus;
}

async function shipmentFor(tx: Tx, orderId: string): Promise<string> {
  const [s] = await tx
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.orderId, orderId))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  if (s) {
    await tx.update(shipments).set({ status: 'out_for_delivery' }).where(eq(shipments.id, s.id));
    return s.id;
  }
  const [made] = await tx
    .insert(shipments)
    .values({ orderId, mode: 'agent', status: 'out_for_delivery' })
    .returning({ id: shipments.id });
  if (!made) throw new Error('shipment insert returned no row');
  return made.id;
}

/** Shared tail of a pickup (agent with the shop's code, or the audited override): job + order + customer code. */
async function completePickup(
  tx: Tx,
  input: {
    job: JobRow;
    orderVersion: number;
    keyring: Keyring;
    actor: 'delivery_agent' | 'admin';
    actorId: string;
    photoId: string | null;
    via: 'code' | 'override';
  },
) {
  const now = new Date();
  const row = await transitionJob(tx, {
    job: input.job,
    to: 'picked_up',
    actor: input.actor,
    actorId: input.actorId,
    patch: { pickedUpAt: now, pickupPhotoId: input.photoId },
    mediaId: input.photoId,
  });
  await transitionOrder(tx, {
    orderId: input.job.orderId,
    from: 'ready_for_pickup',
    to: 'out_for_delivery',
    expectedVersion: input.orderVersion,
    actor: { type: input.actor, userId: input.actorId },
  });
  const shipmentId = await shipmentFor(tx, input.job.orderId);
  await issueDeliveryCode(tx, input.keyring, shipmentId);
  const o = await orderInfo(tx, input.job.orderId);
  await queueNotice(tx, {
    kind: 'order.picked_up',
    userId: o.userId,
    entityId: o.id,
    version: o.version,
    params: { orderCode: o.code },
  });
  await recordServerEvent(tx, 'delivery_picked_up', {
    userId: input.actorId,
    cityId: input.job.cityId,
    props: {
      jobId: input.job.id,
      orderCode: o.code,
      agentId: input.job.agentId ?? '',
      via: input.via,
      secondsSinceAccept: secondsBetween(input.job.acceptedAt, now),
    },
  });
  return row;
}

export async function pickupDeliveryJob(
  db: Tx,
  input: {
    userId: string;
    jobId: string;
    pickupCode: string;
    photoMediaId?: string | undefined;
    expectedVersion: number;
    keyring: Keyring | null;
  },
): Promise<CodeStep> {
  const keyring = input.keyring;
  if (!keyring)
    throw new ConflictError('Delivery codes are not configured on this server', 'DELIVERY_CODES_UNAVAILABLE');
  return db.transaction(async (tx) => {
    const agent = await activeAgentOfUser(tx, input.userId);
    const { job, order } = await lockOwnJob(tx, agent.id, input.jobId);
    if (job.status !== 'accepted' || order.status !== 'ready_for_pickup')
      throw new ConflictError(`The job is ${job.status}`, 'WRONG_STEP');
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    const settings = await deliverySettings(tx, job.cityId);
    const photoId = await checkPhoto(tx, {
      jobId: job.id,
      userId: input.userId,
      mediaId: input.photoMediaId,
      required: settings.photosRequired,
    });
    const check = await verifyHandoverCode(tx, keyring, job.id, 'pickup', input.pickupCode);
    if (!check.ok) {
      const locked = check.reason === 'locked';
      await jobEvent(tx, {
        job,
        kind: locked ? 'code_locked' : 'code_wrong',
        reasonCode: 'pickup',
        agentId: agent.id,
        actor: 'delivery_agent',
        actorId: input.userId,
      });
      await recordServerEvent(tx, 'delivery_code_wrong', {
        userId: input.userId,
        cityId: job.cityId,
        props: { jobId: job.id, purpose: 'pickup', locked },
      });
      return {
        ok: false,
        attemptsLeft: check.reason === 'wrong' ? check.attemptsLeft : 0,
        locked,
        status: 'accepted',
      };
    }
    await jobEvent(tx, {
      job,
      kind: 'photo',
      reasonCode: 'pickup',
      mediaId: photoId,
      agentId: agent.id,
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    const row = await completePickup(tx, {
      job,
      orderVersion: order.version,
      keyring,
      actor: 'delivery_agent',
      actorId: input.userId,
      photoId,
      via: 'code',
    });
    return { ok: true, attemptsLeft: 0, locked: false, status: row.status as DeliveryJobStatus };
  });
}

/** Deliver = the customer's code (existing delivery-code rules: 5 tries, lock) + photo; job and order in one go. */
export async function deliverDeliveryJob(
  db: Tx,
  input: {
    userId: string;
    jobId: string;
    deliveryCode: string;
    photoMediaId?: string | undefined;
    expectedVersion: number;
    keyring: Keyring | null;
  },
): Promise<CodeStep> {
  const keyring = input.keyring;
  if (!keyring)
    throw new ConflictError('Delivery codes are not configured on this server', 'DELIVERY_CODES_UNAVAILABLE');
  return db.transaction(async (tx) => {
    const agent = await agentOfUser(tx, input.userId);
    // A paused agent may finish a parcel already picked up (lead ruling 2026-11-26); suspended or offboarded may not.
    if (agent.status !== 'active' && agent.status !== 'paused')
      throw new ForbiddenError('Your account is not active for deliveries', 'AGENT_NOT_ACTIVE');
    const { job, order } = await lockOwnJob(tx, agent.id, input.jobId);
    if (job.status !== 'picked_up' || order.status !== 'out_for_delivery')
      throw new ConflictError(`The job is ${job.status}`, 'WRONG_STEP');
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    const settings = await deliverySettings(tx, job.cityId);
    const photoId = await checkPhoto(tx, {
      jobId: job.id,
      userId: input.userId,
      mediaId: input.photoMediaId,
      required: settings.photosRequired,
    });
    const [shipment] = await tx
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.orderId, job.orderId))
      .orderBy(desc(shipments.createdAt))
      .limit(1);
    if (!shipment) throw new ConflictError('No delivery code was issued', 'NO_DELIVERY_CODE');
    const check = await verifyDeliveryCode(tx, keyring, shipment.id, input.deliveryCode);
    if (!check.ok) {
      const locked = check.reason === 'locked';
      await jobEvent(tx, {
        job,
        kind: locked ? 'code_locked' : 'code_wrong',
        reasonCode: 'delivery',
        agentId: agent.id,
        actor: 'delivery_agent',
        actorId: input.userId,
      });
      await recordServerEvent(tx, 'delivery_code_wrong', {
        userId: input.userId,
        cityId: job.cityId,
        props: { jobId: job.id, purpose: 'delivery', locked },
      });
      return {
        ok: false,
        attemptsLeft: check.reason === 'wrong' ? check.attemptsLeft : 0,
        locked,
        status: 'picked_up',
      };
    }
    const now = new Date();
    await jobEvent(tx, {
      job,
      kind: 'photo',
      reasonCode: 'delivery',
      mediaId: photoId,
      agentId: agent.id,
      actor: 'delivery_agent',
      actorId: input.userId,
    });
    const row = await transitionJob(tx, {
      job,
      to: 'delivered',
      actor: 'delivery_agent',
      actorId: input.userId,
      patch: { deliveredAt: now, deliveryPhotoId: photoId, closedAt: now },
      mediaId: photoId,
    });
    await transitionOrder(tx, {
      orderId: job.orderId,
      from: 'out_for_delivery',
      to: 'delivered',
      expectedVersion: order.version,
      actor: { type: 'delivery_agent', userId: input.userId },
      patch: { deliveredAt: now },
    });
    const o = await orderInfo(tx, job.orderId);
    await recordServerEvent(tx, 'order_delivered', {
      userId: input.userId,
      cityId: job.cityId,
      props: { orderCode: o.code, shopId: job.shopId },
    });
    await recordServerEvent(tx, 'delivery_delivered', {
      userId: input.userId,
      cityId: job.cityId,
      props: {
        jobId: job.id,
        orderCode: o.code,
        agentId: agent.id,
        via: 'code',
        secondsSincePickup: secondsBetween(job.pickedUpAt, now),
        attempt: job.failedAttempts + 1,
      },
    });
    await auditDelivery(tx, {
      actorUserId: input.userId,
      actorRole: 'delivery_agent',
      action: 'order.delivered',
      entity: 'order',
      entityId: job.orderId,
      after: { via: 'code', jobId: job.id },
    });
    return { ok: true, attemptsLeft: 0, locked: false, status: row.status as DeliveryJobStatus };
  });
}

/** The agent could not deliver: reason code (+ note for `other`) and a photo; staff decide retry or return. */
export async function failDeliveryJob(
  db: Tx,
  input: {
    userId: string;
    jobId: string;
    reasonCode: DeliveryFailReason;
    note?: string | undefined;
    photoMediaId?: string | undefined;
    expectedVersion: number;
  },
): Promise<{ version: number }> {
  if (input.reasonCode === 'other' && !input.note?.trim())
    throw new ValidationError('Add a note', 'NOTE_REQUIRED');
  return db.transaction(async (tx) => {
    const agent = await agentOfUser(tx, input.userId);
    if (agent.status !== 'active' && agent.status !== 'paused')
      throw new ForbiddenError('Your account is not active for deliveries', 'AGENT_NOT_ACTIVE');
    const { job } = await lockOwnJob(tx, agent.id, input.jobId);
    if (job.status !== 'picked_up') throw new ConflictError(`The job is ${job.status}`, 'WRONG_STEP');
    const settings = await deliverySettings(tx, job.cityId);
    const photoId = await checkPhoto(tx, {
      jobId: job.id,
      userId: input.userId,
      mediaId: input.photoMediaId,
      required: settings.photosRequired,
    });
    const row = await transitionJob(tx, {
      job,
      to: 'failed',
      actor: 'delivery_agent',
      actorId: input.userId,
      expectedVersion: input.expectedVersion,
      patch: {
        failReason: input.reasonCode,
        failNote: input.note ?? null,
        failPhotoId: photoId,
        failedAt: new Date(),
        failedAttempts: job.failedAttempts + 1,
      },
      reasonCode: input.reasonCode,
      mediaId: photoId,
    });
    const o = await orderInfo(tx, job.orderId);
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_failed',
      cityId: job.cityId,
      entityId: job.id,
      version: row.version,
      params: { orderCode: o.code },
    });
    await queueNotice(tx, {
      kind: 'order.delivery_failed',
      userId: o.userId,
      entityId: o.id,
      version: `fail:${row.version}`,
      params: { orderCode: o.code },
    });
    await recordServerEvent(tx, 'delivery_failed', {
      userId: input.userId,
      cityId: job.cityId,
      props: {
        jobId: job.id,
        orderCode: o.code,
        agentId: agent.id,
        reasonCode: input.reasonCode,
        attempt: row.failedAttempts,
      },
    });
    return { version: row.version };
  });
}

// ── after a failure (staff) and the hand-back (shop) ───────────────────────────────────────────────────────────

/**
 * Staff decide a failed job (Lead's calls 4, 13): retry with the same agent (the parcel stays with them), retry with
 * another agent or close (both: the agent carries it back and the shop confirms with the return code). A retry is
 * refused once the sub-order's failed attempts reach `delivery.max_attempts` (default 2 = one free retry).
 */
export async function decideDeliveryFailure(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    jobId: string;
    decision: 'retry' | 'return_to_shop';
    agent?: DeliveryRetryAgent | undefined;
    expectedVersion: number;
    keyring: Keyring | null;
  },
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const { job } = await scopedJob(tx, input.scope, input.jobId);
    if (job.status !== 'failed') throw new ConflictError(`The job is ${job.status}`, 'WRONG_STEP');
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    const settings = await deliverySettings(tx, job.cityId);
    if (
      input.decision === 'retry' &&
      !retryAllowed({ failedAttempts: job.failedAttempts, maxAttempts: settings.maxAttempts })
    )
      throw new ConflictError('No more attempts left; send it back to the shop', 'RETRY_LIMIT');
    if (input.decision === 'retry' && !input.agent)
      throw new ValidationError('Pick the same or another agent', 'AGENT_REQUIRED');
    const o = await orderInfo(tx, job.orderId);
    const [agentUser] = job.agentId
      ? await tx
          .select({ userId: deliveryAgents.userId })
          .from(deliveryAgents)
          .where(eq(deliveryAgents.id, job.agentId))
          .limit(1)
      : [];
    let row: JobRow;
    if (input.decision === 'retry' && input.agent === 'same') {
      row = await transitionJob(tx, {
        job,
        to: 'picked_up',
        actor: 'admin',
        actorId: input.staffUserId,
        reasonCode: 'retry_same',
      });
      if (agentUser)
        await queueNotice(tx, {
          kind: 'delivery.retry',
          userId: agentUser.userId,
          entityId: job.id,
          version: row.version,
          params: { orderCode: o.code },
        });
    } else {
      const intent = input.decision === 'retry' ? 'retry' : 'close';
      row = await transitionJob(tx, {
        job,
        to: 'returning',
        actor: 'admin',
        actorId: input.staffUserId,
        patch: { returnIntent: intent },
        reasonCode: intent === 'retry' ? 'retry_other' : 'close',
      });
      await issueHandoverCode(tx, input.keyring, job.id, 'return');
      if (agentUser)
        await queueNotice(tx, {
          kind: 'delivery.return_to_shop',
          userId: agentUser.userId,
          entityId: job.id,
          version: row.version,
          params: { orderCode: o.code },
        });
      await noticeShop(tx, job.shopId, 'shop.delivery_returning', o.id, o.code, row.version);
    }
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_job.failure_decided',
      entity: 'delivery_job',
      entityId: job.id,
      after: { decision: input.decision, agent: input.agent ?? null },
    });
    await recordServerEvent(tx, 'delivery_failure_decided', {
      userId: input.staffUserId,
      cityId: job.cityId,
      props: { jobId: job.id, orderCode: o.code, decision: input.decision, agent: input.agent ?? null },
    });
    return { version: row.version };
  });
}

/** Every failure reason of a sub-order, oldest first (for the refund rule). */
async function failureReasons(tx: Tx, orderId: string): Promise<DeliveryFailReason[]> {
  const rows = await tx
    .select({ reason: deliveryJobEvents.reasonCode })
    .from(deliveryJobEvents)
    .where(
      and(
        eq(deliveryJobEvents.orderId, orderId),
        eq(deliveryJobEvents.kind, 'status'),
        eq(deliveryJobEvents.toStatus, 'failed'),
      ),
    )
    .orderBy(deliveryJobEvents.id);
  return rows.map((r) => r.reason as DeliveryFailReason);
}

/**
 * The parcel is back at the shop (shop types the agent's return code, or the audited staff override). Retry → the
 * sub-order is ready for pickup again and a new job waits for another agent. Close → the sub-order ends `returned`
 * (reason = last failure), stock goes back to the shop, Coins and coupon are restored and the refund is requested
 * (full, or parts only when the customer was at fault: Lead's call 13).
 */
async function completeReturn(
  tx: Tx,
  input: {
    job: JobRow;
    orderVersion: number;
    keyring: Keyring | null;
    actor: 'shop' | 'admin';
    actorId: string;
    via: 'code' | 'override';
  },
) {
  const intent = (input.job.returnIntent ?? 'close') as 'retry' | 'close';
  const now = new Date();
  await transitionJob(tx, {
    job: input.job,
    to: 'returned',
    actor: input.actor,
    actorId: input.actorId,
    patch: { returnOutcome: intent, returnedAt: now, closedAt: now },
  });
  await tx.update(shipments).set({ status: 'returned' }).where(eq(shipments.orderId, input.job.orderId));
  const o = await orderInfo(tx, input.job.orderId);
  let refundKind: string | null = null;
  if (intent === 'retry') {
    await transitionOrder(tx, {
      orderId: o.id,
      from: 'out_for_delivery',
      to: 'ready_for_pickup',
      expectedVersion: input.orderVersion,
      actor: { type: input.actor, userId: input.actorId },
    });
    await openDeliveryJob(tx, {
      orderId: o.id,
      keyring: input.keyring,
      seq: input.job.seq + 1,
      failedAttempts: input.job.failedAttempts,
      actor: input.actor === 'shop' ? 'shop' : 'admin',
      actorId: input.actorId,
    });
  } else {
    const reasons = await failureReasons(tx, o.id);
    const kind = returnRefundKind(reasons);
    refundKind = kind;
    await restoreCommittedStock(tx, o.id);
    await transitionOrder(tx, {
      orderId: o.id,
      from: 'out_for_delivery',
      to: 'returned',
      expectedVersion: input.orderVersion,
      actor: { type: input.actor, userId: input.actorId },
      patch: { statusReasonCode: reasons.at(-1) ?? 'other' },
      returnRefund: kind,
    });
    await queueNotice(tx, {
      kind: 'order.returned',
      userId: o.userId,
      entityId: o.id,
      version: o.version + 1,
      params: { orderCode: o.code },
    });
  }
  await recordServerEvent(tx, 'delivery_returned', {
    userId: input.actorId,
    cityId: input.job.cityId,
    props: { jobId: input.job.id, orderCode: o.code, outcome: intent, via: input.via, refundKind },
  });
  await auditDelivery(tx, {
    actorUserId: input.actorId,
    actorRole: input.actor === 'shop' ? 'shop' : 'staff',
    action: 'delivery_job.returned',
    entity: 'delivery_job',
    entityId: input.job.id,
    after: { outcome: intent, via: input.via, refundKind },
  });
}

/** The shop confirms the hand-back with the agent's 4-digit return code (5 tries, then the staff override). */
export async function confirmDeliveryReturn(
  db: Tx,
  input: {
    shopIds: readonly string[];
    staffUserId: string;
    orderCode: string;
    returnCode: string;
    keyring: Keyring | null;
  },
): Promise<CodeStep> {
  return db.transaction(async (tx) => {
    const [probe] = await tx
      .select({ id: orders.id, shopId: orders.shopId })
      .from(orders)
      .where(eq(orders.code, input.orderCode))
      .limit(1);
    if (!probe?.shopId || !input.shopIds.includes(probe.shopId)) throw new NotFoundError('Order not found');
    const o = await lockOrder(tx, probe.id);
    const job = await activeJobOf(tx, probe.id);
    if (job?.status !== 'returning' || o.status !== 'out_for_delivery')
      throw new ConflictError('Nothing is coming back for this order', 'WRONG_STEP');
    const check = await verifyHandoverCode(tx, input.keyring, job.id, 'return', input.returnCode);
    if (!check.ok) {
      const locked = check.reason === 'locked';
      await jobEvent(tx, {
        job,
        kind: locked ? 'code_locked' : 'code_wrong',
        reasonCode: 'return',
        actor: 'shop',
        actorId: input.staffUserId,
      });
      await recordServerEvent(tx, 'delivery_code_wrong', {
        userId: input.staffUserId,
        cityId: job.cityId,
        props: { jobId: job.id, purpose: 'return', locked },
      });
      return {
        ok: false,
        attemptsLeft: check.reason === 'wrong' ? check.attemptsLeft : 0,
        locked,
        status: 'returning',
      };
    }
    await completeReturn(tx, {
      job,
      orderVersion: o.version,
      keyring: input.keyring,
      actor: 'shop',
      actorId: input.staffUserId,
      via: 'code',
    });
    return { ok: true, attemptsLeft: 0, locked: false, status: 'returned' };
  });
}

/** Audited staff overrides when a code is locked or lost (reason 5–300 characters). */
export async function overrideDeliveryJob(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    jobId: string;
    kind: 'pickup' | 'delivery' | 'return';
    reason: string;
    expectedVersion: number;
    keyring: Keyring | null;
  },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 300)
    throw new ValidationError('Give a reason (5 to 300 characters)', 'OVERRIDE_REASON');
  await db.transaction(async (tx) => {
    const { job, orderVersion } = await scopedJob(tx, input.scope, input.jobId);
    if (job.version !== input.expectedVersion)
      throw new ConflictError('This delivery job changed meanwhile', 'JOB_CHANGED');
    const overrideKind = `override_${input.kind}` as const;
    await tx
      .update(deliveryJobs)
      .set({ overrideKind, overrideReason: reason, overrideBy: input.staffUserId })
      .where(eq(deliveryJobs.id, job.id));
    const fresh = await lockJob(tx, job.id);
    await jobEvent(tx, {
      job,
      kind: 'override',
      reasonCode: input.kind,
      actor: 'admin',
      actorId: input.staffUserId,
    });
    if (input.kind === 'pickup') {
      if (fresh.status !== 'accepted') throw new ConflictError(`The job is ${fresh.status}`, 'WRONG_STEP');
      if (!input.keyring)
        throw new ConflictError(
          'Delivery codes are not configured on this server',
          'DELIVERY_CODES_UNAVAILABLE',
        );
      await closeHandoverCode(tx, job.id, 'pickup');
      await completePickup(tx, {
        job: fresh,
        orderVersion,
        keyring: input.keyring,
        actor: 'admin',
        actorId: input.staffUserId,
        photoId: null,
        via: 'override',
      });
    } else if (input.kind === 'delivery') {
      if (fresh.status !== 'picked_up') throw new ConflictError(`The job is ${fresh.status}`, 'WRONG_STEP');
      const [shipment] = await tx
        .select({ id: shipments.id })
        .from(shipments)
        .where(eq(shipments.orderId, job.orderId))
        .orderBy(desc(shipments.createdAt))
        .limit(1);
      if (!shipment) throw new ConflictError('No shipment', 'NO_SHIPMENT');
      await overrideShipmentInTx(tx, { shipmentId: shipment.id, staffUserId: input.staffUserId, reason });
      const now = new Date();
      await transitionJob(tx, {
        job: fresh,
        to: 'delivered',
        actor: 'admin',
        actorId: input.staffUserId,
        patch: { deliveredAt: now, closedAt: now },
      });
      await transitionOrder(tx, {
        orderId: job.orderId,
        from: 'out_for_delivery',
        to: 'delivered',
        expectedVersion: orderVersion,
        actor: { type: 'admin', userId: input.staffUserId },
        patch: { deliveredAt: now },
      });
      const o = await orderInfo(tx, job.orderId);
      await recordServerEvent(tx, 'admin_delivery_override', {
        userId: input.staffUserId,
        cityId: job.cityId,
        props: { orderCode: o.code },
      });
      await recordServerEvent(tx, 'delivery_delivered', {
        userId: input.staffUserId,
        cityId: job.cityId,
        props: {
          jobId: job.id,
          orderCode: o.code,
          agentId: job.agentId ?? '',
          via: 'override',
          secondsSincePickup: secondsBetween(job.pickedUpAt, now),
          attempt: job.failedAttempts + 1,
        },
      });
    } else {
      if (fresh.status !== 'returning') throw new ConflictError(`The job is ${fresh.status}`, 'WRONG_STEP');
      await closeHandoverCode(tx, job.id, 'return');
      await completeReturn(tx, {
        job: fresh,
        orderVersion,
        keyring: input.keyring,
        actor: 'admin',
        actorId: input.staffUserId,
        via: 'override',
      });
    }
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: `delivery_job.${overrideKind}`,
      entity: 'delivery_job',
      entityId: job.id,
      reason,
    });
  });
}

// ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────────

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

interface Snapshot {
  contactName?: string;
  contactPhone?: string;
  line1?: string;
  line2?: string | null;
  landmark?: string | null;
  pincode?: string;
}

/** The agent's jobs: open offers, held jobs, or finished ones (newest first). */
export async function listAgentJobs(
  db: Tx,
  input: { userId: string; view: 'offers' | 'active' | 'done'; limit: number; before?: Date | null },
) {
  const agent = await agentOfUser(db, input.userId);
  const rows = rowsOf<{
    job_id: string;
    code: string;
    status: string;
    offer_id: string | null;
    offer_expires_at: Date | string | null;
    items: unknown;
    load_class: string;
    load_weight_g: unknown;
    unknown_weight: boolean;
    locality: string | null;
    locality_hi: string | null;
    pincode: string;
    distance_m: unknown;
    failed_attempts: unknown;
    updated_at: Date | string;
  }>(
    await db.execute(sql`
      select j.id as job_id, o.code, j.status, f.id as offer_id, f.expires_at as offer_expires_at,
        (select coalesce(sum(oi.qty), 0) from order_items oi where oi.order_id = o.id) as items,
        j.load_class, j.load_weight_g, j.unknown_weight, sp.locality, sp.locality_hi, o.pincode, f.distance_m, j.failed_attempts,
        j.updated_at
      from delivery_jobs j
      join orders o on o.id = j.order_id
      join shops s on s.id = j.shop_id
      left join pincodes sp on sp.pincode = s.pincode
      left join delivery_job_offers f on f.job_id = j.id and f.agent_id = ${agent.id}::uuid and f.status = 'offered'
      where ${
        input.view === 'offers'
          ? sql`f.id is not null and f.expires_at > now() and j.status = 'offered'`
          : input.view === 'active'
            ? sql`j.agent_id = ${agent.id}::uuid and j.status in ('accepted','picked_up','failed','returning')`
            : sql`j.agent_id = ${agent.id}::uuid and j.status in ('delivered','returned')`
      }
      ${input.before ? sql`and j.updated_at < ${input.before}` : sql``}
      order by j.updated_at desc
      limit ${input.limit + 1}`),
  );
  const items = rows.slice(0, input.limit).map((r) => ({
    jobId: r.job_id,
    orderCode: r.code,
    status: r.status as DeliveryJobStatus,
    offerId: r.offer_id,
    offerExpiresAt: r.offer_expires_at ? new Date(r.offer_expires_at).toISOString() : null,
    itemCount: num(r.items),
    loadClass: r.load_class as LoadClass,
    weightKg: r.unknown_weight ? null : Math.round(num(r.load_weight_g) / 100) / 10,
    shopArea: r.locality,
    // Rule 10 (DC-P15): the Hindi area name, picked by the screen on /hi.
    shopAreaHi: r.locality_hi,
    customerPincode: r.pincode,
    distanceM: numOrNull(r.distance_m) === null ? null : Math.round(num(r.distance_m)),
    attempt: num(r.failed_attempts) + 1,
    updatedAt: new Date(r.updated_at),
  }));
  return { items, more: rows.length > input.limit };
}

/**
 * One job for the agent, with contacts by stage (Lead's call 6): pickup → shop + customer area/PIN; drop → + the
 * customer's name, address and phone; return → shop only; closed → none. Each first reveal of a stage is written to
 * the job timeline (audited). Never the customer's delivery code, never the shop's pickup code.
 */
export async function getAgentJob(db: Tx, input: { userId: string; jobId: string; keyring: Keyring | null }) {
  return db.transaction(async (tx) => {
    const agent = await agentOfUser(tx, input.userId);
    const [j] = await tx.select().from(deliveryJobs).where(eq(deliveryJobs.id, input.jobId)).limit(1);
    if (!j) throw new NotFoundError('Delivery job not found');
    const [openOffer] = await tx
      .select({ id: deliveryJobOffers.id, expiresAt: deliveryJobOffers.expiresAt })
      .from(deliveryJobOffers)
      .where(
        and(
          eq(deliveryJobOffers.jobId, j.id),
          eq(deliveryJobOffers.agentId, agent.id),
          eq(deliveryJobOffers.status, 'offered'),
          // An offer past its timer shows nothing even before the sweep closes it.
          sql`${deliveryJobOffers.expiresAt} > now()`,
        ),
      )
      .limit(1);
    const mine = j.agentId === agent.id;
    if (!mine && !openOffer) throw new NotFoundError('Delivery job not found');
    // Only an active agent sees jobs; a paused agent still sees the parcels they hold so they can finish them (lead
    // ruling 2026-11-26); a suspended or offboarded agent sees nothing (staff take over).
    if (
      agent.status !== 'active' &&
      !(agent.status === 'paused' && mine && ['picked_up', 'failed', 'returning'].includes(j.status))
    )
      throw new ForbiddenError('Your account is not active for deliveries', 'AGENT_NOT_ACTIVE');
    const stage = mine ? contactStage(j.status as DeliveryJobStatus) : openOffer ? 'pickup' : 'none';
    const [o] = await tx.select().from(orders).where(eq(orders.id, j.orderId)).limit(1);
    const [s] = rowsOf<{
      name: string;
      name_hi: string | null;
      address_line: string;
      pincode: string;
      phone: string;
      lat: unknown;
      lng: unknown;
      locality: string | null;
      locality_hi: string | null;
    }>(
      await tx.execute(sql`select s.name, s.name_hi, s.address_line, s.pincode, s.phone,
          st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng, p.locality, p.locality_hi
        from shops s left join pincodes p on p.pincode = ${o?.pincode ?? ''} where s.id = ${j.shopId}::uuid`),
    );
    const items = await tx
      .select({ name: orderItems.title, nameHi: orderItems.titleHi, quantity: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, j.orderId));
    const addr = (o?.shippingAddress ?? {}) as Snapshot;
    const settings = await deliverySettings(tx, j.cityId);
    if (stage !== 'none') {
      const [seen] = await tx
        .select({ id: deliveryJobEvents.id })
        .from(deliveryJobEvents)
        .where(
          and(
            eq(deliveryJobEvents.jobId, j.id),
            eq(deliveryJobEvents.kind, 'contact_revealed'),
            eq(deliveryJobEvents.agentId, agent.id),
            eq(deliveryJobEvents.reasonCode, stage),
          ),
        )
        .limit(1);
      if (!seen) {
        await jobEvent(tx, {
          job: j,
          kind: 'contact_revealed',
          reasonCode: stage,
          agentId: agent.id,
          actor: 'delivery_agent',
          actorId: input.userId,
        });
        await recordServerEvent(tx, 'delivery_contact_revealed', {
          userId: input.userId,
          cityId: j.cityId,
          props: { jobId: j.id, agentId: agent.id, stage },
        });
      }
    }
    const pickupCode = mine ? await readHandoverCode(tx, input.keyring, j.id, 'pickup') : null;
    const returnCode =
      mine && j.status === 'returning' ? await readHandoverCode(tx, input.keyring, j.id, 'return') : null;
    const [shipment] = await tx
      .select({ attempts: shipments.deliveryCodeAttempts })
      .from(shipments)
      .where(eq(shipments.orderId, j.orderId))
      .orderBy(desc(shipments.createdAt))
      .limit(1);
    const showShop = stage === 'pickup' || stage === 'drop' || stage === 'return';
    return {
      jobId: j.id,
      orderCode: o?.code ?? '',
      status: j.status as DeliveryJobStatus,
      offerId: openOffer?.id ?? null,
      offerExpiresAt: openOffer?.expiresAt.toISOString() ?? null,
      items,
      loadClass: j.loadClass as LoadClass,
      weightKg: j.unknownWeight ? null : Math.round(j.loadWeightG / 100) / 10,
      contact: {
        stage,
        shop:
          showShop && s
            ? {
                name: s.name,
                nameHi: s.name_hi,
                addressLine: s.address_line,
                pincode: s.pincode,
                phone: s.phone,
                lat: numOrNull(s.lat),
                lng: numOrNull(s.lng),
              }
            : null,
        customer:
          stage === 'pickup'
            ? {
                area: s?.locality ?? null,
                areaHi: s?.locality_hi ?? null,
                pincode: o?.pincode ?? '',
                name: null,
                addressLine: null,
                landmark: null,
                phone: null,
              }
            : stage === 'drop'
              ? {
                  area: s?.locality ?? null,
                  areaHi: s?.locality_hi ?? null,
                  pincode: o?.pincode ?? '',
                  name: addr.contactName ?? null,
                  addressLine: [addr.line1, addr.line2].filter(Boolean).join(', ') || null,
                  landmark: addr.landmark ?? null,
                  phone: addr.contactPhone ?? null,
                }
              : null,
      },
      returnCode: returnCode?.code ?? null,
      photosRequired: settings.photosRequired,
      pickupLocked: pickupCode?.locked ?? false,
      deliveryLocked: (shipment?.attempts ?? 0) >= 5,
      failReason: (j.failReason as DeliveryFailReason | null) ?? null,
      attempt: j.failedAttempts + 1,
      version: j.version,
    };
  });
}

export type AdminJobView = 'needs_agent' | 'offered' | 'active' | 'failed' | 'returning' | 'done' | 'all';
const VIEW_STATUSES: Record<AdminJobView, readonly DeliveryJobStatus[]> = {
  needs_agent: ['needs_agent'],
  offered: ['offered'],
  active: ['accepted', 'picked_up'],
  failed: ['failed'],
  returning: ['returning'],
  done: ['delivered', 'returned', 'cancelled'],
  all: [
    'needs_agent',
    'offered',
    'accepted',
    'picked_up',
    'failed',
    'returning',
    'delivered',
    'returned',
    'cancelled',
  ],
};

export async function listAdminJobs(
  db: Tx,
  input: {
    scope: CityScope;
    view: AdminJobView;
    limit: number;
    before?: Date | null;
    jobId?: string;
    /** The jobs of one sub-order (admin order page). */
    orderCode?: string | undefined;
  },
) {
  const scopeSql = input.scope.all
    ? sql`true`
    : input.scope.cityIds.length === 0
      ? sql`false`
      : sql`j.city_id in (${sql.join(
          input.scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const statuses = VIEW_STATUSES[input.view];
  const rows = rowsOf<{
    job_id: string;
    code: string;
    city_code: string;
    status: string;
    order_status: string;
    shop_name: string;
    shop_name_hi: string | null;
    pincode: string;
    agent_id: string | null;
    agent_name: string | null;
    vehicle_type: string | null;
    offer_expires_at: Date | string | null;
    load_class: string;
    load_weight_g: unknown;
    unknown_weight: boolean;
    failed_attempts: unknown;
    fail_reason: string | null;
    updated_at: Date | string;
    version: number;
  }>(
    await db.execute(sql`
      select j.id as job_id, o.code, c.code as city_code, j.status, o.status as order_status, s.name as shop_name, s.name_hi as shop_name_hi, o.pincode,
        coalesce(a.id, oa.id) as agent_id, coalesce(a.name, oa.name) as agent_name, coalesce(a.vehicle_type, oa.vehicle_type) as vehicle_type,
        f.expires_at as offer_expires_at, j.load_class, j.load_weight_g, j.unknown_weight, j.failed_attempts, j.fail_reason,
        j.updated_at, j.version
      from delivery_jobs j
      join orders o on o.id = j.order_id
      join cities c on c.id = j.city_id
      join shops s on s.id = j.shop_id
      left join delivery_agents a on a.id = j.agent_id
      left join delivery_job_offers f on f.job_id = j.id and f.status = 'offered'
      left join delivery_agents oa on oa.id = f.agent_id
      where ${scopeSql} and ${
        input.jobId
          ? sql`j.id = ${input.jobId}::uuid`
          : sql`j.status in (${sql.join(
              statuses.map((st) => sql`${st}`),
              sql`, `,
            )})`
      }
      ${input.before ? sql`and j.updated_at < ${input.before}` : sql``}
      ${input.orderCode ? sql`and o.code = ${input.orderCode}` : sql``}
      order by j.updated_at ${input.view === 'done' ? sql`desc` : sql`asc`}
      limit ${input.limit + 1}`),
  );
  const now = Date.now();
  const items = rows.slice(0, input.limit).map((r) => ({
    jobId: r.job_id,
    orderCode: r.code,
    cityCode: r.city_code,
    status: r.status as DeliveryJobStatus,
    orderStatus: r.order_status as OrderStatus,
    shopName: r.shop_name,
    // Rule 10 (DC-B13): every seed and real shop carries a Hindi name; the screen picks it on /hi.
    shopNameHi: r.shop_name_hi,
    customerPincode: r.pincode,
    agent:
      r.agent_id && r.agent_name && r.vehicle_type
        ? { id: r.agent_id, name: r.agent_name, vehicleType: r.vehicle_type as AgentVehicleType }
        : null,
    offerExpiresAt: r.offer_expires_at ? new Date(r.offer_expires_at).toISOString() : null,
    loadClass: r.load_class as LoadClass,
    weightKg: r.unknown_weight ? null : Math.round(num(r.load_weight_g) / 100) / 10,
    attempt: num(r.failed_attempts) + 1,
    failReason: (r.fail_reason as DeliveryFailReason | null) ?? null,
    // DC-B13: the waiting clock stops at a finished job (delivered, returned, cancelled).
    waitingMin: deliveryJobMachine.isTerminal(r.status as DeliveryJobStatus)
      ? 0
      : Math.max(0, Math.round((now - new Date(r.updated_at).getTime()) / 60_000)),
    updatedAt: new Date(r.updated_at),
    version: r.version,
  }));
  return { items, more: rows.length > input.limit };
}

/**
 * Open jobs per queue view for the filter chips (SIM-LEAD-7). `done` and `all` are not counted: they only grow. One
 * grouped read over the city scope, index `delivery_jobs(city_id, status)`.
 */
export async function countAdminJobs(
  db: Tx,
  input: { scope: CityScope },
): Promise<Record<'needs_agent' | 'offered' | 'active' | 'failed' | 'returning', number>> {
  const scopeSql = input.scope.all
    ? sql`true`
    : input.scope.cityIds.length === 0
      ? sql`false`
      : sql`j.city_id in (${sql.join(
          input.scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = rowsOf<{ status: string; n: unknown }>(
    await db.execute(sql`select j.status, count(*) as n from delivery_jobs j
      where ${scopeSql} and j.status in ('needs_agent','offered','accepted','picked_up','failed','returning')
      group by j.status`),
  );
  const by = (status: string) => num(rows.find((r) => r.status === status)?.n ?? 0);
  return {
    needs_agent: by('needs_agent'),
    offered: by('offered'),
    active: by('accepted') + by('picked_up'),
    failed: by('failed'),
    returning: by('returning'),
  };
}

export async function getAdminJob(db: Tx, input: { scope: CityScope; jobId: string }) {
  const [j] = await db.select().from(deliveryJobs).where(eq(deliveryJobs.id, input.jobId)).limit(1);
  if (!j || !inScope(input.scope, j.cityId)) throw new NotFoundError('Delivery job not found');
  // The same row the queue shows (`AdminJobRow`), plus the detail arrays (`AdminJobDetail`).
  const [row] = (await listAdminJobs(db, { scope: input.scope, view: 'done', limit: 1, jobId: j.id })).items;
  if (!row) throw new NotFoundError('Delivery job not found');
  const pickup = await readHandoverCode(db, null, j.id, 'pickup');
  const [ship] = await db
    .select({ attempts: shipments.deliveryCodeAttempts })
    .from(shipments)
    .where(eq(shipments.orderId, j.orderId))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  const settings = await deliverySettings(db, j.cityId);
  const events = await db
    .select()
    .from(deliveryJobEvents)
    .where(eq(deliveryJobEvents.jobId, j.id))
    .orderBy(deliveryJobEvents.id);
  const offers = await db
    .select({
      id: deliveryJobOffers.id,
      agentName: deliveryAgents.name,
      status: deliveryJobOffers.status,
      reasonCode: deliveryJobOffers.reasonCode,
      createdAt: deliveryJobOffers.offeredAt,
      decidedAt: deliveryJobOffers.respondedAt,
    })
    .from(deliveryJobOffers)
    .innerJoin(deliveryAgents, eq(deliveryAgents.id, deliveryJobOffers.agentId))
    .where(eq(deliveryJobOffers.jobId, j.id))
    .orderBy(deliveryJobOffers.offeredAt);
  const suggestions = j.status === 'needs_agent' ? await suggestAgents(db, j) : [];
  const photos = [
    { purpose: 'pickup' as const, id: j.pickupPhotoId, at: j.pickedUpAt },
    { purpose: 'delivery' as const, id: j.deliveryPhotoId, at: j.deliveredAt },
    { purpose: 'failure' as const, id: j.failPhotoId, at: j.failedAt },
  ].filter(
    (p): p is { purpose: 'pickup' | 'delivery' | 'failure'; id: string; at: Date } =>
      p.id !== null && p.at !== null,
  );
  return {
    ...row,
    pickupLocked: pickup?.locked ?? false,
    deliveryLocked: (ship?.attempts ?? 0) >= 5,
    retryAllowed: retryAllowed({ failedAttempts: j.failedAttempts, maxAttempts: settings.maxAttempts }),
    maxAttempts: settings.maxAttempts,
    events: events.map((e) => ({
      at: e.createdAt.toISOString(),
      kind: e.kind,
      actorType: e.actorType,
      fromStatus: (e.fromStatus as DeliveryJobStatus | null) ?? null,
      toStatus: (e.toStatus as DeliveryJobStatus | null) ?? null,
      reasonCode: e.reasonCode,
    })),
    offers: offers.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      decidedAt: f.decidedAt?.toISOString() ?? null,
    })),
    suggestions,
    photos,
  };
}

export interface ShopOrderDeliveryInfo {
  mode: 'agent';
  pickupCode: string | null;
  pickupLocked: boolean;
  jobStatus: DeliveryJobStatus | null;
  agentFirstName: string | null;
  vehicleType: AgentVehicleType | null;
  returning: boolean;
  switchRequest: { id: string; reasonCode: string; requestedAt: Date; version: number } | null;
}

/** What the shop sees of the delivery on its order card: pickup code while ready, agent first name, return, switch. */
export async function shopDeliveryInfo(
  tx: Tx,
  orderIds: readonly string[],
  keyring: Keyring | null,
): Promise<Map<string, ShopOrderDeliveryInfo>> {
  const out = new Map<string, ShopOrderDeliveryInfo>();
  if (orderIds.length === 0) return out;
  const jobs = await tx
    .select({ job: deliveryJobs, agentName: deliveryAgents.name, vehicleType: deliveryAgents.vehicleType })
    .from(deliveryJobs)
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, deliveryJobs.agentId))
    .where(
      and(
        inArray(deliveryJobs.orderId, [...orderIds]),
        inArray(deliveryJobs.status, [
          'needs_agent',
          'offered',
          'accepted',
          'picked_up',
          'failed',
          'returning',
        ]),
      ),
    );
  for (const r of jobs) {
    const code = ['needs_agent', 'offered', 'accepted'].includes(r.job.status)
      ? await readHandoverCode(tx, keyring, r.job.id, 'pickup')
      : null;
    out.set(r.job.orderId, {
      mode: 'agent',
      pickupCode: code?.code ?? null,
      pickupLocked: code?.locked ?? false,
      jobStatus: r.job.status as DeliveryJobStatus,
      agentFirstName: r.agentName ? firstName(r.agentName) : null,
      vehicleType: (r.vehicleType as AgentVehicleType | null) ?? null,
      returning: r.job.status === 'returning',
      switchRequest: null,
    });
  }
  const switches = await tx
    .select()
    .from(orderDeliverySwitches)
    .where(
      and(
        inArray(orderDeliverySwitches.orderId, [...orderIds]),
        eq(orderDeliverySwitches.status, 'requested'),
      ),
    );
  for (const sw of switches) {
    const base = out.get(sw.orderId) ?? {
      mode: 'agent' as const,
      pickupCode: null,
      pickupLocked: false,
      jobStatus: null,
      agentFirstName: null,
      vehicleType: null,
      returning: false,
      switchRequest: null,
    };
    out.set(sw.orderId, {
      ...base,
      switchRequest: { id: sw.id, reasonCode: sw.reasonCode, requestedAt: sw.createdAt, version: sw.version },
    });
  }
  return out;
}

/** The customer's delivery block for an agent-mode sub-order (never the shop, never the agent's phone). */
export async function customerDeliveryBlock(tx: Tx, orderId: string) {
  const [last] = await tx
    .select({ job: deliveryJobs, agentName: deliveryAgents.name, vehicleType: deliveryAgents.vehicleType })
    .from(deliveryJobs)
    .leftJoin(deliveryAgents, eq(deliveryAgents.id, deliveryJobs.agentId))
    .where(eq(deliveryJobs.orderId, orderId))
    .orderBy(desc(deliveryJobs.seq), desc(deliveryJobs.createdAt))
    .limit(1);
  if (!last) return null;
  const j = last.job;
  const stage = ((): string => {
    switch (j.status as DeliveryJobStatus) {
      case 'needs_agent':
      case 'offered':
        return j.failedAttempts > 0 ? 'retrying' : 'finding_agent';
      case 'accepted':
        return 'agent_assigned';
      case 'picked_up':
        return j.failedAttempts > 0 ? 'retrying' : 'picked_up';
      case 'failed':
        return 'attempt_failed';
      case 'returning':
        return 'returning';
      case 'delivered':
        return 'delivered';
      case 'returned':
        return j.returnOutcome === 'retry' ? 'retrying' : 'returned';
      default:
        return 'finding_agent';
    }
  })();
  return {
    jobId: j.id,
    agentId: j.agentId,
    deliveredAt: j.deliveredAt,
    stage,
    agentFirstName:
      last.agentName && j.status !== 'needs_agent' && j.status !== 'offered'
        ? firstName(last.agentName)
        : null,
    vehicleType:
      j.status !== 'needs_agent' && j.status !== 'offered'
        ? ((last.vehicleType as AgentVehicleType | null) ?? null)
        : null,
    failReason: (j.failReason as DeliveryFailReason | null) ?? null,
  };
}

/** KPIs for the admin (design "Analytics"): counts and medians in seconds, by city scope and time window. */
export async function deliveryKpis(db: Tx, input: { scope: CityScope; from: Date; to: Date }) {
  const scopeSql = input.scope.all
    ? sql`true`
    : input.scope.cityIds.length === 0
      ? sql`false`
      : sql`j.city_id in (${sql.join(
          input.scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const agentScope = input.scope.all
    ? sql`true`
    : input.scope.cityIds.length === 0
      ? sql`false`
      : sql`a.city_id in (${sql.join(
          input.scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const [k] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      with jobs as (select j.* from delivery_jobs j where ${scopeSql} and j.created_at >= ${input.from} and j.created_at < ${input.to})
      select
        (select count(*) from jobs) as jobs,
        (select count(*) from jobs where status = 'delivered') as delivered,
        (select count(*) from jobs where failed_attempts > 0) as failed,
        (select count(*) from jobs where status = 'returned' and return_outcome = 'close') as returned,
        (select count(*) from delivery_job_offers f join jobs on jobs.id = f.job_id where f.status <> 'offered') as offers,
        (select count(*) from delivery_job_offers f join jobs on jobs.id = f.job_id where f.status in ('accepted','given_up')) as accepted,
        (select percentile_disc(0.5) within group (order by extract(epoch from accepted_at - created_at)) from jobs where accepted_at is not null) as assign_s,
        (select percentile_disc(0.5) within group (order by extract(epoch from picked_up_at - accepted_at)) from jobs where picked_up_at is not null and accepted_at is not null) as pickup_s,
        (select percentile_disc(0.5) within group (order by extract(epoch from delivered_at - picked_up_at)) from jobs where delivered_at is not null and picked_up_at is not null) as deliver_s,
        (select count(*) from delivery_agents a where ${agentScope} and a.status = 'active') as active_agents,
        (select count(*) from delivery_agents a where ${agentScope} and a.status = 'active' and a.online) as online_agents`),
  );
  const reasons = rowsOf<{ reason: string; n: unknown }>(
    await db.execute(sql`select e.reason_code as reason, count(*) as n from delivery_job_events e join delivery_jobs j on j.id = e.job_id
      where ${scopeSql} and e.kind = 'status' and e.to_status = 'failed' and e.created_at >= ${input.from} and e.created_at < ${input.to}
      group by e.reason_code`),
  );
  const offers = num(k?.offers);
  const sec = (v: unknown) => (numOrNull(v) === null ? null : Math.round(num(v)));
  return {
    jobs: num(k?.jobs),
    delivered: num(k?.delivered),
    failed: num(k?.failed),
    returned: num(k?.returned),
    offers,
    acceptanceRateBp: offers > 0 ? Math.round((num(k?.accepted) * 10_000) / offers) : null,
    medianAssignS: sec(k?.assign_s),
    medianPickupS: sec(k?.pickup_s),
    medianDeliverS: sec(k?.deliver_s),
    failuresByReason: Object.fromEntries(reasons.map((r) => [r.reason, num(r.n)])),
    activeAgents: num(k?.active_agents),
    onlineAgents: num(k?.online_agents),
  };
}

export { AGENT_VEHICLE_TYPES };

// ?? standing changes (security review 2026-11-26) ???????????????????????????????????????????????????????????????

/**
 * Locks (order row first, then the job; spec 14) everything an agent is offered or holds, before the caller locks the
 * agent row. Returns the locked jobs.
 */
export async function lockAgentWork(tx: Tx, agentId: string): Promise<JobRow[]> {
  const held = await tx
    .select({ id: deliveryJobs.id, orderId: deliveryJobs.orderId })
    .from(deliveryJobs)
    .where(and(eq(deliveryJobs.agentId, agentId), inArray(deliveryJobs.status, [...ACTIVE_AGENT_JOBS])));
  const offered = await tx
    .select({ id: deliveryJobs.id, orderId: deliveryJobs.orderId })
    .from(deliveryJobOffers)
    .innerJoin(deliveryJobs, eq(deliveryJobs.id, deliveryJobOffers.jobId))
    .where(and(eq(deliveryJobOffers.agentId, agentId), eq(deliveryJobOffers.status, 'offered')));
  const all = [...new Map([...held, ...offered].map((r) => [r.id, r])).values()].sort((a, b) =>
    a.orderId.localeCompare(b.orderId),
  );
  const out: JobRow[] = [];
  for (const r of all) {
    await lockOrder(tx, r.orderId);
    out.push(await lockJob(tx, r.id));
  }
  return out;
}

/**
 * Takes work away from an agent whose standing or documents changed (lead rulings 2026-11-26). Open offers are
 * always withdrawn (job back to the queue). `pause` and `stop` (suspend, offboard): every job the agent holds gets an
 * `agent_unavailable` event and a staff notice; accepted jobs (not picked up) go back to the queue; parcels already
 * picked up stay — a paused agent may finish them (deliver, fail, return), a stopped one may not (staff take over).
 * `offers` (a document replaced): only open offers. Call after `lockAgentWork`.
 */
export async function releaseAgentWork(
  tx: Tx,
  input: {
    agentId: string;
    jobs: readonly JobRow[];
    mode: 'offers' | 'pause' | 'stop';
    actor: 'admin' | 'system';
    actorId: string | null;
  },
): Promise<void> {
  for (const job of input.jobs) {
    const o = await orderInfo(tx, job.orderId);
    if (job.status === 'offered') {
      const [offer] = await tx
        .update(deliveryJobOffers)
        .set({ status: 'withdrawn', respondedAt: sql`now()`, reasonCode: 'reassigning' })
        .where(
          and(
            eq(deliveryJobOffers.jobId, job.id),
            eq(deliveryJobOffers.agentId, input.agentId),
            eq(deliveryJobOffers.status, 'offered'),
          ),
        )
        .returning({ id: deliveryJobOffers.id });
      if (offer) {
        await transitionJob(tx, {
          job,
          to: 'needs_agent',
          actor: input.actor,
          actorId: input.actorId,
          reasonCode: 'reassigning',
          offerId: offer.id,
        });
        await queueStaffNotice(tx, {
          kind: 'staff.delivery_needs_agent',
          cityId: job.cityId,
          entityId: job.id,
          version: job.version + 1,
          params: { orderCode: o.code },
        });
      }
      continue;
    }
    if (input.mode === 'offers' || job.agentId !== input.agentId) continue;
    await jobEvent(tx, {
      job,
      kind: 'agent_unavailable',
      agentId: input.agentId,
      actor: input.actor,
      actorId: input.actorId,
    });
    await queueStaffNotice(tx, {
      kind: 'staff.delivery_agent_unavailable',
      cityId: job.cityId,
      entityId: job.id,
      version: `unavailable:${job.version}`,
      params: { orderCode: o.code },
    });
    if (job.status === 'accepted') {
      await tx
        .update(deliveryJobOffers)
        .set({ status: 'withdrawn', respondedAt: sql`now()`, reasonCode: 'reassigning' })
        .where(and(eq(deliveryJobOffers.jobId, job.id), eq(deliveryJobOffers.status, 'accepted')));
      await transitionJob(tx, {
        job,
        to: 'needs_agent',
        actor: 'admin',
        actorId: input.actorId,
        patch: { agentId: null, acceptedAt: null },
        reasonCode: 'reassigning',
      });
      await queueStaffNotice(tx, {
        kind: 'staff.delivery_needs_agent',
        cityId: job.cityId,
        entityId: job.id,
        version: job.version + 1,
        params: { orderCode: o.code },
      });
    }
  }
}
