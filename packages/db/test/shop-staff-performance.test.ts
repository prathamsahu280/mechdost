/**
 * Shop staff performance and earnings (design 2026-11-16, spec 07): per person on a shop's team, what they accepted,
 * packed, handed over, delivered and gave up, their acceptance time and on-time share, and the shop's payout ledger in
 * integer paise on IST days. The owner sees the whole team and the ledger; a staff member only their own row; another
 * shop (or one the caller does not work at) is a 404. The work is attributed through the real order flow, so the
 * actor on the order timeline is what is under test.
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
  deliverShopOrder,
  events,
  deliveryCodeFor,
  getShopStaffPerformance,
  giveUpShopOrder,
  placeCodOrder,
  quoteCheckout,
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
const SHARMA = 'Sharma Auto Parts';
const GUPTA = 'Gupta Lubes & Spares';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const shop: Record<string, string> = {};
const u: Record<string, string> = {};
let keyN = 0;
const orders: Record<string, string> = {};

const orderRow = async (code: string) =>
  (await db.select().from(s.orders).where(eq(s.orders.code, code)))[0]!;

async function placeAndRoute(to: string) {
  const lines = [{ sku: OIL, qty: 1 }];
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  keyN += 1;
  const placed = await placeCodOrder(t(), {
    userId: u.customer!,
    idempotencyKey: `staff-perf-key-${String(keyN).padStart(6, '0')}`,
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
    scope: { all: true },
    code,
    shopId: shop[to]!,
    expectedVersion: o.version,
    staffUserId: u.admin!,
  });
  return { code, assignmentId: r.assignmentId };
}

const accept = (name: string, assignmentId: string, by: string) =>
  acceptShopOffer(t(), { shopIds: [shop[name]!], assignmentId, staffUserId: u[by]! });
const step = async (
  name: string,
  code: string,
  to: Parameters<typeof advanceShopOrder>[1]['step'],
  by: string,
) =>
  advanceShopOrder(t(), {
    shopIds: [shop[name]!],
    code,
    expectedVersion: (await orderRow(code)).version,
    step: to,
    staffUserId: u[by]!,
    keyring,
  });

/** IST calendar day (YYYY-MM-DD) of an instant. */
const istDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** Midnight IST of the day `back` days before today. */
const istMidnight = (back: number) => {
  const [y, m, d] = istDay(new Date()).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - back, 0, 0, 0) - 330 * 60_000);
};
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
let ledgerN = 0;
const ledger = (
  shopName: string,
  paise: number,
  kind: 'coin_discount' | 'coupon_discount',
  orderCode: string,
  at: Date,
) =>
  db.insert(s.shopPayoutEntries).values({
    shopId: shop[shopName]!,
    orderId: orders[orderCode]!,
    kind,
    amountPaise: paise,
    idemKey: `staff-perf-ledger-${String(++ledgerN)}`,
    createdAt: at,
  });

