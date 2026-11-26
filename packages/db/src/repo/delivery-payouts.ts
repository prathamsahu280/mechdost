import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AgentPayoutMethod } from '@mechdost/shared/delivery/codes';
import { deliveryAgentPayouts, deliveryAgents, users } from '../schema';
import { agentOfUser, auditDelivery } from './delivery-common';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * Manual payouts to delivery agents (founder 2026-11-26: "payouts would be manual and we can make it automatic later").
 * Staff record a payment already made (UPI, bank transfer, cash, other) for a period; a correction is a new reversing
 * row (one per payment), never an edit (append-only table). Idempotent by key. No rate maths and no transfers.
 */

const inScope = (scope: CityScope, cityId: string) => scope.all || scope.cityIds.includes(cityId);

async function scopedAgent(tx: Tx, scope: CityScope, agentId: string) {
  const [a] = await tx
    .select({ id: deliveryAgents.id, cityId: deliveryAgents.cityId })
    .from(deliveryAgents)
    .where(eq(deliveryAgents.id, agentId))
    .limit(1);
  if (!a || !inScope(scope, a.cityId)) throw new NotFoundError('Delivery agent not found');
  return a;
}

type PayoutRow = typeof deliveryAgentPayouts.$inferSelect;

async function byKey(tx: Tx, key: string): Promise<PayoutRow | null> {
  const [r] = await tx
    .select()
    .from(deliveryAgentPayouts)
    .where(eq(deliveryAgentPayouts.idemKey, key))
    .limit(1);
  return r ?? null;
}

export async function recordAgentPayout(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    agentId: string;
    amountPaise: number;
    periodFrom: string;
    periodTo: string;
    method: AgentPayoutMethod;
    reference?: string | undefined;
    note?: string | undefined;
    idempotencyKey: string;
  },
): Promise<PayoutRow> {
  return db.transaction(async (tx) => {
    const a = await scopedAgent(tx, input.scope, input.agentId);
    const seen = await byKey(tx, input.idempotencyKey);
    if (seen) {
      if (seen.agentId !== a.id || seen.amountPaise !== input.amountPaise)
        throw new ConflictError('This key was used for another payout', 'IDEMPOTENCY_MISMATCH');
      return seen;
    }
    const [row] = await tx
      .insert(deliveryAgentPayouts)
      .values({
        agentId: a.id,
        cityId: a.cityId,
        kind: 'payment',
        amountPaise: input.amountPaise,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        method: input.method,
        reference: input.reference ?? null,
        note: input.note ?? null,
        idemKey: input.idempotencyKey,
        recordedBy: input.staffUserId,
      })
      .onConflictDoNothing({ target: deliveryAgentPayouts.idemKey })
      .returning();
    if (!row) {
      const raced = await byKey(tx, input.idempotencyKey);
      if (!raced) throw new ConflictError('The payout could not be stored', 'PAYOUT_NOT_STORED');
      return raced;
    }
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.payout_recorded',
      entity: 'delivery_agent',
      entityId: row.id,
      after: {
        agentId: a.id,
        amountPaise: row.amountPaise,
        method: row.method,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
      },
    });
    await recordServerEvent(tx, 'delivery_payout_recorded', {
      userId: input.staffUserId,
      cityId: a.cityId,
      props: {
        payoutId: row.id,
        agentId: a.id,
        kind: 'payment',
        amountPaise: row.amountPaise,
        method: row.method,
      },
    });
    return row;
  });
}

/** A correction: a new row with the opposite amount, pointing at the payment (one reversal per payment). */
export async function reverseAgentPayout(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; payoutId: string; note: string; idempotencyKey: string },
): Promise<PayoutRow> {
  return db.transaction(async (tx) => {
    const seen = await byKey(tx, input.idempotencyKey);
    if (seen) {
      if (seen.reversesId !== input.payoutId)
        throw new ConflictError('This key was used for another payout', 'IDEMPOTENCY_MISMATCH');
      return seen;
    }
    const [p] = await tx
      .select()
      .from(deliveryAgentPayouts)
      .where(eq(deliveryAgentPayouts.id, input.payoutId))
      .for('update');
    if (!p || !inScope(input.scope, p.cityId)) throw new NotFoundError('Payout not found');
    if (p.kind !== 'payment') throw new ConflictError('Only a payment can be reversed', 'NOT_A_PAYMENT');
    const [done] = await tx
      .select({ id: deliveryAgentPayouts.id })
      .from(deliveryAgentPayouts)
      .where(eq(deliveryAgentPayouts.reversesId, p.id))
      .limit(1);
    if (done) throw new ConflictError('This payment was already reversed', 'ALREADY_REVERSED');
    const [row] = await tx
      .insert(deliveryAgentPayouts)
      .values({
        agentId: p.agentId,
        cityId: p.cityId,
        kind: 'reversal',
        amountPaise: -p.amountPaise,
        periodFrom: p.periodFrom,
        periodTo: p.periodTo,
        method: p.method,
        reference: p.reference,
        note: input.note,
        reversesId: p.id,
        idemKey: input.idempotencyKey,
        recordedBy: input.staffUserId,
      })
      .returning();
    if (!row) throw new ConflictError('The reversal could not be stored', 'PAYOUT_NOT_STORED');
    await auditDelivery(tx, {
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'delivery_agent.payout_reversed',
      entity: 'delivery_agent',
      entityId: row.id,
      after: { reverses: p.id, amountPaise: row.amountPaise },
      reason: input.note,
    });
    await recordServerEvent(tx, 'delivery_payout_recorded', {
      userId: input.staffUserId,
      cityId: p.cityId,
      props: {
        payoutId: row.id,
        agentId: p.agentId,
        kind: 'reversal',
        amountPaise: row.amountPaise,
        method: row.method,
      },
    });
    return row;
  });
}

