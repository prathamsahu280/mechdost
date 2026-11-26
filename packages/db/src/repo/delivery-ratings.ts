import { and, desc, eq, sql } from 'drizzle-orm';
import {
  RATING_EDIT_HOURS,
  ratingAverageX10,
  type DeliveryRatingReason,
} from '@mechdost/shared/delivery/codes';
import { deliveryAgents, deliveryJobs, deliveryRatings, orders } from '../schema';
import { auditDelivery, deliverySettings } from './delivery-common';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueStaffNotice } from './notices';
import type { Tx } from './orders';

/**
 * Rider ratings (founder 2026-11-26): the customer of a delivered agent sub-order rates the agent 1–5 with reason
 * codes; one rating per job, editable for 24 h (CAS on `version`). The agent row keeps a running sum and count in the
 * same transaction (conditional UPDATE, never read-then-write), and staff get one alert when the average drops below
 * the city's threshold after enough ratings. Lock order: order row, then the rating, then the agent row.
 */
export async function rateDeliveryAgent(
  db: Tx,
  input: {
    userId: string;
    orderCode: string;
    stars: number;
    reasons: readonly DeliveryRatingReason[];
    note?: string | undefined;
    expectedVersion?: number | undefined;
  },
): Promise<{ stars: number; editableUntil: Date; version: number }> {
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5)
    throw new ValidationError('1 to 5 stars', 'RATING_STARS');
  if (input.reasons.includes('other') && !input.note?.trim())
    throw new ValidationError('Add a note', 'NOTE_REQUIRED');
  return db.transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, status: orders.status, mode: orders.deliveryMode, cityId: orders.cityId })
      .from(orders)
      .where(and(eq(orders.code, input.orderCode), eq(orders.userId, input.userId)))
      .for('update');
    if (!o) throw new NotFoundError('Order not found');
    const [job] = await tx
      .select({ id: deliveryJobs.id, agentId: deliveryJobs.agentId })
      .from(deliveryJobs)
      .where(and(eq(deliveryJobs.orderId, o.id), eq(deliveryJobs.status, 'delivered')))
      .orderBy(desc(deliveryJobs.seq))
      .limit(1);
    if (o.status !== 'delivered' || o.mode !== 'agent' || !job?.agentId)
      throw new ConflictError('Only a delivered order can be rated', 'NOT_RATEABLE');
    const agentId = job.agentId;
    const [prev] = await tx
      .select()
      .from(deliveryRatings)
      .where(eq(deliveryRatings.jobId, job.id))
      .for('update');
    let delta: number;
    let countDelta: number;
    let saved: { version: number; editableUntil: Date };
    if (prev) {
      if (prev.editableUntil.getTime() <= Date.now())
        throw new ConflictError('This rating can no longer be changed', 'RATING_CLOSED');
      if (input.expectedVersion !== prev.version)
        throw new ConflictError('This rating changed meanwhile', 'STALE');
      const [row] = await tx
        .update(deliveryRatings)
        .set({ stars: input.stars, reasons: [...input.reasons], note: input.note ?? null })
        .where(
          and(
            eq(deliveryRatings.id, prev.id),
            eq(deliveryRatings.version, prev.version),
            sql`${deliveryRatings.editableUntil} > now()`,
          ),
        )
        .returning({ version: deliveryRatings.version, editableUntil: deliveryRatings.editableUntil });
      if (!row) throw new ConflictError('This rating can no longer be changed', 'RATING_CLOSED');
      saved = row;
      delta = input.stars - prev.stars;
      countDelta = 0;
    } else {
      const [row] = await tx
        .insert(deliveryRatings)
        .values({
          jobId: job.id,
          orderId: o.id,
          agentId,
          userId: input.userId,
          stars: input.stars,
          reasons: [...input.reasons],
          note: input.note ?? null,
          editableUntil: sql`now() + make_interval(hours => ${RATING_EDIT_HOURS})`,
        })
        .returning({ version: deliveryRatings.version, editableUntil: deliveryRatings.editableUntil });
      if (!row) throw new Error('rating insert returned no row');
      saved = row;
      delta = input.stars;
      countDelta = 1;
    }
    const [agent] = await tx
      .update(deliveryAgents)
      .set({
        ratingSum: sql`${deliveryAgents.ratingSum} + ${delta}`,
        ratingCount: sql`${deliveryAgents.ratingCount} + ${countDelta}`,
      })
      .where(eq(deliveryAgents.id, agentId))
      .returning({
        sum: deliveryAgents.ratingSum,
        count: deliveryAgents.ratingCount,
        cityId: deliveryAgents.cityId,
        alertedAt: deliveryAgents.lowRatingAlertedAt,
      });
    if (!agent) throw new NotFoundError('Delivery agent not found');
    const avg = ratingAverageX10(agent.sum, agent.count);
    const settings = await deliverySettings(tx, agent.cityId);
    if (avg !== null && agent.count >= settings.lowRatingMinCount) {
      if (avg < settings.lowRatingAlertX10 && !agent.alertedAt) {
        await tx
          .update(deliveryAgents)
          .set({ lowRatingAlertedAt: sql`now()` })
          .where(eq(deliveryAgents.id, agentId));
        await queueStaffNotice(tx, {
          kind: 'staff.delivery_low_rating',
          cityId: agent.cityId,
          entityId: agentId,
          version: `${agent.count}`,
        });
        await recordServerEvent(tx, 'delivery_low_rating_alert', {
          cityId: agent.cityId,
          props: { agentId, avgX10: avg, ratingCount: agent.count },
        });
      } else if (avg >= settings.lowRatingAlertX10 && agent.alertedAt) {
        // Back above the line: the next drop alerts again.
        await tx
          .update(deliveryAgents)
          .set({ lowRatingAlertedAt: null })
          .where(eq(deliveryAgents.id, agentId));
      }
    }
    await auditDelivery(tx, {
      actorUserId: input.userId,
      actorRole: 'customer',
      action: prev ? 'delivery_rating.edited' : 'delivery_rating.created',
      entity: 'delivery_job',
      entityId: job.id,
      after: { stars: input.stars },
    });
    await recordServerEvent(tx, 'delivery_rated', {
      userId: input.userId,
      cityId: o.cityId,
      props: {
        jobId: job.id,
        agentId,
        stars: input.stars,
        reasons: [...input.reasons],
        edited: prev !== undefined,
      },
    });
    return { stars: input.stars, editableUntil: saved.editableUntil, version: saved.version };
  });
}

/** The customer's rating of a job, for the order page (null when none). */
export async function ratingForJob(tx: Tx, jobId: string) {
  const [r] = await tx.select().from(deliveryRatings).where(eq(deliveryRatings.jobId, jobId)).limit(1);
  if (!r) return null;
  return {
    stars: r.stars,
    reasons: r.reasons as DeliveryRatingReason[],
    note: r.note,
    editableUntil: r.editableUntil.toISOString(),
    version: r.version,
    editable: r.editableUntil.getTime() > Date.now(),
  };
}
