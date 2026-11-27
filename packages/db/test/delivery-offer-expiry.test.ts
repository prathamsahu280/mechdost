/**
 * DC-B11 (QA 2026-11-27): offers past their deadline must go back to the admin queue through the worker sweep, the
 * way the live run hit it (offer through the real path, the agent does nothing, the clock passes `expires_at`):
 * no failure, job back to `needs_agent`, an audit row, a staff notice, and the same again for a second offer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as s from '../src/schema';
import { advanceShopOrder, expireDueDeliveryOffers, offerDeliveryJob } from '../src/repo';
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
  // A super admin receives the staff notice (`delivery_jobs:assign`, all cities).
  const [role] = await w.db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, 'super_admin'));
  await w.db.insert(s.userRoles).values({ userId: w.staff, roleId: role?.id ?? '' });
});
afterAll(async () => {
  await w.close();
});

async function passDeadline(offerId: string) {
  const past = new Date(Date.now() - 60_000).toISOString();
  const offered = new Date(Date.now() - 3 * 60_000).toISOString();
  await w.db.execute(
    sql`update delivery_job_offers set offered_at = ${offered}::timestamptz, expires_at = ${past}::timestamptz
      where id = ${offerId}`,
  );
}

async function count(q: ReturnType<typeof sql>) {
  const res = (await w.db.execute(q)) as unknown as
    { rows?: { n: number | string }[] } | { n: number | string }[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return Number(rows[0]?.n ?? 0);
}

describe('offer expiry sweep (DC-B11)', () => {
  it('expires an offer past its deadline twice in a row, with audit and staff notice', async () => {
    const { code, orderId } = await packedOnlineOrder(w);
    const o = await orderOf(w, code);
    await advanceShopOrder(w.t(), {
      shopIds: [w.shopId],
      code,
      expectedVersion: o.version,
      step: { to: 'ready_for_pickup' },
      staffUserId: w.shopUser,
      keyring,
    });
    for (let round = 0; round < 2; round += 1) {
      const job = await jobOf(w, orderId);
      expect(job.status).toBe('needs_agent');
      const agent = await makeAgent(w);
      const { offerId } = await offerDeliveryJob(w.t(), {
        scope: { all: true },
        staffUserId: w.staff,
        jobId: job.id,
        agentId: agent.agentId,
        expectedVersion: job.version,
      });
      // Not yet due: the sweep leaves it alone.
      expect((await expireDueDeliveryOffers(w.t())).expired).toBe(0);
      await passDeadline(offerId);
      const out = await expireDueDeliveryOffers(w.t());
      expect(out.failed).toEqual([]);
      expect(out.expired).toBe(1);
      expect((await jobOf(w, orderId)).status).toBe('needs_agent');
      expect(
        await count(
          sql`select count(*)::int as n from delivery_job_offers where id = ${offerId} and status = 'expired'`,
        ),
      ).toBe(1);
      expect(
        await count(sql`select count(*)::int as n from audit_log
          where action = 'delivery_job.offer_expired' and entity_id = ${job.id} and actor_role = 'system'
          and after->>'offerId' = ${offerId}`),
      ).toBe(1);
      expect(
        await count(sql`select count(*)::int as n from delivery_job_events
          where job_id = ${job.id} and kind = 'offer_expired' and offer_id = ${offerId}`),
      ).toBe(1);
      expect(
        await count(sql`select count(*)::int as n from notifications
          where kind = 'staff.delivery_offer_expired' and entity_id = ${offerId}`),
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
