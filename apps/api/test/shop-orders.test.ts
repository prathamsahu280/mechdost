/**
 * Shop portal API (spec 04/07): a shop owner sees and accepts its own offer (another shop's owner gets 404, staff
 * with a global grant see none), moves the order through fulfilment and delivers it with the customer's code.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import {
  deliveryCodeFor,
  ensureUser,
  grantRole,
  placeCodOrder,
  quoteCheckout,
  routeOrder,
} from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

let ctx: Awaited<ReturnType<typeof buildApp>>;
const shop: Record<string, string> = {};

async function person(n: string, role: string, shopId: string | null = null) {
  const phone = `+9198111111${n}`;
  const token = ctx.verifier.add(`token-shopapi-0000${n}`, {
    firebaseUid: `sa-${n}`,
    phone,
    email: `sa-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `sa-${n}`,
    phone,
    email: `sa-${n}@example.com`,
    emailVerified: true,
  });
  await grantRole(ctx.db, { userId: user.id, role, shopId, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

beforeAll(async () => {
  ctx = await buildApp({ keyring });
  await seedRaipurDemo(ctx.db, fixture);
  for (const row of await ctx.db.select().from(s.shops)) shop[row.name] = row.id;
});

describe('shop orders API', () => {
  it('offer → accept → pack → hand over → out for delivery → delivered with the code', async () => {
    const owner = await person('01', 'seller_owner', shop['Sharma Auto Parts']);
    const other = await person('02', 'seller_owner', shop['Gupta Lubes & Spares']);
    const ops = await person('03', 'ops_manager');
    const customer = await ensureUser(ctx.db, {
      firebaseUid: 'sa-customer',
      phone: '+919811111199',
      email: 'sa-customer@example.com',
      emailVerified: true,
    });
    const lines = [{ sku: 'CAS-ACT4T-0900', qty: 1 }];
    const q = await quoteCheckout(ctx.db, { pincode: '492004', lines, locale: 'en' });
    const placed = await placeCodOrder(ctx.db, {
      userId: customer.id,
      idempotencyKey: 'shop-api-key-00000001',
      address: {
        contactName: 'Ravi',
        contactPhone: '+919811111199',
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
    const code = placed.orders[0]!.code;
    const o = (await ctx.db.select().from(s.orders)).find((r) => r.code === code);
    await routeOrder(ctx.db, {
      scope: { all: true },
      code,
      shopId: shop['Sharma Auto Parts']!,
      expectedVersion: o!.version,
      staffUserId: ops.id,
    });

    const offers = (await (await ctx.app.request('/v1/shop/orders', { headers: owner.headers })).json()) as {
      orders: { code: string; assignmentId: string; address: unknown }[];
    };
    expect(offers.orders).toEqual([expect.objectContaining({ code, address: null })]);
    const { assignmentId } = offers.orders[0]!;
    const none = (await (await ctx.app.request('/v1/shop/orders', { headers: ops.headers })).json()) as {
      orders: unknown[];
    };
    expect(none.orders).toEqual([]);
    expect(
      (
        await ctx.app.request(`/v1/shop/offers/${assignmentId}/accept`, {
          method: 'POST',
          headers: other.headers,
        })
      ).status,
    ).toBe(404);

    const accepted = await ctx.app.request(`/v1/shop/offers/${assignmentId}/accept`, {
      method: 'POST',
      headers: owner.headers,
    });
    expect(accepted.status).toBe(200);
    let version = ((await accepted.json()) as { version: number }).version;
    const again = await ctx.app.request(`/v1/shop/offers/${assignmentId}/accept`, {
      method: 'POST',
      headers: owner.headers,
    });
    expect(((await again.json()) as ErrorJson).error.code).toBe('ASSIGNMENT_UNAVAILABLE');

    const advance = async (payload: Record<string, unknown>) => {
      const res = await ctx.app.request(`/v1/shop/orders/${code}/advance`, {
        method: 'POST',
        headers: owner.headers,
        body: JSON.stringify({ ...payload, version }),
      });
      expect(res.status, JSON.stringify(payload)).toBe(200);
      version = ((await res.json()) as { version: number }).version;
    };
    await advance({ to: 'packed' });
    await advance({ to: 'shipped', mode: 'own' });
    await advance({ to: 'out_for_delivery' });

    const shipment = (await ctx.db.select().from(s.shipments)).find((r) => r.orderId === o!.id);
    const deliveryCode = await deliveryCodeFor(ctx.db, keyring, shipment!.id);
    const wrong = await ctx.app.request(`/v1/shop/orders/${code}/deliver`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ deliveryCode: deliveryCode === '0000' ? '1111' : '0000', version }),
    });
    expect(await wrong.json()).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
    const right = await ctx.app.request(`/v1/shop/orders/${code}/deliver`, {
      method: 'POST',
      headers: owner.headers,
      body: JSON.stringify({ deliveryCode, version }),
    });
    expect(await right.json()).toMatchObject({ ok: true });
    const done = (await ctx.db.select().from(s.orders)).find((r) => r.code === code);
    expect(done!.status).toBe('delivered');
  });
});
