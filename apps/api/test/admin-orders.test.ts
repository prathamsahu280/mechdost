/**
 * Admin routing over HTTP (spec 04): city scope per permission (another city's manager gets 404), read-only staff
 * cannot route (403), routing needs the version, ranked shops come with the order, reject needs a reason code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole, placeCodOrder, quoteCheckout } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;
let code = '';

async function staff(n: string, role: string, cityId: string | null = null) {
  const phone = `+9198222222${n}`;
  const token = ctx.verifier.add(`token-routing-0000${n}`, {
    firebaseUid: `ro-${n}`,
    phone,
    email: `ro-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `ro-${n}`,
    phone,
    email: `ro-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  const customer = await ensureUser(ctx.db, {
    firebaseUid: 'ro-customer',
    phone: '+919822222299',
    email: 'ro-customer@example.com',
    emailVerified: true,
  });
  const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
  const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(ctx.db, {
    userId: customer.id,
    idempotencyKey: 'admin-orders-key-0001',
    address: {
      contactName: 'Ravi',
      contactPhone: '+919822222299',
      line1: 'House 12, Pandri',
      line2: null,
      landmark: null,
      pincode: '492004',
    },
    lines,
    expectedTotalPaise: q.totalPaise,
    note: null,
    locale: 'en',
  });
  code = placed.orders[0]!.code;
});

describe('admin orders API', () => {
  it('scopes by city and permission, routes with the version, rejects with a reason', async () => {
    const ops = await staff('01', 'ops_manager');
    const agent = await staff('02', 'support_agent');
    const [state] = await ctx.db.select().from(s.states);
    const [bilaspur] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'BLS', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
      .returning();
    const otherCity = await staff('03', 'city_manager', bilaspur!.id);
    const marketing = await staff('04', 'marketing');

    expect((await ctx.app.request('/v1/admin/orders', { headers: marketing })).status).toBe(403);
    // Each request counts once against the per-user limit (no middleware runs twice on the list path).
    const remaining = async () =>
      Number(
        (await ctx.app.request('/v1/admin/orders', { headers: ops })).headers.get('RateLimit-Remaining'),
      );
    const r1 = await remaining();
    expect(await remaining()).toBe(r1 - 1);
    const queue = (await (await ctx.app.request('/v1/admin/orders', { headers: ops })).json()) as {
      items: { code: string; version: number }[];
    };
    expect(queue.items.map((i) => i.code)).toEqual([code]);
    const foreign = (await (await ctx.app.request('/v1/admin/orders', { headers: otherCity })).json()) as {
      items: unknown[];
    };
    expect(foreign.items).toEqual([]);
    expect((await ctx.app.request(`/v1/admin/orders/${code}`, { headers: otherCity })).status).toBe(404);

    const view = (await (await ctx.app.request(`/v1/admin/orders/${code}`, { headers: agent })).json()) as {
      version: number;
      shops: { shopId: string; name: string; eligible: boolean }[];
    };
    const best = view.shops[0]!;
    expect(best).toMatchObject({ name: 'Sharma Auto Parts', eligible: true });

    const routeBody = JSON.stringify({ shopId: best.shopId, version: view.version });
    expect(
      (
        await ctx.app.request(`/v1/admin/orders/${code}/route`, {
          method: 'POST',
          headers: agent,
          body: routeBody,
        })
      ).status,
    ).toBe(403);
    const stale = await ctx.app.request(`/v1/admin/orders/${code}/route`, {
      method: 'POST',
      headers: ops,
      body: JSON.stringify({ shopId: best.shopId, version: view.version + 5 }),
    });
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_ORDER');
    const routed = await ctx.app.request(`/v1/admin/orders/${code}/route`, {
      method: 'POST',
      headers: ops,
      body: routeBody,
    });
    expect(routed.status).toBe(200);
    expect(((await routed.json()) as { expiresAt: string }).expiresAt).toMatch(/^\d{4}-/);

    const reject = await ctx.app.request(`/v1/admin/orders/${code}/reject`, {
      method: 'POST',
      headers: ops,
      body: JSON.stringify({ reasonCode: 'out of stock', message: 'Sorry about this order.', version: 1 }),
    });
    expect(reject.status).toBe(400); // reason must be a code
  });
});
