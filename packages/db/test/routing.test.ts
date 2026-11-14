/**
 * Admin routing (spec 04 acceptance tests): city-scoped FIFO queue; shops ranked and filtered (stock, distance,
 * never a shop that already declined/expired); routing moves the reservations; the timer job expires offers
 * (twice is safe) and the order comes back for rerouting; reject needs a reason code + message and frees stock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { shopOpenState, type ShopHours } from '@mechdost/shared/shop-hours';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  expireDueAssignments,
  getRoutingOrder,
  listRoutingQueue,
  placeCodOrder,
  quoteCheckout,
  rejectOrder,
  routeOrder,
  type CityScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900'; // stocked by Sharma Auto Parts (Pandri) and Gupta Lubes & Spares (Tatibandh)

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let customer = '';
let staff = '';
let raipur: CityScope = { all: false, cityIds: [] };
const shopId: Record<string, string> = {};

/** Open around the clock: the routing tests below do not depend on the time they run at. */
const ALWAYS: ShopHours = { open: '00:00', close: '24:00', days: [0, 1, 2, 3, 4, 5, 6] };
const istWeekday = (d: Date) => new Date(d.getTime() + 330 * 60_000).getUTCDay();
/**
 * Closed today and tomorrow (IST): open only on the weekday three days ahead. The next opening is the same instant
 * even if IST midnight passes during the test (code review 2026-11-14: no dependence on the midnight instant).
 */
const CLOSED_FOR_DAYS: ShopHours = {
  open: '09:00',
  close: '21:00',
  days: [(istWeekday(new Date()) + 3) % 7],
};
const closedToday = (): ShopHours => CLOSED_FOR_DAYS;
const shopOpenStateAt = (h: ShopHours) => {
  const st = shopOpenState(h, new Date());
  if (st.open) throw new Error('expected closed');
  return st.opensAt;
};

async function place(key: string) {
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: key,
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
  return placed.orders[0]!.code;
}

const reservedAt = async (name: string) =>
  num(
    (
      await db.execute(sql`select coalesce(sum(si.reserved), 0)::int as r from shop_inventory si
        join product_variants v on v.id = si.variant_id where v.sku = ${OIL} and si.shop_id = ${shopId[name]!}`)
    ).rows[0],
  );
