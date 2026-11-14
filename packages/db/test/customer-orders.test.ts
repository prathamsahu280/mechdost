/**
 * Customer orders (spec 03/04/05): own orders only (404 otherwise); tracking shows the timeline, the seller once
 * accepted, the rejection message and the delivery code while out for delivery; cancel needs a reason code,
 * stops at `packed` for customers (staff may cancel packed), withdraws the offer and puts the stock back.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  pgCode,
  acceptShopOffer,
  advanceShopOrder,
  cancelMyOrder,
  cancelOrderAsStaff,
  getMyOrder,
  listMyOrders,
  overrideOrderDelivery,
  placeCodOrder,
  quoteCheckout,
  rankShopsForOrder,
  rejectOrder,
  routeOrder,
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
let stranger = '';
let staff = '';
let sharma = '';
let n = 0;

async function place() {
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  n += 1;
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: `customer-orders-${String(n).padStart(6, '0')}`,
    address: {
      contactName: 'Ravi',
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
  return { group: placed.code, code: placed.orders[0]!.code };
}
const row = async (code: string) => (await db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!;
const shelf = async () =>
  (
    await db
      .select({ onHand: s.shopInventory.onHand, reserved: s.shopInventory.reserved })
      .from(s.shopInventory)
      .innerJoin(s.productVariants, eq(s.productVariants.id, s.shopInventory.variantId))
      .where(sql`${s.productVariants.sku} = ${OIL} and ${s.shopInventory.shopId} = ${sharma}`)
  )[0]!;
async function routeAndAccept(code: string) {
  await routeOrder(t(), {
    scope: { all: true },
    code,
    shopId: sharma,
    expectedVersion: (await row(code)).version,
    staffUserId: staff,
  });
  const [a] = await db
    .select()
    .from(s.orderAssignments)
    .where(sql`${s.orderAssignments.status} = 'offered'`);
  await acceptShopOffer(t(), { shopIds: [sharma], assignmentId: a!.id, staffUserId: staff });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const user = async (uid: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
  customer = await user('fb-co-customer');
  stranger = await user('fb-co-stranger');
  staff = await user('fb-co-staff');
  sharma = (await db.select().from(s.shops).where(eq(s.shops.name, 'Sharma Auto Parts')))[0]!.id;
  // These tests exercise customer cancelling, which is off by default (Q25: cancel through support only).
  await db.insert(s.settings).values({ key: 'orders.customer_self_cancel_cod', value: true });
});

afterAll(async () => {
  await client.close();
});

describe('my orders', () => {
  it('by default the customer cannot cancel; support (staff) cancels (Q25, user 2026-11-13)', async () => {
    await db.delete(s.settings).where(eq(s.settings.key, 'orders.customer_self_cancel_cod'));
    try {
      const { code, group } = await place();
      expect((await row(code)).cancellableUntilStatus).toBe('none');
      const detail = await getMyOrder(t(), customer, group, { locale: 'en', keyring });
      expect(detail.orders[0]).toMatchObject({ status: 'placed', canCancel: false });
      await expect(
        cancelMyOrder(t(), { userId: customer, code, reasonCode: 'changed_mind', expectedVersion: 1 }),
      ).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
      await cancelOrderAsStaff(t(), {
        cityIds: 'all',
        code,
        reasonCode: 'changed_mind',
        expectedVersion: (await row(code)).version,
        staffUserId: staff,
      });
      expect((await row(code)).status).toBe('cancelled');
    } finally {
      await db.insert(s.settings).values({ key: 'orders.customer_self_cancel_cod', value: true });
    }
  });

  it('COD and online self-cancel are separate settings: the online rule never opens COD orders (user 2026-11-14)', async () => {
    await db.delete(s.settings).where(eq(s.settings.key, 'orders.customer_self_cancel_cod'));
    await db.insert(s.settings).values({ key: 'orders.customer_self_cancel_online', value: true });
    try {
      const { code } = await place();
      expect((await row(code)).cancellableUntilStatus).toBe('none');
    } finally {
      await db.delete(s.settings).where(eq(s.settings.key, 'orders.customer_self_cancel_online'));
      await db.insert(s.settings).values({ key: 'orders.customer_self_cancel_cod', value: true });
    }
    const { code } = await place();
    expect((await row(code)).cancellableUntilStatus).toBe('confirmed');
  });

  it('cancelling a placed order needs a reason and frees the held stock; strangers get 404', async () => {
    const start = await shelf();
    const { code, group } = await place();
    expect((await shelf()).reserved).toBe(start.reserved + 2);
    await expect(
      cancelMyOrder(t(), { userId: stranger, code, reasonCode: 'changed_mind', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getMyOrder(t(), stranger, group, { locale: 'en', keyring })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      cancelMyOrder(t(), { userId: customer, code, reasonCode: 'meh' as never, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'CANCEL_REASON' });
    await cancelMyOrder(t(), {
      userId: customer,
      code,
      reasonCode: 'changed_mind',
      expectedVersion: (await row(code)).version,
    });
    expect(await shelf()).toEqual(start);
    const detail = await getMyOrder(t(), customer, group, { locale: 'en', keyring });
    expect(detail.orders[0]).toMatchObject({ status: 'cancelled', canCancel: false });
    expect(detail.orders[0]!.timeline.map((e) => e.status)).toEqual(['placed', 'cancelled']);
    // The database keeps the reason with its status: a cancelled order cannot carry a reject reason.
    const err: unknown = await db
      .update(s.orders)
      .set({ statusReasonCode: 'pricing_error' })
      .where(eq(s.orders.code, code))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(pgCode(err)).toBe('23514'); // check_violation
  });

  it('an accepted order puts its stock back on the shelf when cancelled; the offer is withdrawn while waiting', async () => {
    const start = await shelf();
    const waiting = await place();
    await routeOrder(t(), {
      scope: { all: true },
      code: waiting.code,
      shopId: sharma,
      expectedVersion: (await row(waiting.code)).version,
      staffUserId: staff,
    });
    await cancelMyOrder(t(), {
      userId: customer,
      code: waiting.code,
      reasonCode: 'delivery_too_slow',
      expectedVersion: (await row(waiting.code)).version,
    });
    const [offer] = await db
      .select()
      .from(s.orderAssignments)
      .where(eq(s.orderAssignments.orderId, (await row(waiting.code)).id));
    expect(offer!.status).toBe('withdrawn');
    expect(await shelf()).toEqual(start);

    const accepted = await place();
    await routeAndAccept(accepted.code);
    expect(await shelf()).toEqual({ onHand: start.onHand - 2, reserved: start.reserved });
    const tracked = await getMyOrder(t(), customer, accepted.group, { locale: 'hi', keyring });
    expect(tracked.orders[0]).toMatchObject({
      status: 'confirmed',
      seller: 'शर्मा ऑटो पार्ट्स',
      canCancel: true,
    });
    await cancelMyOrder(t(), {
      userId: customer,
      code: accepted.code,
      reasonCode: 'found_cheaper',
      expectedVersion: (await row(accepted.code)).version,
    });
    expect(await shelf()).toEqual(start);
  });

  it('customers cannot cancel once packed (staff can); tracking shows the delivery code and rejection messages', async () => {
    const packed = await place();
    await routeAndAccept(packed.code);
    const step = async (to: 'packed' | 'out_for_delivery') =>
      advanceShopOrder(t(), {
        shopIds: [sharma],
        code: packed.code,
        expectedVersion: (await row(packed.code)).version,
        step: { to },
        staffUserId: staff,
        keyring,
      });
    await step('packed');
    await expect(
      cancelMyOrder(t(), {
        userId: customer,
        code: packed.code,
        reasonCode: 'changed_mind',
        expectedVersion: (await row(packed.code)).version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_CANCELLABLE' });
    await advanceShopOrder(t(), {
      shopIds: [sharma],
      code: packed.code,
      expectedVersion: (await row(packed.code)).version,
      step: { to: 'shipped', mode: 'own' },
      staffUserId: staff,
      keyring,
    });
    await step('out_for_delivery');
    const tracked = await getMyOrder(t(), customer, packed.group, { locale: 'en', keyring });
    expect(tracked.orders[0]!.deliveryCode).toMatch(/^\d{4}$/);
    expect(
      (await getMyOrder(t(), customer, packed.group, { locale: 'en', keyring: null })).orders[0]!
        .deliveryCode,
    ).toBeNull();

    const staffCancel = await place();
    await routeAndAccept(staffCancel.code);
    await advanceShopOrder(t(), {
      shopIds: [sharma],
      code: staffCancel.code,
      expectedVersion: (await row(staffCancel.code)).version,
      step: { to: 'packed' },
      staffUserId: staff,
      keyring,
    });
    await expect(
      cancelOrderAsStaff(t(), {
        cityIds: [],
        code: staffCancel.code,
        reasonCode: 'customer_unreachable',
        expectedVersion: (await row(staffCancel.code)).version,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' }); // not in the caller's cities
    await cancelOrderAsStaff(t(), {
      cityIds: 'all',
      code: staffCancel.code,
      reasonCode: 'customer_unreachable',
      expectedVersion: (await row(staffCancel.code)).version,
      staffUserId: staff,
    });
    expect((await row(staffCancel.code)).status).toBe('cancelled');

    const rejected = await place();
    await rejectOrder(t(), {
      scope: { all: true },
      code: rejected.code,
      reasonCode: 'no_stock_nearby',
      message: 'No shop near you has this oil today. Nothing was charged.',
      expectedVersion: (await row(rejected.code)).version,
      staffUserId: staff,
    });
    const r = await getMyOrder(t(), customer, rejected.group, { locale: 'en', keyring });
    expect(r.orders[0]).toMatchObject({
      status: 'rejected',
      message: 'No shop near you has this oil today. Nothing was charged.',
    });
    expect((await listMyOrders(t(), customer)).orders.map((o) => o.code)[0]).toBe(rejected.group); // newest first
  });

  it('pages the order history with a cursor, newest first, without repeats', async () => {
    const all = (await listMyOrders(t(), customer, { limit: 50 })).orders.map((o) => o.code);
    expect(all.length).toBeGreaterThan(2);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof listMyOrders>> = await listMyOrders(t(), customer, {
        limit: 1,
        cursor,
      });
      seen.push(...page.orders.map((o) => o.code));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(all);
    await expect(listMyOrders(t(), customer, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });
});

describe('order group totals and COD status (review B7)', () => {
  it('a two-shop COD group shows what is still payable, and is cod_collected once the rest is delivered', async () => {
    const sku = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? slug;
    const lines = [
      { sku: sku('exide-xltz4a-2w-battery'), qty: 1 },
      { sku: sku('scooter-tubeless-tyre-90-90-12'), qty: 1 },
    ];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    expect(q.ok).toBe(true);
    const placed = await placeCodOrder(t(), {
      userId: customer,
      idempotencyKey: 'customer-orders-group-000001',
      address: {
        contactName: 'Ravi',
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
    expect(placed.orders).toHaveLength(2);
    const [first, second] = placed.orders;
    await cancelMyOrder(t(), {
      userId: customer,
      code: first!.code,
      reasonCode: 'changed_mind',
      expectedVersion: (await row(first!.code)).version,
    });
    const view = await getMyOrder(t(), customer, placed.code, { locale: 'en', keyring });
    expect(view.totalPaise).toBe(second!.totalPaise);
    expect(view.placedTotalPaise).toBe(placed.totalPaise);
    const listed = (await listMyOrders(t(), customer)).orders.find((o) => o.code === placed.code);
    expect(listed?.totalPaise).toBe(second!.totalPaise);

    // Deliver the remaining part: the group's COD is collected.
    const o = await row(second!.code);
    await routeOrder(t(), {
      scope: { all: true },
      code: second!.code,
      shopId: (await rankShopsForOrder(t(), o.id, 'en')).find((x) => x.eligible)!.shopId,
      expectedVersion: o.version,
      staffUserId: staff,
    });
    const routed = await row(second!.code);
    const [a] = await db
      .select()
      .from(s.orderAssignments)
      .where(sql`${s.orderAssignments.orderId} = ${routed.id} and ${s.orderAssignments.status} = 'offered'`);
    await acceptShopOffer(t(), { shopIds: [a!.shopId], assignmentId: a!.id, staffUserId: staff });
    for (const step of [
      { to: 'packed' },
      { to: 'shipped', mode: 'own' },
      { to: 'out_for_delivery' },
    ] as const)
      await advanceShopOrder(t(), {
        shopIds: [a!.shopId],
        code: second!.code,
        expectedVersion: (await row(second!.code)).version,
        step,
        staffUserId: staff,
        keyring,
      });
    await overrideOrderDelivery(t(), {
      scope: { all: true },
      code: second!.code,
      reason: 'Customer paid cash at the door',
      expectedVersion: (await row(second!.code)).version,
      staffUserId: staff,
    });
    const [g] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, placed.code));
    expect(g!.paymentStatus).toBe('cod_collected');
    expect((await getMyOrder(t(), customer, placed.code, { locale: 'en', keyring })).paymentStatus).toBe(
      'cod_collected',
    );
  });
});
