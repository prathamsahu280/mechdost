/**
 * A shop gives up an order it accepted (spec 04 "Shop gives up an accepted order", user ruling 2026-11-15): before
 * packing only; the order goes back to admin to reroute (never auto-cancelled); the stock accept took returns to
 * the shop in the same transaction; the reason is a code; the customer's timeline does not show it; one winner
 * when it races a pack step or itself; the shop's score counts it.
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
  cancelOrderAsStaff,
  getRoutingOrder,
  giveUpShopOrder,
  listRoutingQueue,
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
const scope: CityScope = { all: true };
const shop: Record<string, string> = {};
const SHARMA = 'Sharma Auto Parts';
const GUPTA = 'Gupta Lubes & Spares';
let keyN = 0;

async function placeAndRoute(to: string) {
  const lines = [{ sku: OIL, qty: 2 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  keyN += 1;
  const placed = await placeCodOrder(t(), {
    userId: customer,
    idempotencyKey: `give-up-key-${String(keyN).padStart(6, '0')}`,
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
  const o = await orderRow(code);
  const r = await routeOrder(t(), {
    scope,
    code,
    shopId: shop[to]!,
    expectedVersion: o.version,
    staffUserId: staff,
  });
  return { code, assignmentId: r.assignmentId };
}
async function acceptedOrder(to = SHARMA) {
  const placed = await placeAndRoute(to);
  await acceptShopOffer(t(), {
    shopIds: [shop[to]!],
    assignmentId: placed.assignmentId,
    staffUserId: shopUser,
  });
  return placed;
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
const staffCancel = (code: string, version: number) =>
  cancelOrderAsStaff(t(), {
    cityIds: 'all',
    code,
    reasonCode: 'changed_mind',
    expectedVersion: version,
    staffUserId: staff,
  });
const giveUp = (
  code: string,
  version: number,
  extra: Partial<{ reasonCode: string; note: string | null; to: string }> = {},
) =>
  giveUpShopOrder(t(), {
    shopIds: [shop[extra.to ?? SHARMA]!],
    code,
    expectedVersion: version,
    reasonCode: (extra.reasonCode ?? 'out_of_stock') as 'out_of_stock',
    note: extra.note ?? null,
    staffUserId: shopUser,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  customer = (await db.insert(s.users).values({ firebaseUid: 'fb-giveup-customer' }).returning())[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-giveup-staff' }).returning())[0]!.id;
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${staff} from product_variants v cross join cities c where c.code = 'RPR'`);
  shopUser = (await db.insert(s.users).values({ firebaseUid: 'fb-giveup-shop' }).returning())[0]!.id;
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
});

afterAll(async () => {
  await client.close();
});

describe('giving up an accepted order', () => {
  it('goes back to admin, returns the stock, keeps one active assignment and can be rerouted to the same or another shop', async () => {
    const before = await stock(SHARMA);
    const { code } = await acceptedOrder();
    expect(await stock(SHARMA)).toEqual({ onHand: before.onHand - 2, reserved: before.reserved });
    const accepted = await orderRow(code);
    expect(accepted.status).toBe('confirmed');

    const r = await giveUp(code, accepted.version, { reasonCode: 'stock_damaged', note: 'Cartons wet' });
    expect(r.status).toBe('needs_rerouting');
    const row = await orderRow(code);
    expect(row).toMatchObject({ status: 'needs_rerouting', shopId: null, confirmedAt: null });
    // Exactly what accept took goes back; no hold is left active or committed.
    expect(await stock(SHARMA)).toEqual({ onHand: before.onHand, reserved: before.reserved });
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.orderId, row.id));
    expect(holds.every((h) => h.status === 'released')).toBe(true);
    const [a] = await db.select().from(s.orderAssignments).where(eq(s.orderAssignments.orderId, row.id));
    expect(a).toMatchObject({ status: 'given_up', giveUpReason: 'stock_damaged', giveUpNote: 'Cartons wet' });
    expect(a?.givenUpAt).not.toBeNull();

    // Admin sees it in the reroute queue with the reason and can offer it to the same shop again, or another.
    const queue = await listRoutingQueue(t(), scope, { view: 'needs_routing', locale: 'en' });
    expect(queue.items.find((i) => i.code === code)).toMatchObject({
      status: 'needs_rerouting',
      attempts: 1,
    });
    const view = await getRoutingOrder(t(), scope, code, 'en');
    expect(view.history[0]).toMatchObject({ status: 'given_up', giveUpReason: 'stock_damaged' });
    expect(view.shops.find((x) => x.shopId === shop[SHARMA])).toMatchObject({ gaveUpBefore: true });
    const again = await routeOrder(t(), {
      scope,
      code,
      shopId: shop[SHARMA]!,
      expectedVersion: row.version,
      staffUserId: staff,
    });
    expect(again.assignmentId).toBeTruthy();
    expect((await orderRow(code)).status).toBe('awaiting_shop');
    const active = await db
      .select()
      .from(s.orderAssignments)
      .where(
        sql`${s.orderAssignments.orderId} = ${row.id} and ${s.orderAssignments.status} in ('offered','accepted')`,
      );
    expect(active).toHaveLength(1);
  });

  it('the customer timeline does not show it, and staff still see it', async () => {
    const { code } = await acceptedOrder();
    await giveUp(code, (await orderRow(code)).version);
    const events = await db
      .select()
      .from(s.orderEvents)
      .where(sql`${s.orderEvents.orderId} = ${(await orderRow(code)).id}`);
    const back = events.find((e) => e.fromStatus === 'confirmed' && e.toStatus === 'needs_rerouting');
    expect(back).toMatchObject({ actorType: 'shop', visibleToCustomer: false });
    expect(events.find((e) => e.toStatus === 'confirmed')?.visibleToCustomer).toBe(true);
  });

  it('is refused once packed, for a foreign shop, with a made-up reason or an overlong note, and is audited', async () => {
    const { code } = await acceptedOrder();
    const v = (await orderRow(code)).version;
    await expect(giveUp(code, v, { to: GUPTA })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(giveUp(code, v, { reasonCode: 'nope' })).rejects.toMatchObject({ code: 'GIVE_UP_REASON' });
    await expect(giveUp(code, v, { note: 'x'.repeat(301) })).rejects.toMatchObject({ code: 'GIVE_UP_NOTE' });
    await advanceShopOrder(t(), {
      shopIds: [shop[SHARMA]!],
      code,
      expectedVersion: v,
      step: { to: 'packed' },
      staffUserId: shopUser,
      keyring,
    });
    await expect(giveUp(code, (await orderRow(code)).version)).rejects.toMatchObject({ code: 'WRONG_STEP' });
    expect((await orderRow(code)).status).toBe('packed');

    const ok = await acceptedOrder();
    await giveUp(ok.code, (await orderRow(ok.code)).version, { reasonCode: 'cannot_deliver' });
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(
        sql`${s.auditLog.action} = 'order.given_up_by_shop' and ${s.auditLog.entityId} = ${(await orderRow(ok.code)).id}`,
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ reasonCode: 'cannot_deliver' });
  });

  it('a stale version is a conflict and changes nothing', async () => {
    const { code } = await acceptedOrder();
    const v = (await orderRow(code)).version;
    await expect(giveUp(code, v - 1)).rejects.toMatchObject({ code: 'STALE_ORDER' });
    expect((await orderRow(code)).status).toBe('confirmed');
  });

  it('races: five give-ups → one wins; give-up vs pack → exactly one wins; give-up vs staff cancel → stock back once', async () => {
    const base = await stock(SHARMA);
    const a = await acceptedOrder();
    const va = (await orderRow(a.code)).version;
    const five = await Promise.allSettled(Array.from({ length: 5 }, () => giveUp(a.code, va)));
    expect(five.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const b = await acceptedOrder();
    const vb = (await orderRow(b.code)).version;
    const duel = await Promise.allSettled([
      giveUp(b.code, vb),
      advanceShopOrder(t(), {
        shopIds: [shop[SHARMA]!],
        code: b.code,
        expectedVersion: vb,
        step: { to: 'packed' },
        staffUserId: shopUser,
        keyring,
      }),
    ]);
    expect(duel.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(['needs_rerouting', 'packed']).toContain((await orderRow(b.code)).status);

    const c = await acceptedOrder();
    const vc = (await orderRow(c.code)).version;
    await Promise.allSettled([giveUp(c.code, vc), staffCancel(c.code, vc)]);
    const cOrder = await orderRow(c.code);
    expect(['needs_rerouting', 'cancelled']).toContain(cOrder.status);
    const holds = await db.select().from(s.reservations).where(eq(s.reservations.orderId, cOrder.id));
    expect(holds.every((h) => h.status === 'released')).toBe(true);

    // Cancel the rest so the shelf can be compared: whatever the outcome, no stock is created or lost.
    for (const code of [a.code, b.code, c.code]) {
      const o = await orderRow(code);
      if (o.status === 'needs_rerouting') await staffCancel(code, o.version);
    }
    const packed = (await orderRow(b.code)).status === 'packed' ? 2 : 0;
    expect(await stock(SHARMA)).toEqual({ onHand: base.onHand - packed, reserved: base.reserved });
  });

  it('shows in the shop history and counts against the shop (not as an acceptance)', async () => {
    const { code } = await acceptedOrder();
    await giveUp(code, (await orderRow(code)).version);
    const rows = await db
      .select()
      .from(s.orderAssignments)
      .where(eq(s.orderAssignments.shopId, shop[SHARMA]!));
    expect(rows.some((r) => r.status === 'given_up')).toBe(true);
    const done = await listShopOrders(t(), [shop[SHARMA]!], 'done');
    expect(done.items.find((i) => i.code === code)).toMatchObject({
      status: 'given_up',
      givenUpReason: 'out_of_stock',
    });
    // The customer's details are not shared for an order the shop no longer holds.
    expect(done.items.find((i) => i.code === code)?.address).toBeNull();
  });
});
