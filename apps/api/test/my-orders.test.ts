/**
 * Customer order API: list and track your own orders (others → 404), cancel with a reason code before packing,
 * one rate-limit count per request on the shared /orders prefix; staff cancel needs orders:cancel.
 */
import * as s from '@mechdost/db/schema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function person(n: string, role: string | null = null) {
  const phone = `+9198777777${n}`;
  const token = ctx.verifier.add(`token-myorders-000${n}`, {
    firebaseUid: `mo-${n}`,
    phone,
    email: `mo-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `mo-${n}`,
    phone,
    email: `mo-${n}@example.com`,
    emailVerified: true,
  });
  if (role) await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
  // These tests cancel as the customer, which is off by default (Q25: cancel through support only).
  await ctx.db.insert(s.settings).values({ key: 'orders.customer_self_cancel_cod', value: true });
});

describe('my orders API', () => {
  it('lists, tracks and cancels your own order; others get 404', async () => {
    const me = await person('01');
    const other = await person('02');
    const agent = await person('03', 'support_agent');
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
    const quote = (await (
      await ctx.app.request('/v1/checkout/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pincode: '492004', lines }),
      })
    ).json()) as { totalPaise: number };
    const placed = await ctx.app.request('/v1/orders', {
      method: 'POST',
      headers: { ...me, 'idempotency-key': 'my-orders-key-000001' },
      body: JSON.stringify({
        address: {
          contactName: 'Ravi Sahu',
          contactPhone: '+919876543210',
          line1: 'House 12, Pandri',
          pincode: '492004',
        },
        lines,
        expectedTotalPaise: quote.totalPaise,
        paymentMethod: 'cod',
      }),
    });
    expect(placed.status).toBe(201);
    const { code, orders } = (await placed.json()) as { code: string; orders: { code: string }[] };

    const remaining = async () =>
      Number((await ctx.app.request('/v1/orders', { headers: me })).headers.get('RateLimit-Remaining'));
    const r1 = await remaining();
    expect(await remaining()).toBe(r1 - 1);

    const list = (await (await ctx.app.request('/v1/orders', { headers: me })).json()) as {
      orders: { code: string }[];
    };
    expect(list.orders.map((o) => o.code)).toEqual([code]);
    expect(
      ((await (await ctx.app.request('/v1/orders', { headers: other })).json()) as { orders: unknown[] })
        .orders,
    ).toEqual([]);
    expect((await ctx.app.request(`/v1/orders/${code}`, { headers: other })).status).toBe(404);

    const tracked = (await (
      await ctx.app.request(`/v1/orders/${code}?locale=hi`, { headers: me })
    ).json()) as {
      orders: {
        code: string;
        status: string;
        version: number;
        canCancel: boolean;
        timeline: { status: string }[];
      }[];
    };
    const sub = tracked.orders[0]!;
    expect(sub).toMatchObject({
      code: orders[0]!.code,
      status: 'placed',
      canCancel: true,
      timeline: [{ status: 'placed' }],
    });

    const staffCancel = await ctx.app.request(`/v1/admin/orders/${sub.code}/cancel`, {
      method: 'POST',
      headers: agent,
      body: JSON.stringify({ reasonCode: 'other', version: sub.version }),
    });
    expect(staffCancel.status).toBe(403); // support agents cannot cancel orders

    const cancelUrl = `/v1/orders/${sub.code}/cancel`;
    const noReason = await ctx.app.request(cancelUrl, {
      method: 'POST',
      headers: me,
      body: JSON.stringify({ version: sub.version }),
    });
    expect(noReason.status).toBe(400);
    const ok = await ctx.app.request(cancelUrl, {
      method: 'POST',
      headers: me,
      body: JSON.stringify({ reasonCode: 'ordered_by_mistake', version: sub.version }),
    });
    expect(await ok.json()).toMatchObject({ status: 'cancelled' });
    const again = await ctx.app.request(cancelUrl, {
      method: 'POST',
      headers: me,
      body: JSON.stringify({ reasonCode: 'ordered_by_mistake', version: sub.version + 1 }),
    });
    expect(((await again.json()) as ErrorJson).error.code).toBe('NOT_CANCELLABLE');
  });
});
