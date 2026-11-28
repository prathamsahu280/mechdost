/**
 * Delivery + COD QA batch DC (2026-11-27 simulations, docs/qa/qa-backlog-2026-11-27.md). One block per row id:
 * DC-B10 suggestions say who cannot be offered, DC-B12 a repeat payout correction says so, DC-B13 / DC-P15 Hindi names
 * on the queue and the rider screens and a stopped waiting clock, DC-F1 / DC-P2 one open application per phone,
 * DC-P7 reasons by direction, DC-P16 notices that say what changed, DC-G1 shop delivery mode in the admin shop row.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  advanceShopOrder,
  declineDeliveryOffer,
  getAdminJob,
  getAgentJob,
  listAdminJobs,
  listAdminShops,
  listAgentJobs,
  listShopModeRequests,
  offerDeliveryJob,
  recordAgentPayout,
  requestShopDeliveryMode,
  reverseAgentPayout,
  setAgentStatus,
  submitAgentApplication,
  suggestAgents,
} from '../src/repo';
import * as s from '../src/schema';
import {
  jobOf,
  keyring,
  makeAgent,
  makeWorld,
  orderOf,
  packedOnlineOrder,
  type World,
} from './delivery-fixture';

let w: World;
beforeAll(async () => {
  w = await makeWorld();
});
afterAll(async () => {
  await w.close();
});

async function readyJob() {
  const { code } = await packedOnlineOrder(w);
  const o = await orderOf(w, code);
  await advanceShopOrder(w.t(), {
    shopIds: [w.shopId],
    code,
    expectedVersion: o.version,
    step: { to: 'ready_for_pickup' },
    staffUserId: w.shopUser,
    keyring,
  });
  return { code, job: await jobOf(w, o.id) };
}

describe('DC-F1 / DC-P2 one open delivery application per phone', () => {
  const apply = (phone: string) =>
    submitAgentApplication(w.t(), { name: 'Raju QA', phone, cityCode: 'RPR', vehicleType: 'scooter' });

  it('a second application answers the first reference; two at once still make one row', async () => {
    const phone = '+919822220001';
    const first = await apply(phone);
    expect(first.alreadyApplied).toBe(false);
    const again = await apply(phone);
    // Security review: a repeat never reveals the first application (no reference, no status).
    expect(again).toEqual({ code: null, status: 'new', alreadyApplied: true });
    expect(JSON.stringify(again)).not.toContain(first.code ?? 'x');
    const other = '+919822220002';
    const both = await Promise.all([apply(other), apply(other)]);
    expect(both.filter((r) => !r.alreadyApplied)).toHaveLength(1);
    const rows = await w.db
      .select({ id: s.partnerApplications.id })
      .from(s.partnerApplications)
      .where(eq(s.partnerApplications.phone, other));
    expect(rows).toHaveLength(1);
  });

  it('the database refuses a duplicate even when the repository is bypassed', async () => {
    const phone = '+919822220003';
    await apply(phone);
    await expect(
      w.db
        .execute(sql`insert into partner_applications (code, kind, name, phone, city_id, vehicle_type, consent_at)
        select 'PA-RPR-2026-ZZZZZZ', 'delivery_agent', 'Dup', ${phone}, city_id, vehicle_type, now()
        from partner_applications where phone = ${phone} limit 1`),
    ).rejects.toThrow();
  });

  it('a decided application frees the number', async () => {
    const phone = '+919822220004';
    const first = await apply(phone);
    await w.db
      .update(s.partnerApplications)
      .set({ status: 'rejected' })
      .where(eq(s.partnerApplications.code, first.code ?? ''));
    const next = await apply(phone);
    expect(next.alreadyApplied).toBe(false);
    expect(next.code).not.toBe(first.code);
  });

  it('role leak: another person typing someone else’s number gets nothing about that application', async () => {
    const victim = '+919822220005';
    const mine = await apply(victim);
    const prober = await submitAgentApplication(w.t(), {
      name: 'Someone Else',
      phone: victim,
      cityCode: 'RPR',
      vehicleType: 'bike',
    });
    expect(prober.code).toBeNull();
    expect(prober.status).toBe('new');
    expect(Object.values(prober).join('|')).not.toContain(mine.code ?? 'x');
    const rows = await w.db
      .select({ name: s.partnerApplications.name })
      .from(s.partnerApplications)
      .where(eq(s.partnerApplications.phone, victim));
    // The probe changed nothing: still the one original row, not overwritten by the second name.
    expect(rows).toEqual([{ name: 'Raju QA' }]);
  });
});

describe('DC-B12 a repeat payout correction says it was already done', () => {
  it('the first correction adds the reversing row, the second returns it with replayed = true', async () => {
    const A = await makeAgent(w);
    const paid = await recordAgentPayout(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      amountPaise: 90_000,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-15',
      method: 'upi',
      reference: 'UTR1234',
      idempotencyKey: `dcb12-${randomUUID()}`,
    });
    const input = {
      scope: { all: true } as const,
      staffUserId: w.staff,
      payoutId: paid.id,
      note: 'Wrong amount',
    };
    const first = await reverseAgentPayout(w.t(), input);
    const second = await reverseAgentPayout(w.t(), input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.id).toBe(first.id);
    const rows = await w.db
      .select({ id: s.deliveryAgentPayouts.id })
      .from(s.deliveryAgentPayouts)
      .where(eq(s.deliveryAgentPayouts.reversesId, paid.id));
    expect(rows).toHaveLength(1);
  });
});

describe('DC-B13 / DC-P15 Hindi on the queue and the rider screens', () => {
  it('the admin queue row carries the shop name in Hindi, and a finished job has no waiting clock', async () => {
    const { job } = await readyJob();
    const [row] = (
      await listAdminJobs(w.t(), { scope: { all: true }, view: 'needs_agent', limit: 50 })
    ).items.filter((j) => j.jobId === job.id);
    expect(row?.shopNameHi).toBeTruthy();
    const [shop] = await w.db.select().from(s.shops).where(eq(s.shops.id, w.shopId));
    expect(row?.shopNameHi).toBe(shop?.nameHi);
    await w.db.execute(sql`update delivery_jobs set status = 'cancelled' where id = ${job.id}::uuid`);
    const [done] = (
      await listAdminJobs(w.t(), { scope: { all: true }, view: 'done', limit: 100 })
    ).items.filter((j) => j.jobId === job.id);
    expect(done?.status).toBe('cancelled');
    expect(done?.waitingMin).toBe(0);
  });

  it('the rider card and job carry the Hindi item title, shop name and areas', async () => {
    const A = await makeAgent(w);
    const { job } = await readyJob();
    await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: job.id,
      agentId: A.agentId,
      expectedVersion: job.version,
    });
    const [pin] = await w.db.select().from(s.pincodes).where(eq(s.pincodes.pincode, '492004'));
    const card = (await listAgentJobs(w.t(), { userId: A.userId, view: 'offers', limit: 10 })).items.find(
      (c) => c.jobId === job.id,
    );
    expect(card?.shopArea).toBe(pin?.locality ?? null);
    expect(card?.shopAreaHi).toBe(pin?.localityHi ?? null);
    const detail = await getAgentJob(w.t(), { userId: A.userId, jobId: job.id, keyring });
    const [item] = await w.db.select().from(s.orderItems).where(eq(s.orderItems.orderId, job.orderId));
    expect(item?.titleHi).toBeTruthy();
    expect(detail.items[0]).toMatchObject({ name: item?.title, nameHi: item?.titleHi });
    expect(detail.contact.shop?.nameHi).toBeTruthy();
    expect(detail.contact.customer?.areaHi).toBe(pin?.localityHi ?? null);
  });
});

describe('DC-B10 suggestions say who cannot be offered the job', () => {
  it('an agent who declined it is listed as not eligible and as having declined before', async () => {
    const A = await makeAgent(w);
    const B = await makeAgent(w);
    const { job } = await readyJob();
    const before = await suggestAgents(w.t(), job);
    expect(before.find((x) => x.agentId === A.agentId)).toMatchObject({
      eligible: true,
      declinedBefore: false,
    });
    const { offerId } = await offerDeliveryJob(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      jobId: job.id,
      agentId: A.agentId,
      expectedVersion: job.version,
    });
    await declineDeliveryOffer(w.t(), { userId: A.userId, offerId, reasonCode: 'too_far' });
    const fresh = await jobOf(w, job.orderId);
    const after = await suggestAgents(w.t(), fresh);
    expect(after.find((x) => x.agentId === A.agentId)).toMatchObject({
      eligible: false,
      declinedBefore: true,
    });
    expect(after.find((x) => x.agentId === B.agentId)).toMatchObject({
      eligible: true,
      declinedBefore: false,
    });
    const detail = await getAdminJob(w.t(), { scope: { all: true }, jobId: job.id });
    expect(detail.suggestions.find((x) => x.agentId === A.agentId)?.eligible).toBe(false);
    expect(detail.maxAttempts).toBeGreaterThan(0);
  });
});

describe('DC-P7 shop mode reasons fit the direction', () => {
  it('a shop moving to its own delivery cannot send an agent-direction reason, and the new reasons are stored', async () => {
    await expect(
      requestShopDeliveryMode(w.t(), {
        shopIds: [w.shopId],
        shopId: w.shopId,
        staffUserId: w.shopUser,
        requestedMode: 'self',
        reasonCode: 'no_riders',
      }),
    ).rejects.toMatchObject({ code: 'REASON_NOT_FOR_DIRECTION' });
    await w.db.execute(sql`update shops set delivery_mode = 'self' where id = ${w.shopId}::uuid`);
    await expect(
      requestShopDeliveryMode(w.t(), {
        shopIds: [w.shopId],
        shopId: w.shopId,
        staffUserId: w.shopUser,
        requestedMode: 'agents',
        reasonCode: 'own_riders',
      }),
    ).rejects.toMatchObject({ code: 'REASON_NOT_FOR_DIRECTION' });
    await requestShopDeliveryMode(w.t(), {
      shopIds: [w.shopId],
      shopId: w.shopId,
      staffUserId: w.shopUser,
      requestedMode: 'agents',
      reasonCode: 'wider_area',
    });
    const pending = await listShopModeRequests(w.t(), { scope: { all: true }, status: 'pending', limit: 10 });
    expect(pending[0]).toMatchObject({ reasonCode: 'wider_area', requestedMode: 'agents' });
    expect(pending[0]?.shopNameHi).toBeTruthy();
    await w.db.execute(sql`update shops set delivery_mode = 'agents' where id = ${w.shopId}::uuid`);
  });
});

describe('DC-G1 the admin shop row says who delivers', () => {
  it('carries deliveryMode and its version, so staff can set it directly', async () => {
    const page = await listAdminShops(w.t(), { all: true }, {});
    const row = page.items.find((x) => x.id === w.shopId);
    expect(row?.deliveryMode).toBe('agents');
    expect(row?.version).toBeGreaterThan(0);
  });
});

describe('DC-P16 notices say what changed', () => {
  it('the status notice names the new status in the agent’s language and opens the profile', async () => {
    const A = await makeAgent(w);
    const [a] = await w.db.select().from(s.deliveryAgents).where(eq(s.deliveryAgents.id, A.agentId));
    await setAgentStatus(w.t(), {
      scope: { all: true },
      staffUserId: w.staff,
      agentId: A.agentId,
      to: 'paused',
      reasonCode: 'other',
      note: 'Checking papers',
      expectedVersion: a!.version,
    });
    const [n] = await w.db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.userId, A.userId))
      .orderBy(sql`created_at desc`)
      .limit(1);
    expect(n?.kind).toBe('delivery.status_changed');
    expect(n?.body).toContain('Paused');
    expect(n?.link).toBe('/partner/delivery/profile');
  });
});
