/**
 * "Your savings" API (decision 2026-11-26): `GET /v1/me/savings?period=month|year` and
 * `GET /v1/me/orders/{code}/savings`. The user id comes from the session only; another customer's order is 404 and
 * their totals never mix in; shop accounts are refused; the admin switch (`customers.savings_enabled`) hides
 * everything (`enabled: false`, and the cart quote carries no estimate) without stopping the ledger.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
const ids: Record<string, string> = {};
const heads: Record<string, Record<string, string>> = {};
let seq = 0;

async function person(key: string, role: string | null, shopId: string | null = null) {
  const phone = `+9198555555${key}`;
  const token = ctx.verifier.add(`token-savings-test-00${key}`, {
    firebaseUid: `sv-${key}`,
    phone,
    email: `sv-${key}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `sv-${key}`,
    phone,
    email: `sv-${key}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  ids[key] = user.id;
  heads[key] = { ...bearer(token), 'content-type': 'application/json' };
}

/** A delivered sub-order of `userId` with its ledger row (MRP saving 5,000 paise, one line without an MRP). */
async function deliveredOrder(userId: string) {
  seq += 1;
  const [city] = await ctx.db.select().from(s.cities).limit(1);
  const [shop] = await ctx.db.select().from(s.shops).limit(1);
  const code = `MD-RPR-2026-S${String(seq).padStart(5, '0')}`;
  const [g] = await ctx.db
    .insert(s.orderGroups)
    .values({
      code,
      userId,
      cityId: city!.id,
      paymentMethod: 'cod',
      paymentStatus: 'cod_collected',
      subtotalPaise: 50_000,
      totalPaise: 50_000,
      idempotencyKey: `savings-api-idem-${code}-xxxxxxxx`,
    })
    .returning();
  const [o] = await ctx.db
    .insert(s.orders)
    .values({
      groupId: g!.id,
      subNo: 1,
      code: `${code}-1`,
      userId,
      cityId: city!.id,
      status: 'delivered',
      shopId: shop!.id,
      shippingAddress: { line1: 'x' },
      pincode: '492001',
      subtotalPaise: 50_000,
      totalPaise: 50_000,
      deliveredAt: new Date(),
    })
    .returning();
  await ctx.db.insert(s.customerSavingsEntries).values({
    userId,
    orderId: o!.id,
    cityId: city!.id,
    kind: 'delivered',
    mrpPaise: 5_000,
    couponPaise: 0,
    coinsPaise: 0,
    deliveryPaise: 0,
    totalPaise: 5_000,
    countedLines: 1,
    excludedLines: 1,
    periodAt: new Date(),
  });
  return { groupCode: code, subCode: `${code}-1` };
}

const get = (key: string | null, path: string) =>
  ctx.app.request(`/v1${path}`, { headers: key ? heads[key] : {} });

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  await person('01', null);
  await person('02', null);
  const [shop] = await ctx.db.select().from(s.shops).limit(1);
  await person('04', 'seller_owner', shop!.id);
});

describe('GET /v1/me/savings', () => {
  it('needs sign-in and refuses shop accounts', async () => {
    expect((await get(null, '/me/savings?period=month')).status).toBe(401);
    expect((await get('04', '/me/savings?period=month')).status).toBe(403);
  });

  it('refuses an unknown period', async () => {
    const res = await get('01', '/me/savings?period=week');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('returns this month and this year with every component, the order count and the excluded lines', async () => {
    await deliveredOrder(ids['01']!);
    for (const period of ['month', 'year'] as const) {
      const res = await get('01', `/me/savings?period=${period}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        enabled: true,
        period,
        mrpPaise: 5_000,
        couponPaise: 0,
        coinsPaise: 0,
        deliveryPaise: 0,
        totalPaise: 5_000,
        orders: 1,
        excludedLines: 1,
      });
    }
  });

  it('another customer’s savings never mix in', async () => {
    const res = await get('02', '/me/savings?period=year');
    expect(await res.json()).toMatchObject({ totalPaise: 0, orders: 0 });
  });
});

describe('GET /v1/me/orders/{code}/savings', () => {
  it('returns the owner’s breakdown by checkout or part code; another customer gets 404', async () => {
    const { groupCode, subCode } = await deliveredOrder(ids['01']!);
    for (const code of [groupCode, subCode]) {
      const res = await get('01', `/me/orders/${code}/savings`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        enabled: true,
        status: 'final',
        totalPaise: 5_000,
        excludedLines: 1,
      });
    }
    const leak = await get('02', `/me/orders/${groupCode}/savings`);
    expect(leak.status).toBe(404);
    expect(JSON.stringify(await leak.json())).not.toContain('5000');
  });

  it('refuses a malformed code without looking it up', async () => {
    expect((await get('01', '/me/orders/not-a-code/savings')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('the admin switch (runs last: it leaves the switch off)', () => {
  const sku = () => fixture.products.find((p) => p.slug === 'exide-xltz4a-2w-battery')?.sku ?? '';
  const quote = async () =>
    (await (
      await ctx.app.request('/v1/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pincode: '492004', lines: [{ sku: sku(), qty: 1 }] }),
      })
    ).json()) as { savingsEstimate: { totalPaise: number } | null };

  it('on (default): the cart quote carries the server-computed estimate', async () => {
    expect((await quote()).savingsEstimate?.totalPaise).toBeGreaterThan(0);
  });

  it('off: every surface says enabled false with zeros, and the cart quote has no estimate', async () => {
    const { groupCode } = await deliveredOrder(ids['01']!);
    await ctx.db.insert(s.settings).values({ key: 'customers.savings_enabled', value: false });
    expect(await (await get('01', '/me/savings?period=year')).json()).toMatchObject({
      enabled: false,
      totalPaise: 0,
    });
    expect(await (await get('01', `/me/orders/${groupCode}/savings`)).json()).toMatchObject({
      enabled: false,
      status: 'none',
      totalPaise: 0,
    });
    expect((await quote()).savingsEstimate).toBeNull();
  });
});
