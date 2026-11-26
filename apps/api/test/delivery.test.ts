/**
 * Delivery agents over HTTP (spec 24): the role-leak matrix (anonymous, customer, agent A vs B, shop, staff by city,
 * finance), the public apply form (Turnstile, per-phone limit), and the per-user limit header.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { loadKeyring } from '@mechdost/db/crypto';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

let ctx: Awaited<ReturnType<typeof buildApp>>;
const city: Record<string, string> = {};
let n = 0;

async function login(role: string | null, opts: { cityId?: string | null; phone?: string } = {}) {
  n += 1;
  const phone = opts.phone ?? `+9197${String(10_000_000 + n).slice(-8)}`;
  const uid = `dl-api-${String(n)}-${randomUUID().slice(0, 6)}`;
  const token = ctx.verifier.add(`token-delivery-${uid}`, {
    firebaseUid: uid,
    phone,
    email: `${uid}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: uid,
    phone,
    email: `${uid}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: opts.cityId ?? null, grantedBy: null });
  return { headers: bearer(token), userId: user.id, phone };
}

async function agent() {
  const who = await login('delivery_agent');
  const [a] = await ctx.db
    .insert(s.deliveryAgents)
    .values({
      userId: who.userId,
      cityId: city.RPR!,
      name: 'Test Agent',
      phone: who.phone,
      vehicleType: 'bike',
    })
    .returning();
  return { ...who, agentId: a!.id };
}

beforeAll(async () => {
  ctx = await buildApp({ keyring, turnstile: new FakeTurnstile(['human-ok']) });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .onConflictDoNothing()
    .returning();
  const stateId = state?.id ?? (await ctx.db.select().from(s.states))[0]!.id;
  for (const [code, slug] of [
    ['RPR', 'raipur'],
    ['BHI', 'bhilai'],
  ] as const) {
    const [row] = await ctx.db
      .insert(s.cities)
      .values({ stateId, code, slug, name: slug, status: 'live' })
      .onConflictDoNothing()
      .returning();
    city[code] = row?.id ?? (await ctx.db.select().from(s.cities)).find((c) => c.code === code)!.id;
  }
});

const get = (path: string, headers: Record<string, string> = {}) =>
  ctx.app.request(`/v1${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  ctx.app.request(`/v1${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('public apply', () => {
  const application = {
    name: 'Ravi Kumar',
    phone: '9876500001',
    cityCode: 'RPR',
    vehicleType: 'bike',
    consent: true,
  };
  it('needs the human check and refuses unknown fields', async () => {
    expect((await post('/delivery-agent-applications', { application, turnstileToken: 'bot' })).status).toBe(
      400,
    );
    expect(
      (
        await post('/delivery-agent-applications', {
          application: { ...application, aadhaar: '123412341234' },
          turnstileToken: 'human-ok',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('/delivery-agent-applications', { application, turnstileToken: 'human-ok' })).status,
    ).toBe(201);
  });
  it('limits applications per phone', async () => {
    const app2 = { ...application, phone: '9876500002' };
    // A fresh limiter, so the per-IP limit (5 an hour) used by the test above does not answer first.
    const fresh = await buildApp({ keyring, turnstile: new FakeTurnstile(['human-ok']) });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push(
        (
          await fresh.app.request('/v1/delivery-agent-applications', {
            method: 'POST',
            body: JSON.stringify({ application: app2, turnstileToken: 'human-ok' }),
            headers: { 'Content-Type': 'application/json' },
          })
        ).status,
      );
    expect(codes).toEqual([201, 201, 201, 429]);
  });
});

describe('role-leak matrix', () => {
  it('anonymous → 401; a customer → 403 on agent routes', async () => {
    expect((await get('/agent/me')).status).toBe(401);
    const customer = await login(null);
    expect((await get('/agent/me', customer.headers)).status).toBe(403);
    expect((await get('/admin/delivery/jobs', customer.headers)).status).toBe(403);
  });

  it('an agent reads only their own profile; another agent’s or an unknown job is 404; staff routes are 403', async () => {
    const A = await agent();
    const me = await get('/agent/me', A.headers);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { id: string }).id).toBe(A.agentId);
    const missing = await get(`/agent/jobs/${randomUUID()}`, A.headers);
    expect(missing.status).toBe(404);
    expect((await get('/admin/delivery/jobs', A.headers)).status).toBe(403);
    expect((await get('/admin/delivery/agents', A.headers)).status).toBe(403);
    expect((await post('/admin/delivery/payouts', {}, A.headers)).status).toBe(403);
    // An onboarding agent cannot go online.
    const online = await post('/agent/me/online', { online: true, version: 1 }, A.headers);
    expect(online.status).toBe(403);
    expect(((await online.json()) as ErrorJson).error.code).toBe('AGENT_NOT_ACTIVE');
  });

  it('staff see only their city; ops cannot record payouts; finance cannot dispatch', async () => {
    const A = await agent();
    const ops = await login('ops_manager');
    const otherCity = await login('city_manager', { cityId: city.BHI! });
    const finance = await login('finance');
    const list = await get('/admin/delivery/agents', ops.headers);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toContain(A.agentId);
    expect((await get(`/admin/delivery/agents/${A.agentId}`, otherCity.headers)).status).toBe(404);
    const other = (await (await get('/admin/delivery/agents', otherCity.headers)).json()) as {
      items: { id: string }[];
    };
    expect(other.items.map((i) => i.id)).not.toContain(A.agentId);
    const payout = {
      agentId: A.agentId,
      amountPaise: 50_000,
      periodFrom: '2026-11-01',
      periodTo: '2026-11-07',
      method: 'upi',
      idempotencyKey: `pay-${randomUUID()}`,
    };
    expect((await post('/admin/delivery/payouts', payout, ops.headers)).status).toBe(403);
    expect((await post('/admin/delivery/payouts', payout, finance.headers)).status).toBe(200);
    expect((await get('/admin/delivery/jobs', finance.headers)).status).toBe(403);
    const own = (await (await get('/agent/me/earnings', A.headers)).json()) as { totalPaise: number };
    expect(own.totalPaise).toBe(50_000);
  });

  it('a signed-in customer cannot use agent or staff delivery routes (shop users: delivery-contract.test.ts)', async () => {
    const customerOnly = await login(null);
    expect((await get('/agent/jobs?view=active', customerOnly.headers)).status).toBe(403);
    expect(
      (
        await post(
          `/admin/delivery/jobs/${randomUUID()}/offer`,
          { agentId: randomUUID(), version: 1 },
          customerOnly.headers,
        )
      ).status,
    ).toBe(403);
  });
});

describe('limits', () => {
  it('one agent request lowers RateLimit-Remaining by exactly 1', async () => {
    const A = await agent();
    const first = await get('/agent/me', A.headers);
    const second = await get('/agent/me', A.headers);
    const a = Number(first.headers.get('RateLimit-Remaining'));
    const b = Number(second.headers.get('RateLimit-Remaining'));
    expect(a - b).toBe(1);
  });
});
