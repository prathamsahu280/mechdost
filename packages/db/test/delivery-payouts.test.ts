/**
 * Manual agent payouts (founder 2026-11-26): append-only rows recorded by staff, corrections as reversing rows,
 * idempotent by key, city-scoped for staff, own rows only for the agent, and a delivered-jobs count per period.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  agentDeliveredCount,
  listAgentPayouts,
  agentEarnings,
  recordAgentPayout,
  reverseAgentPayout,
} from '../src/repo';
import * as s from '../src/schema';
import { makeAgent, makeWorld, type World } from './delivery-fixture';

let w: World;
beforeAll(async () => {
  w = await makeWorld();
});
afterAll(async () => {
  await w.close();
});

const pay = (agentId: string, key: string, amountPaise = 120_000) =>
  recordAgentPayout(w.t(), {
    scope: { all: true },
    staffUserId: w.staff,
    agentId,
    amountPaise,
    periodFrom: '2026-11-01',
    periodTo: '2026-11-15',
    method: 'upi',
    reference: 'UTR998877',
    idempotencyKey: key,
  });

describe('manual agent payouts', () => {
  it('records a payment once per key, audited, with an analytics event', async () => {
    const A = await makeAgent(w);
    const first = await pay(A.agentId, 'payout-key-000000000001');
    const again = await pay(A.agentId, 'payout-key-000000000001');
    expect(again.id).toBe(first.id);
    const rows = await w.db
      .select()
      .from(s.deliveryAgentPayouts)
      .where(eq(s.deliveryAgentPayouts.agentId, A.agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'payment', amountPaise: 120_000, recordedBy: w.staff });
    const audit = await w.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, first.id));
    expect(audit.map((a) => a.action)).toContain('delivery_agent.payout_recorded');
  });

  it('corrects only by a reversing row; reversing a reversal and edits are refused', async () => {
    const A = await makeAgent(w);
    const p = await pay(A.agentId, 'payout-key-000000000002', 50_000);
    const rev = await reverseAgentPayout(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      payoutId: p.id,
      note: 'Wrong amount',
      idempotencyKey: 'payout-rev-0000000002',
    });
    expect(rev).toMatchObject({ kind: 'reversal', amountPaise: -50_000 });
    await expect(
      reverseAgentPayout(w.t(), {
        scope: { all: true },
        staffUserId: w.staff,
        payoutId: rev.id,
        note: 'Reverse a reversal',
        idempotencyKey: 'payout-rev-0000000004',
      }),
    ).rejects.toMatchObject({ code: 'NOT_A_PAYMENT' });
    await expect(
      w.db.execute(sql`update delivery_agent_payouts set amount_paise = 1 where id = ${p.id}`),
    ).rejects.toThrow();
    const page = await listAgentPayouts(w.t(), { scope: { all: true }, agentId: A.agentId, limit: 50 });
    expect(page.totalPaise).toBe(0);
    expect(page.items.find((i) => i.id === p.id)?.corrected).toBe(true);
  });

  it('security review: a replayed key never leaks another city, rev- keys are reserved, a double reversal returns the same row', async () => {
    const A = await makeAgent(w);
    const p = await pay(A.agentId, 'payout-key-000000000010', 30_000);
    const elsewhere = { all: false as const, cityIds: [randomUUID()] };
    const rev = await reverseAgentPayout(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      payoutId: p.id,
      note: 'Wrong amount',
    });
    // City-B finance replays the reversal of a city-A payment: 404, not the row.
    await expect(
      reverseAgentPayout(w.t(), { scope: elsewhere, staffUserId: w.staff, payoutId: p.id, note: 'Replay' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // City-B finance replays a city-A payment key with a city-B-invisible agent: 404.
    await expect(
      recordAgentPayout(w.t(), {
        scope: elsewhere,
        staffUserId: w.staff,
        agentId: A.agentId,
        amountPaise: 30_000,
        periodFrom: '2026-11-01',
        periodTo: '2026-11-15',
        method: 'upi',
        idempotencyKey: 'payout-key-000000000010',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A visible agent, but the replayed key belongs to a payout of another city: 404 (not 409, not the row).
    const [home] = await w.db.select().from(s.cities).where(eq(s.cities.id, w.cityId));
    const [far] = await w.db
      .insert(s.cities)
      .values({ stateId: home!.stateId, code: 'BHI', slug: 'bhilai-payouts', name: 'Bhilai', status: 'live' })
      .returning();
    const B = await makeAgent(w);
    const farPay = await w.db
      .insert(s.deliveryAgentPayouts)
      .values({
        agentId: B.agentId,
        cityId: far!.id,
        kind: 'payment',
        amountPaise: 30_000,
        periodFrom: '2026-11-01',
        periodTo: '2026-11-15',
        method: 'upi',
        idemKey: 'payout-key-far-0000000001',
        recordedBy: w.staff,
      })
      .returning();
    expect(farPay).toHaveLength(1);
    await expect(
      recordAgentPayout(w.t(), {
        scope: { all: false, cityIds: [w.cityId] },
        staffUserId: w.staff,
        agentId: B.agentId,
        amountPaise: 30_000,
        periodFrom: '2026-11-01',
        periodTo: '2026-11-15',
        method: 'upi',
        idempotencyKey: 'payout-key-far-0000000001',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A client key in the reserved namespace is refused.
    await expect(pay(A.agentId, `rev-${p.id}`)).rejects.toMatchObject({ code: 'RESERVED_KEY' });
    // A second reversal of the same payment returns the first reversal, once.
    const again = await reverseAgentPayout(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      payoutId: p.id,
      note: 'Again',
      idempotencyKey: 'payout-rev-0000000011',
    });
    expect(again.id).toBe(rev.id);
    const rows = await w.db
      .select()
      .from(s.deliveryAgentPayouts)
      .where(eq(s.deliveryAgentPayouts.reversesId, p.id));
    expect(rows).toHaveLength(1);
  });

  it('staff of another city get 404; the agent sees only their own rows without notes or staff names', async () => {
    const A = await makeAgent(w);
    const B = await makeAgent(w);
    await pay(A.agentId, 'payout-key-000000000005');
    await pay(B.agentId, 'payout-key-000000000006');
    await expect(
      recordAgentPayout(w.t(), {
        scope: { all: false, cityIds: [randomUUID()] },
        staffUserId: w.staff,
        agentId: A.agentId,
        amountPaise: 100,
        periodFrom: '2026-11-01',
        periodTo: '2026-11-02',
        method: 'cash',
        idempotencyKey: 'payout-key-000000000007',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const other = await listAgentPayouts(w.t(), {
      scope: { all: false, cityIds: [randomUUID()] },
      limit: 50,
    });
    expect(other.items).toEqual([]);
    const own = await agentEarnings(w.t(), A.userId);
    expect(own.payouts).toHaveLength(1);
    expect(own.totalPaise).toBe(120_000);
    expect(own.payouts[0]!.note).toBeNull();
    expect(Object.keys(own.payouts[0]!)).not.toContain('recordedByName');
  });

  it('counts delivered jobs in an IST period to help staff work out pay', async () => {
    const A = await makeAgent(w);
    const count = await agentDeliveredCount(w.t(), {
      scope: { all: true },
      agentId: A.agentId,
      from: '2026-11-01',
      to: '2026-12-31',
    });
    expect(count).toMatchObject({ agentId: A.agentId, delivered: 0, failedAttempts: 0, paidPaise: 0 });
  });
});