const num = (row: unknown) => Number((row as { r: unknown }).r);
const version = async (code: string) =>
  (await db.select({ v: s.orders.version }).from(s.orders).where(eq(s.orders.code, code)))[0]!.v;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-routing-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-routing-staff' }).returning())[0]!.id;
  // Admin city prices at MRP (Q26): every shop is paid at or below what the customer pays, so these tests exercise
  // routing itself (a shop paid more than the customer pays is never offered; admin-price-resolution.test.ts).
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${staff} from product_variants v cross join cities c where c.code = 'RPR'`);
  const [city] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
  raipur = { all: false, cityIds: [city!.id] };
  for (const shop of await db.select().from(s.shops)) shopId[shop.name] = shop.id;
  await db.update(s.shops).set({ hours: ALWAYS });
});

afterAll(async () => {
  await client.close();
});

describe('routing', () => {
  it('queues placed orders per city and ranks only shops that can supply them', async () => {
    const code = await place('routing-key-000000001');
    const queue = await listRoutingQueue(t(), raipur, { view: 'needs_routing', locale: 'en' });
    expect(queue.items.map((i) => i.code)).toEqual([code]);
    expect(
      (await listRoutingQueue(t(), { all: false, cityIds: [] }, { view: 'needs_routing', locale: 'en' }))
        .items,
    ).toEqual([]);
    await expect(getRoutingOrder(t(), { all: false, cityIds: [] }, code, 'en')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const view = await getRoutingOrder(t(), raipur, code, 'hi');
    expect(view.shops[0]).toMatchObject({
      name: 'शर्मा ऑटो पार्ट्स',
      eligible: true,
      stockedItems: 1,
      acceptanceRate: null,
    });
    expect(view.shops.filter((x) => x.eligible).map((x) => x.shopId)).toEqual([
      shopId['Sharma Auto Parts'],
      shopId['Gupta Lubes & Spares'],
    ]);
    expect(view.shops.find((x) => x.shopId === shopId['Chhattisgarh Tyre House'])).toMatchObject({
      eligible: false,
      stockedItems: 0,
    });
  });

  it('routing moves the reservation; the timer expires it; the same shop is never offered again', async () => {
    const code = (await listRoutingQueue(t(), raipur, { view: 'needs_routing', locale: 'en' })).items[0]!
      .code;
    expect(await reservedAt('Sharma Auto Parts')).toBe(2);
    await expect(
      routeOrder(t(), {
        scope: raipur,
        code,
        shopId: shopId['Chhattisgarh Tyre House']!,
        expectedVersion: await version(code),
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SHOP_NOT_ELIGIBLE' });
    await expect(
      routeOrder(t(), {
        scope: raipur,
        code,
        shopId: shopId['Gupta Lubes & Spares']!,
        expectedVersion: 99,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'STALE_ORDER' });

    const routed = await routeOrder(t(), {
      scope: raipur,
      code,
      shopId: shopId['Gupta Lubes & Spares']!,
      expectedVersion: await version(code),
      staffUserId: staff,
    });
    expect(routed.expiresAt).not.toBeNull();
    expect([await reservedAt('Sharma Auto Parts'), await reservedAt('Gupta Lubes & Spares')]).toEqual([0, 2]);
    const awaiting = await listRoutingQueue(t(), raipur, { view: 'awaiting_shop', locale: 'en' });
    expect(awaiting.items[0]).toMatchObject({
      code,
      status: 'awaiting_shop',
      offer: { shop: 'Gupta Lubes & Spares' },
    });

    await db
      .update(s.orderAssignments)
      .set({ offeredAt: sql`now() - interval '20 minutes'`, expiresAt: sql`now() - interval '1 second'` });
    expect(await expireDueAssignments(t())).toEqual({ expired: 1, failed: [] });
    expect(await expireDueAssignments(t())).toEqual({ expired: 0, failed: [] }); // twice is safe
    const back = await getRoutingOrder(t(), raipur, code, 'en');
    expect(back.status).toBe('needs_rerouting');
    expect(back.history.map((h) => h.status)).toEqual(['expired']);
    expect(back.shops.find((x) => x.shopId === shopId['Gupta Lubes & Spares'])).toMatchObject({
      triedBefore: true,
      eligible: false,
    });
    await expect(
      routeOrder(t(), {
        scope: raipur,
        code,
        shopId: shopId['Gupta Lubes & Spares']!,
        expectedVersion: back.version,
        staffUserId: staff,
      }),
    ).rejects.toMatchObject({ code: 'SHOP_NOT_ELIGIBLE' });
    await routeOrder(t(), {
      scope: raipur,
      code,
      shopId: shopId['Sharma Auto Parts']!,
      expectedVersion: back.version,
      staffUserId: staff,
    });
    expect([await reservedAt('Sharma Auto Parts'), await reservedAt('Gupta Lubes & Spares')]).toEqual([2, 0]);
    expect(await db.$count(s.auditLog, sql`${s.auditLog.action} in ('order.routed', 'order.rerouted')`)).toBe(
      2,
    );
  });

  it('one drifted offer never stops the timer for the others (code review 2026-11-03)', async () => {
    const route = async (key: string, shop: string) => {
      const code = await place(key);
      const { assignmentId } = await routeOrder(t(), {
        scope: raipur,
        code,
        shopId: shopId[shop]!,
        expectedVersion: await version(code),
        staffUserId: staff,
      });
      return { code, assignmentId };
    };
    const good = await route('routing-key-000000010', 'Gupta Lubes & Spares');
    const drifted = await route('routing-key-000000011', 'Sharma Auto Parts');
    // Data drift: the order moved on while its offer stayed `offered` (e.g. a manual fix). It sorts first.
    await db.update(s.orders).set({ status: 'needs_rerouting' }).where(eq(s.orders.code, drifted.code));
    await db
      .update(s.orderAssignments)
      .set({ offeredAt: sql`now() - interval '30 minutes'`, expiresAt: sql`now() - interval '10 minutes'` })
      .where(eq(s.orderAssignments.id, drifted.assignmentId));
    await db
      .update(s.orderAssignments)
      .set({ offeredAt: sql`now() - interval '20 minutes'`, expiresAt: sql`now() - interval '1 second'` })
      .where(eq(s.orderAssignments.id, good.assignmentId));

    expect(await expireDueAssignments(t())).toEqual({ expired: 1, failed: [] });
    const status = async (id: string) =>
      (await db.select().from(s.orderAssignments).where(eq(s.orderAssignments.id, id)))[0]?.status;
    expect(await status(good.assignmentId)).toBe('expired');
    expect(await status(drifted.assignmentId)).toBe('withdrawn');
    expect((await getRoutingOrder(t(), raipur, good.code, 'en')).status).toBe('needs_rerouting');
  });

  it("a shop's own acceptance time wins over the city setting (admin shop profile, 2026-11-14)", async () => {
    const code = await place('routing-key-shop-timer');
    const gupta = shopId['Gupta Lubes & Spares']!;
    await db.update(s.shops).set({ acceptanceTimeoutMin: 7 }).where(eq(s.shops.id, gupta));
    const before = Date.now();
    const routed = await routeOrder(t(), {
      scope: raipur,
      code,
      shopId: gupta,
      expectedVersion: await version(code),
      staffUserId: staff,
    });
    await db.update(s.shops).set({ acceptanceTimeoutMin: null }).where(eq(s.shops.id, gupta));
    const minutes = (new Date(routed.expiresAt).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(6.5);
    expect(minutes).toBeLessThan(7.5);
  });

  it('suggests open shops first and says when a closed one opens (shop hours, user 2026-11-14)', async () => {
    const code = await place('routing-key-hours-rank');
    const o = await getRoutingOrder(t(), raipur, code, 'en');
    const eligible = o.shops.filter((x) => x.eligible).map((x) => x.shopId);
    expect(eligible.length).toBeGreaterThanOrEqual(2);
    const [nearest] = eligible;
    // Close the nearest eligible shop for today (open only tomorrow, IST): it drops behind the open one.
    await db.update(s.shops).set({ hours: closedToday() }).where(eq(s.shops.id, nearest!));
    const again = await getRoutingOrder(t(), raipur, code, 'en');
    const ranked = again.shops.filter((x) => x.eligible);
    expect(ranked[0]!.shopId).not.toBe(nearest);
    expect(ranked[0]).toMatchObject({ openNow: true, opensAt: null });
    const closed = again.shops.find((x) => x.shopId === nearest)!;
    expect(closed.openNow).toBe(false);
    expect(closed.opensAt).toBe(shopOpenStateAt(closedToday()).toISOString());
    await db.update(s.shops).set({ hours: ALWAYS }).where(eq(s.shops.id, nearest!));
  });

  it('routing to a closed shop is allowed: the offer waits until it opens + the grace setting', async () => {
    const code = await place('routing-key-hours-closed');
    const gupta = shopId['Gupta Lubes & Spares']!;
    await db.update(s.shops).set({ hours: closedToday() }).where(eq(s.shops.id, gupta));
    await db.insert(s.settings).values({ key: 'orders.closed_shop_grace_min', value: 90 });
    const routed = await routeOrder(t(), {
      scope: raipur,
      code,
      shopId: gupta,
      expectedVersion: await version(code),
      staffUserId: staff,
    });
    await db.delete(s.settings).where(eq(s.settings.key, 'orders.closed_shop_grace_min'));
    await db.update(s.shops).set({ hours: ALWAYS }).where(eq(s.shops.id, gupta));
    const opensAt = shopOpenStateAt(closedToday());
    expect(new Date(routed.expiresAt).toISOString()).toBe(
      new Date(opensAt.getTime() + 90 * 60_000).toISOString(),
    );
    // The stock hold lasts at least until the deadline (it would otherwise lapse overnight).
    const [hold] = await db
      .select({ expiresAt: s.reservations.expiresAt })
      .from(s.reservations)
      .innerJoin(s.orders, eq(s.orders.id, s.reservations.orderId))
      .where(and(eq(s.orders.code, code), eq(s.reservations.status, 'active')));
    expect(hold!.expiresAt.getTime()).toBeGreaterThanOrEqual(new Date(routed.expiresAt).getTime());
  });

  it('reject needs a reason code and a message, frees the stock, and only for unrouted orders', async () => {
    const code = await place('routing-key-000000002');
    const before = await reservedAt('Sharma Auto Parts');
    const base = { scope: raipur, code, reasonCode: 'no_stock_nearby' as const, staffUserId: staff };
    await expect(
      rejectOrder(t(), { ...base, message: 'Sorry', expectedVersion: await version(code) }),
    ).rejects.toMatchObject({
      code: 'REJECT_MESSAGE',
    });
    const done = await rejectOrder(t(), {
      ...base,
      message: 'We could not find this oil near you today. Nothing was charged.',
      expectedVersion: await version(code),
    });
    expect(done.status).toBe('rejected');
    expect(await reservedAt('Sharma Auto Parts')).toBe(before - 2);
    const [row] = await db.select().from(s.orders).where(eq(s.orders.code, code));
    expect(row).toMatchObject({ statusReasonCode: 'no_stock_nearby' });

    const [routed] = (await listRoutingQueue(t(), raipur, { view: 'awaiting_shop', locale: 'en' })).items;
    await expect(
      rejectOrder(t(), {
        ...base,
        code: routed!.code,
        message: 'Long enough message here.',
        expectedVersion: routed!.version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_REJECTABLE' });
  });
});

describe('kept holds (review B8)', () => {
  it('routing to the shop that already holds the stock renews the hold for the accept window', async () => {
    const code = await place('routing-kept-hold-000001');
    const [o] = await db.select().from(s.orders).where(eq(s.orders.code, code));
    // The checkout hold is about to lapse (placed a while ago).
    await db.execute(
      sql`update reservations set expires_at = now() + interval '1 minute' where order_id = ${o!.id}`,
    );
    const [held] = await db.select().from(s.reservations).where(eq(s.reservations.orderId, o!.id));
    const holder = (
      await db.select().from(s.shopInventory).where(eq(s.shopInventory.id, held!.inventoryId))
    )[0]!.shopId;
    await routeOrder(t(), {
      scope: raipur,
      code,
      shopId: holder,
      expectedVersion: await version(code),
      staffUserId: staff,
    });
    const [after] = await db
      .select()
      .from(s.reservations)
      .where(sql`${s.reservations.orderId} = ${o!.id} and ${s.reservations.status} = 'active'`);
    expect(after!.id).toBe(held!.id); // the same hold was kept…
    expect(after!.expiresAt.getTime() - Date.now()).toBeGreaterThan(10 * 60_000); // …and renewed
  });

  it('shops with only a GST enrolment number, or a blocked listing, are never offered (design 2026-11-13)', async () => {
    const code = await place('routing-key-enrolled01');
    const offered = async () =>
      (await getRoutingOrder(t(), raipur, code, 'en')).shops.filter((x) => x.eligible).map((x) => x.shopId);
    expect(await offered()).toContain(shopId['Gupta Lubes & Spares']);
    await db
      .update(s.shops)
      .set({ gstStatus: 'enrolled' })
      .where(eq(s.shops.id, shopId['Gupta Lubes & Spares']!));
    expect(await offered()).not.toContain(shopId['Gupta Lubes & Spares']);
    await db
      .update(s.shops)
      .set({ gstStatus: 'registered' })
      .where(eq(s.shops.id, shopId['Gupta Lubes & Spares']!));
    await db
      .update(s.shopInventory)
      .set({ adminBlocked: true, blockedReasonCode: 'above_market' })
      .where(eq(s.shopInventory.shopId, shopId['Gupta Lubes & Spares']!));
    expect(await offered()).not.toContain(shopId['Gupta Lubes & Spares']);
    await db
      .update(s.shopInventory)
      .set({ adminBlocked: false, blockedReasonCode: null })
      .where(eq(s.shopInventory.shopId, shopId['Gupta Lubes & Spares']!));
  });
});