const view = (over: Partial<Parameters<typeof getShopStaffPerformance>[1]> = {}) =>
  getShopStaffPerformance(t(), {
    shopId: shop[SHARMA]!,
    ownedShopIds: [shop[SHARMA]!],
    workShopIds: [shop[SHARMA]!],
    userId: u.owner!,
    days: 30,
    ...over,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  for (const name of ['customer', 'admin', 'owner', 's1', 's2', 'guptaOwner'])
    u[name] = (
      await db
        .insert(s.users)
        .values({ firebaseUid: `fb-sp-${name}` })
        .returning()
    )[0]!.id;
  await db.execute(sql`insert into admin_prices (variant_id, city_id, selling_paise, updated_by)
    select v.id, c.id, v.mrp_paise, ${u.admin!} from product_variants v cross join cities c where c.code = 'RPR'`);
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
  await db.insert(s.shopUsers).values([
    { shopId: shop[SHARMA]!, userId: u.owner!, role: 'owner' },
    { shopId: shop[SHARMA]!, userId: u.s1!, role: 'staff' },
    { shopId: shop[SHARMA]!, userId: u.s2!, role: 'staff' },
    { shopId: shop[GUPTA]!, userId: u.guptaOwner!, role: 'owner' },
  ]);
  await db.insert(s.shopStaffInvites).values({
    shopId: shop[SHARMA]!,
    name: 'Anil Verma',
    phone: '+919811100011',
    status: 'used',
    createdBy: u.owner!,
    expiresAt: new Date(Date.now() + 86_400_000),
    usedAt: new Date(),
    usedBy: u.s1!,
  });

  // o1: accepted + packed by s1, handed over + delivered by s2. o2: accepted + packed by the owner (still with the shop).
  // o3: accepted by s1, given up by s1. o4: another shop's order, accepted by its owner.
  const o1 = await placeAndRoute(SHARMA);
  await accept(SHARMA, o1.assignmentId, 's1');
  await step(SHARMA, o1.code, { to: 'packed' }, 's1');
  await step(SHARMA, o1.code, { to: 'shipped', mode: 'own' }, 's2');
  await step(SHARMA, o1.code, { to: 'out_for_delivery' }, 's2');
  const o1row = await orderRow(o1.code);
  const [shipment] = await db.select().from(s.shipments).where(eq(s.shipments.orderId, o1row.id));
  const right = (await deliveryCodeFor(t(), keyring, shipment!.id))!;
  await deliverShopOrder(t(), {
    shopIds: [shop[SHARMA]!],
    code: o1.code,
    deliveryCode: right,
    expectedVersion: o1row.version,
    staffUserId: u.s2!,
    keyring,
  });
  const o2 = await placeAndRoute(SHARMA);
  await accept(SHARMA, o2.assignmentId, 'owner');
  await step(SHARMA, o2.code, { to: 'packed' }, 'owner');
  const o3 = await placeAndRoute(SHARMA);
  await accept(SHARMA, o3.assignmentId, 's1');
  await giveUpShopOrder(t(), {
    shopIds: [shop[SHARMA]!],
    code: o3.code,
    expectedVersion: (await orderRow(o3.code)).version,
    reasonCode: 'out_of_stock',
    note: null,
    staffUserId: u.s1!,
  });
  const o4 = await placeAndRoute(GUPTA);
  await accept(GUPTA, o4.assignmentId, 'guptaOwner');
  for (const [k, c] of Object.entries({ o1: o1.code, o2: o2.code, o3: o3.code, o4: o4.code }))
    orders[k] = (await orderRow(c)).id;

  // The ledger: o1 (delivered by s2) 5,000; o2 (not delivered) 2,000; an old one 40 days back 300; one beyond 90 days;
  // another shop's 700. The window edge entries: just inside and just outside the 30 IST days.
  await ledger(SHARMA, 5000, 'coin_discount', 'o1', new Date());
  await ledger(SHARMA, 2000, 'coupon_discount', 'o2', new Date());
  await ledger(SHARMA, 300, 'coin_discount', 'o1', ago(40));
  await ledger(SHARMA, 111, 'coin_discount', 'o1', ago(100));
  await ledger(GUPTA, 700, 'coin_discount', 'o4', new Date());
});

afterAll(async () => {
  await client.close();
});