/** Staff list (city scope; optional agent and IST period filter); newest first, with the net total. */
export async function listAgentPayouts(
  db: Tx,
  input: {
    scope: CityScope;
    agentId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    limit: number;
    before?: Date | null;
  },
) {
  const where = and(
    input.scope.all
      ? undefined
      : inArray(
          deliveryAgentPayouts.cityId,
          input.scope.cityIds.length ? input.scope.cityIds : ['00000000-0000-0000-0000-000000000000'],
        ),
    input.agentId ? eq(deliveryAgentPayouts.agentId, input.agentId) : undefined,
    input.from ? sql`${deliveryAgentPayouts.periodTo} >= ${input.from}::date` : undefined,
    input.to ? sql`${deliveryAgentPayouts.periodFrom} <= ${input.to}::date` : undefined,
  );
  const rows = await db
    .select({ p: deliveryAgentPayouts, agentName: deliveryAgents.name, recordedByName: users.name })
    .from(deliveryAgentPayouts)
    .innerJoin(deliveryAgents, eq(deliveryAgents.id, deliveryAgentPayouts.agentId))
    .leftJoin(users, eq(users.id, deliveryAgentPayouts.recordedBy))
    .where(and(where, input.before ? sql`${deliveryAgentPayouts.createdAt} < ${input.before}` : undefined))
    .orderBy(desc(deliveryAgentPayouts.createdAt), desc(deliveryAgentPayouts.id))
    .limit(input.limit + 1);
  const [t] = rowsOf<{ total: unknown }>(
    await db.execute(
      sql`select coalesce(sum(amount_paise), 0) as total from delivery_agent_payouts where ${where ?? sql`true`}`,
    ),
  );
  const reversed = new Set(
    (
      await db
        .select({ id: deliveryAgentPayouts.reversesId })
        .from(deliveryAgentPayouts)
        .where(
          and(
            eq(deliveryAgentPayouts.kind, 'reversal'),
            inArray(
              deliveryAgentPayouts.reversesId,
              rows.map((r) => r.p.id).concat(['00000000-0000-0000-0000-000000000000']),
            ),
          ),
        )
    ).map((r) => r.id),
  );
  const items = rows.slice(0, input.limit).map((r) => ({
    id: r.p.id,
    agentId: r.p.agentId,
    agentName: r.agentName,
    kind: r.p.kind as 'payment' | 'reversal',
    amountPaise: r.p.amountPaise,
    periodFrom: r.p.periodFrom,
    periodTo: r.p.periodTo,
    method: r.p.method as AgentPayoutMethod,
    reference: r.p.reference,
    note: r.p.note,
    reversesId: r.p.reversesId,
    reversed: reversed.has(r.p.id),
    recordedByName: r.recordedByName ?? null,
    createdAt: r.p.createdAt,
  }));
  return { items, totalPaise: num(t?.total), more: rows.length > input.limit };
}

/** The agent's own payouts: no staff note, no staff name. */
export async function listOwnPayouts(db: Tx, userId: string) {
  const a = await agentOfUser(db, userId);
  const rows = await db
    .select()
    .from(deliveryAgentPayouts)
    .where(eq(deliveryAgentPayouts.agentId, a.id))
    .orderBy(desc(deliveryAgentPayouts.createdAt))
    .limit(200);
  return {
    items: rows.map((p) => ({
      id: p.id,
      kind: p.kind as 'payment' | 'reversal',
      amountPaise: p.amountPaise,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      method: p.method as AgentPayoutMethod,
      reference: p.reference,
      createdAt: p.createdAt,
    })),
    totalPaise: rows.reduce((sum, p) => sum + p.amountPaise, 0),
  };
}

/** Delivered jobs, failed attempts and net paid for an agent over IST calendar days (helps staff work out pay). */
export async function agentDeliveredCount(
  db: Tx,
  input: { scope: CityScope; agentId: string; from: string; to: string },
) {
  const a = await scopedAgent(db, input.scope, input.agentId);
  const [r] = rowsOf<{ delivered: unknown; failed: unknown; paid: unknown }>(
    await db.execute(sql`
      select
        (select count(*) from delivery_jobs j where j.agent_id = ${a.id}::uuid and j.status = 'delivered'
          and (j.delivered_at at time zone 'Asia/Kolkata')::date between ${input.from}::date and ${input.to}::date) as delivered,
        (select count(*) from delivery_job_events e where e.agent_id = ${a.id}::uuid and e.kind = 'status' and e.to_status = 'failed'
          and (e.created_at at time zone 'Asia/Kolkata')::date between ${input.from}::date and ${input.to}::date) as failed,
        (select coalesce(sum(p.amount_paise), 0) from delivery_agent_payouts p where p.agent_id = ${a.id}::uuid
          and p.period_from <= ${input.to}::date and p.period_to >= ${input.from}::date) as paid`),
  );
  return {
    agentId: a.id,
    from: input.from,
    to: input.to,
    delivered: num(r?.delivered),
    failedAttempts: num(r?.failed),
    paidPaise: num(r?.paid),
  };
}
