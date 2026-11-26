/**
 * Cash on delivery on request over HTTP (founder ruling 2026-11-26): the real defaults (everyone off), the quote's
 * personal answer with a bearer token, placement refused with COD_NOT_ELIGIBLE, the request flow, role leaks (a
 * customer or support agent cannot decide; a city manager of another city gets 404; staff cannot decide their own),
 * strict bodies with reason codes, and the per-user request limit.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { cities, settings } from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';
const PIN = '492004';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let raipur = '';

type Role = 'super_admin' | 'support_agent' | 'city_manager' | 'ops_manager';
async function person(n: string, role: Role | null = null, cityId: string | null = null) {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-cod-requests-0000${n}`, {
    firebaseUid: `cod-${n}`,
    phone,
    email: `cod-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `cod-${n}`,
    phone,
    email: `cod-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const post = (url: string, headers: Record<string, string>, body: unknown) =>
  ctx.app.request(url, { method: 'POST', headers, body: JSON.stringify(body) });

async function quote(headers: Record<string, string>) {
  const res = await post('/v1/checkout/quote', headers, { pincode: PIN, lines: [{ sku: OIL, qty: 1 }] });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    totalPaise: number;
    cod: { allowed: boolean; eligibility: { eligible: boolean; reason: string | null; canRequest: boolean } };
  };
}

async function placeCod(headers: Record<string, string>, key: string) {
  const q = await quote(headers);
  return ctx.app.request('/v1/orders', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': key },
    body: JSON.stringify({
      address: {
        contactName: 'Ravi Sahu',
        contactPhone: '+919876543210',
        line1: 'House 12, Pandri',
        pincode: PIN,
      },
      lines: [{ sku: OIL, qty: 1 }],
      expectedTotalPaise: q.totalPaise,
      paymentMethod: 'cod',
    }),
  });
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  // The shared test database keeps COD for everyone for older suites; this suite tests the real default.
  await ctx.db.delete(settings).where(eq(settings.key, 'checkout.cod_everyone'));
  raipur = (await ctx.db.select({ id: cities.id }).from(cities).where(eq(cities.code, 'RPR')))[0]!.id;
});

describe('COD eligibility over HTTP', () => {
  it('guest and normal customer: no COD; the quote says why; placing COD is 422 COD_NOT_ELIGIBLE', async () => {
    const guest = await quote({ 'content-type': 'application/json' });
    expect(guest.cod.eligibility).toMatchObject({ eligible: false, reason: 'sign_in_required' });
    const customer = await person('01');
    const mine = await quote(customer.headers);
    expect(mine.cod).toMatchObject({
      allowed: false,
      eligibility: { reason: 'not_approved', canRequest: true },
    });
    const res = await placeCod(customer.headers, 'cod-place-key-000000001');
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorJson).error.code).toBe('COD_NOT_ELIGIBLE');
  });

  it('request → approve → COD at checkout; customers and support agents cannot decide', async () => {
    const customer = await person('02');
    const other = await person('03');
    const agent = await person('04', 'support_agent');
    const ops = await person('05', 'ops_manager');
    const bad = await post('/v1/me/cod/requests', customer.headers, {
      pincode: PIN,
      reasonCode: 'I have cash',
    });
    expect(bad.status).toBe(400); // reason must be a code (ML-ready)
    const extra = await post('/v1/me/cod/requests', customer.headers, {
      pincode: PIN,
      reasonCode: 'no_upi_or_card',
      status: 'approved',
    });
    expect(extra.status).toBe(400); // strict body: no mass assignment
    const created = await post('/v1/me/cod/requests', customer.headers, {
      pincode: PIN,
      reasonCode: 'no_upi_or_card',
      note: 'No UPI on my phone',
    });
    expect(created.status).toBe(201);
    const { id, version } = (await created.json()) as { id: string; version: number };
    const again = await post('/v1/me/cod/requests', customer.headers, { pincode: PIN, reasonCode: 'other' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe('COD_REQUEST_PENDING');

    const me = (await (
      await ctx.app.request(`/v1/me/cod?pincode=${PIN}`, { headers: customer.headers })
    ).json()) as {
      eligibility: { reason: string };
      requests: { id: string; status: string }[];
    };
    expect(me.eligibility.reason).toBe('request_pending');
    expect(me.requests[0]).toMatchObject({ id, status: 'pending' });
    // Another customer cannot withdraw it (404, never a 403 that confirms the id exists).
    expect((await post(`/v1/me/cod/requests/${id}/withdraw`, other.headers, { version })).status).toBe(404);

    const approveUrl = `/v1/admin/cod-requests/${id}/approve`;
    expect((await post(approveUrl, customer.headers, { version })).status).toBe(403);
    expect((await post(approveUrl, agent.headers, { version })).status).toBe(403);
    expect((await ctx.app.request('/v1/admin/cod-requests', { headers: agent.headers })).status).toBe(403);
    const queue = (await (
      await ctx.app.request('/v1/admin/cod-requests', { headers: ops.headers })
    ).json()) as {
      items: { id: string; customerPhone: string | null; cityCode: string }[];
    };
    const item = queue.items.find((i) => i.id === id);
    expect(item?.cityCode).toBe('RPR');
    expect(item?.customerPhone).toMatch(/^•+\d{4}$/); // masked for staff without customers:read_pii
    const ok = await post(approveUrl, ops.headers, { version, capPaise: 300_000 });
    expect(ok.status).toBe(200);
    const after = await quote(customer.headers);
    expect(after.cod).toMatchObject({ allowed: true, eligibility: { eligible: true } });
    expect((await placeCod(customer.headers, 'cod-place-key-000000002')).status).toBe(201);
  });

  it('city scope: a city manager of another city gets 404 and an empty queue; staff cannot decide their own', async () => {
    const customer = await person('06');
    const created = await post('/v1/me/cod/requests', customer.headers, {
      pincode: PIN,
      reasonCode: 'regular_buyer',
    });
    const { id, version } = (await created.json()) as { id: string; version: number };
    const [home] = await ctx.db.select().from(cities).where(eq(cities.id, raipur));
    const [elsewhere] = await ctx.db
      .insert(cities)
      .values({ code: 'BLP', slug: 'bilaspur-cod-test', name: 'Bilaspur', stateId: home!.stateId })
      .returning();
    const farManager = await person('07', 'city_manager', elsewhere!.id);
    const homeManager = await person('08', 'city_manager', raipur);
    const far = await post(`/v1/admin/cod-requests/${id}/reject`, farManager.headers, {
      version,
      reasonCode: 'insufficient_history',
    });
    expect(far.status).toBe(404);
    const farQueue = (await (
      await ctx.app.request('/v1/admin/cod-requests', { headers: farManager.headers })
    ).json()) as {
      items: unknown[];
    };
    expect(farQueue.items).toHaveLength(0);
    const rejected = await post(`/v1/admin/cod-requests/${id}/reject`, homeManager.headers, {
      version,
      reasonCode: 'insufficient_history',
    });
    expect(rejected.status).toBe(200);

    const own = await post('/v1/me/cod/requests', homeManager.headers, { pincode: PIN, reasonCode: 'other' });
    const mine = (await own.json()) as { id: string; version: number };
    const self = await post(`/v1/admin/cod-requests/${mine.id}/approve`, homeManager.headers, {
      version: mine.version,
    });
    expect(self.status).toBe(403);
    expect(((await self.json()) as ErrorJson).error.code).toBe('COD_SELF_DECISION');
  });

  it('requests are limited per customer per day', async () => {
    const customer = await person('09');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post('/v1/me/cod/requests', customer.headers, { pincode: PIN, reasonCode: 'other' });
      statuses.push(res.status);
      if (res.status === 201) {
        const { id, version } = (await res.json()) as { id: string; version: number };
        await post(`/v1/me/cod/requests/${id}/withdraw`, customer.headers, { version });
      }
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