describe('shop staff performance, owner view', () => {
  it('attributes each step to the person who did it, with the typed invite name', async () => {
    const r = await view();
    expect(r.scope).toBe('owner');
    const by = Object.fromEntries(r.members.map((m) => [m.userId, m]));
    expect(r.members).toHaveLength(3);
    expect(by[u.s1!]).toMatchObject({
      name: 'Anil Verma',
      role: 'staff',
      isYou: false,
      accepted: 2,
      packed: 1,
      handedOver: 0,
      delivered: 0,
      giveUps: 1,
      deliveredLedgerPaise: 0,
    });
    expect(by[u.s2!]).toMatchObject({
      accepted: 0,
      packed: 0,
      handedOver: 1,
      delivered: 1,
      giveUps: 0,
      deliveredLedgerPaise: 5000,
    });
    expect(by[u.owner!]).toMatchObject({ role: 'owner', isYou: true, accepted: 1, packed: 1, giveUps: 0 });
  });

  it('acceptance time and on-time share', async () => {
    const r = await view();
    const s1 = r.members.find((m) => m.userId === u.s1)!;
    // Accepted at once after the offer in this test: a median of whole seconds, not "no data".
    expect(s1.medianAcceptSeconds).not.toBeNull();
    // o1 was handed over in time, o3 was given up: one of two.
    expect(s1.onTimeBp).toBe(5000);
    // The owner's o2 is not handed over and its 24 h window has not run out: nothing to measure yet.
    expect(r.members.find((m) => m.userId === u.owner)?.onTimeBp).toBeNull();
    expect(r.onTimeHours).toBe(24);
  });

  it('shop totals count everyone, and never another shop', async () => {
    const r = await view();
    expect(r.shop).toMatchObject({ accepted: 3, packed: 2, handedOver: 1, delivered: 1, giveUps: 1 });
  });

  it('earnings are the payout ledger in integer paise: total, by kind, by IST day', async () => {
    const r = await view();
    expect(r.earnings?.totalPaise).toBe(7000);
    expect(r.earnings?.byKind).toEqual([
      { kind: 'coin_discount', paise: 5000, entries: 1 },
      { kind: 'coupon_discount', paise: 2000, entries: 1 },
    ]);
    expect(r.earnings?.byDay).toEqual([{ day: istDay(new Date()), paise: 7000 }]);
    const wide = await view({ days: 90 });
    expect(wide.earnings?.totalPaise).toBe(7300);
    expect(wide.earnings?.byDay.map((d) => d.paise)).toEqual([7000, 300]);
    expect(wide.earnings?.byDay.map((d) => d.day)).toEqual([istDay(new Date()), istDay(ago(40))]);
  });

  it('the window starts at midnight IST of its first day', async () => {
    const edge = istMidnight(29);
    await ledger(SHARMA, 10, 'coin_discount', 'o2', new Date(edge.getTime() + 60_000));
    await ledger(SHARMA, 1000, 'coin_discount', 'o2', new Date(edge.getTime() - 60_000));
    const r = await view();
    expect(r.from).toBe(istDay(edge));
    expect(r.earnings?.totalPaise).toBe(7010);
    expect((await view({ days: 90 })).earnings?.totalPaise).toBe(8310);
  });
});

describe('shop staff performance, staff view', () => {
  it('a staff member sees only their own row, their own ledger share and no shop money', async () => {
    const r = await view({ userId: u.s2!, ownedShopIds: [] });
    expect(r.scope).toBe('self');
    expect(r.members).toHaveLength(1);
    expect(r.members[0]).toMatchObject({
      userId: u.s2,
      isYou: true,
      delivered: 1,
      deliveredLedgerPaise: 5000,
    });
    expect(r.shop).toBeNull();
    expect(r.earnings).toBeNull();
    const other = await view({ userId: u.s1!, ownedShopIds: [] });
    expect(other.members.map((m) => m.userId)).toEqual([u.s1]);
    expect(other.members[0]?.deliveredLedgerPaise).toBe(0);
  });

  it('a person who works at another shop gets a 404 for this one, owner or not', async () => {
    await expect(
      view({ userId: u.guptaOwner!, ownedShopIds: [shop[GUPTA]!], workShopIds: [shop[GUPTA]!] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      view({ shopId: shop[GUPTA]!, userId: u.owner!, ownedShopIds: [shop[SHARMA]!] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(view({ shopId: '01890000-0000-7000-8000-000000000000' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('the other shop sees its own numbers only', async () => {
    const r = await view({
      shopId: shop[GUPTA]!,
      userId: u.guptaOwner!,
      ownedShopIds: [shop[GUPTA]!],
      workShopIds: [shop[GUPTA]!],
    });
    expect(r.members.map((m) => m.userId)).toEqual([u.guptaOwner]);
    expect(r.shop).toMatchObject({ accepted: 1, packed: 0 });
    expect(r.earnings?.totalPaise).toBe(700);
  });

  it('records one analytics event per view with the scope', async () => {
    const rows = await db.select().from(events).where(eq(events.event, 'shop_staff_performance_viewed'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => JSON.stringify(r.props).includes('"scope":"self"'))).toBe(true);
  });
});
