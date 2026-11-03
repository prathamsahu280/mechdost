/**
 * Shop side of an order (spec 04 acceptance tests): offers are scoped to the shop and hide the customer until
 * accepted; concurrent accepts → exactly one; a late accept fails; accepting commits the stock; decline needs a
 * reason code; fulfilment steps in order; delivered only with the customer's code (a wrong code is counted).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptShopOffer,
  advanceShopOrder,
  declineShopOffer,
  deliverShopOrder,
  deliveryCodeFor,
  listShopOrders,
  placeCodOrder,
  quoteCheckout,
  routeOrder,
  type CityScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let staff = '';
let shopUser = '';
let scope: CityScope = { all: true };
const shop: Record<string, string> = {};
let keyN = 0;

async function placeAndRoute(to: string) {
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  keyN += 1;
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: `shop-orders-key-${String(keyN).padStart(5, '0')}`,
    address: {
      contactName: 'Ravi Sahu',
      contactPhone: '+919876543210',
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
  const [o] = await db.select().from(s.orders).where(eq(s.orders.code, code));
  const r = await routeOrder(t(), {
    scope,
    code,
    shopId: shop[to]!,
    expectedVersion: o!.version,
    staffUserId: staff,
  });
  return { code, assignmentId: r.assignmentId };
}
const orderRow = async (code: string) =>
  (await db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!;
const stock = async (name: string) =>
  (
    await db
      .select({ onHand: s.shopInventory.onHand, reserved: s.shopInventory.reserved })
      .from(s.shopInventory)
      .innerJoin(s.productVariants, eq(s.productVariants.id, s.shopInventory.variantId))
      .where(sql`${s.productVariants.sku} = ${OIL} and ${s.shopInventory.shopId} = ${shop[name]!}`)
  )[0]!;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-shoporders-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-shoporders-staff' }).returning())[0]!.id;
  shopUser = (await db.insert(s.users).values({ firebaseUid: 'fb-shoporders-shop' }).returning())[0]!.id;
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
  scope = { all: true };
});

afterAll(async () => {
  await client.close();
});

describe('offers', () => {
  it('only the offered shop sees the offer, without the customer; concurrent accepts → one; stock committed', async () => {
    const { code, assignmentId } = await placeAndRoute('Sharma Auto Parts');
    const offers = await listShopOrders(t(), [shop['Sharma Auto Parts']!], 'offers');
    expect(offers).toEqual([expect.objectContaining({ code, assignmentId, address: null })]);
    expect(await listShopOrders(t(), [shop['Gupta Lubes & Spares']!], 'offers')).toEqual([]);
    await expect(
      acceptShopOffer(t(), { shopIds: [shop['Gupta Lubes & Spares']!], assignmentId, staffUserId: shopUser }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const before = await stock('Sharma Auto Parts');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        acceptShopOffer(t(), { shopIds: [shop['Sharma Auto Parts']!], assignmentId, staffUserId: shopUser }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected').map((r) => (r.reason as { code: string }).code),
    ).toEqual([
      'ASSIGNMENT_UNAVAILABLE',
      'ASSIGNMENT_UNAVAILABLE',
      'ASSIGNMENT_UNAVAILABLE',
      'ASSIGNMENT_UNAVAILABLE',
    ]);
    expect(await stock('Sharma Auto Parts')).toEqual({
      onHand: before.onHand - 2,
      reserved: before.reserved - 2,
    });
    const active = await listShopOrders(t(), [shop['Sharma Auto Parts']!], 'active');
    expect(active[0]).toMatchObject({ code, status: 'confirmed', address: { contactName: 'Ravi Sahu' } });
    expect((await orderRow(code)).shopId).toBe(shop['Sharma Auto Parts']);
  });

  it('a late accept fails; decline needs a reason code and returns the order to admin', async () => {
    const late = await placeAndRoute('Sharma Auto Parts');
    await db
      .update(s.orderAssignments)
      .set({ offeredAt: sql`now() - interval '20 minutes'`, expiresAt: sql`now() - interval '1 second'` })
      .where(eq(s.orderAssignments.id, late.assignmentId));
    await expect(
      acceptShopOffer(t(), {
        shopIds: [shop['Sharma Auto Parts']!],
        assignmentId: late.assignmentId,
        staffUserId: shopUser,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_UNAVAILABLE' });

    const declined = await placeAndRoute('Gupta Lubes & Spares');
    const ids = [shop['Gupta Lubes & Spares']!];
    await expect(
      declineShopOffer(t(), {
        shopIds: ids,
        assignmentId: declined.assignmentId,
        reasonCode: 'no' as never,
        staffUserId: shopUser,
      }),
    ).rejects.toMatchObject({ code: 'DECLINE_REASON' });
    await declineShopOffer(t(), {
      shopIds: ids,
      assignmentId: declined.assignmentId,
      reasonCode: 'out_of_stock',
      staffUserId: shopUser,
    });
    expect((await orderRow(declined.code)).status).toBe('needs_rerouting');
    const [a] = await db
      .select()
      .from(s.orderAssignments)
      .where(eq(s.orderAssignments.id, declined.assignmentId));
    expect(a).toMatchObject({ status: 'declined', declineReason: 'out_of_stock' });
  });
});

describe('fulfilment', () => {
  it('pack → hand over → out for delivery → delivered only with the customer code', async () => {
    const [order] = await listShopOrders(t(), [shop['Sharma Auto Parts']!], 'active');
    const ids = [shop['Sharma Auto Parts']!];
    const code = order!.code;
    const step = async (stepArg: Parameters<typeof advanceShopOrder>[1]['step'], k = keyring) =>
      advanceShopOrder(t(), {
        shopIds: ids,
        code,
        expectedVersion: (await orderRow(code)).version,
        step: stepArg,
        staffUserId: shopUser,
        keyring: k,
      });
    await expect(step({ to: 'shipped', mode: 'own' })).rejects.toMatchObject({ code: 'WRONG_STEP' });
    await step({ to: 'packed' });
    await expect(
      step({ to: 'shipped', mode: 'courier', courier: 'Delhivery', awb: '' }),
    ).rejects.toMatchObject({
      code: 'COURIER_DETAILS',
    });
    await step({ to: 'shipped', mode: 'own' });
    await expect(step({ to: 'out_for_delivery' }, null as never)).rejects.toMatchObject({
      code: 'DELIVERY_CODES_UNAVAILABLE',
    });
    await step({ to: 'out_for_delivery' });

    const o = await orderRow(code);
    const [shipment] = await db.select().from(s.shipments).where(eq(s.shipments.orderId, o.id));
    const customerCode = await deliveryCodeFor(t(), keyring, shipment!.id);
    expect(customerCode).toMatch(/^\d{4}$/);
    const wrong = customerCode === '0000' ? '1111' : '0000';
    const deliver = async (entered: string) =>
      deliverShopOrder(t(), {
        shopIds: ids,
        code,
        deliveryCode: entered,
        expectedVersion: (await orderRow(code)).version,
        staffUserId: shopUser,
        keyring,
      });
    expect(await deliver(wrong)).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
    expect((await orderRow(code)).status).toBe('out_for_delivery');
    expect(await deliver(customerCode!)).toMatchObject({ ok: true });
    expect((await orderRow(code)).status).toBe('delivered');
    const events = await db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id));
    expect(events.map((e) => e.toStatus)).toEqual([
      'placed',
      'awaiting_shop',
      'confirmed',
      'packed',
      'shipped',
      'out_for_delivery',
      'delivered',
    ]);
  });
});

describe('advisor review fixes (2026-11-03)', () => {
  it('a paused shop cannot accept an offer made before the pause', async () => {
    const { assignmentId } = await placeAndRoute('Gupta Lubes & Spares');
    await db
      .update(s.shops)
      .set({ status: 'paused', statusReason: 'Stock audit this week', statusChangedBy: staff })
      .where(eq(s.shops.id, shop['Gupta Lubes & Spares']!));
    await expect(
      acceptShopOffer(t(), { shopIds: [shop['Gupta Lubes & Spares']!], assignmentId, staffUserId: shopUser }),
    ).rejects.toMatchObject({ code: 'SHOP_NOT_ACTIVE', status: 403 });
    const [a] = await db.select().from(s.orderAssignments).where(eq(s.orderAssignments.id, assignmentId));
    expect(a!.status).toBe('offered'); // untouched: the timer returns it to MechDost
    await db
      .update(s.shops)
      .set({ status: 'approved', statusReason: null, statusChangedBy: null })
      .where(eq(s.shops.id, shop['Gupta Lubes & Spares']!));
  });

  it('every shop action is audited, and finished orders no longer carry the address', async () => {
    const actions = (await db.select({ action: s.auditLog.action }).from(s.auditLog)).map((r) => r.action);
    for (const a of [
      'order.accepted_by_shop',
      'order.declined_by_shop',
      'order.packed',
      'order.shipped',
      'order.out_for_delivery',
      'order.delivered',
    ])
      expect(actions, a).toContain(a);
    const done = await listShopOrders(t(), [shop['Sharma Auto Parts']!], 'done');
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((o) => o.address === null)).toBe(true);
  });
});
