/**
 * MechDost Coins on the real API (spec 20 acceptance tests; Q24 rules answered 2026-11-13): redemption inside the
 * order transaction (cap, whole coins, split across sub-orders, never a negative balance), coins restored once when
 * a part is cancelled or rejected, rewards earned on delivery and paid after the unlock days, expiry of unused
 * coins (first-expiring used first), staff adjustments with a reason code and a version check, and the customer's
 * own balance and history only. Runs on the Raipur demo catalogue.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  adjustCoins,
  adminCoinAccount,
  coinActivity,
  coinBalance,
  earnCoins,
  expireDueCoins,
  myCoinLedger,
  myCoins,
  placeCodOrder,
  placeOrder,
  quoteCheckout,
  releaseDueCoinRewards,
  transitionOrder,
  type ShippingAddress,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let ravi = '';
let staff = '';
let other = '';
let n = 0;

const OIL = 'CAS-ACT4T-0900'; // ₹440, first shop
const sku = (slug: string) => fixture.products.find((p) => p.slug === slug)?.sku ?? slug;
const TYRE = () => sku('scooter-tubeless-tyre-90-90-12'); // second shop
const address = (): ShippingAddress => ({
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  line2: null,
  landmark: null,
  pincode: '492004',
});
const key = () => `coins-key-${String((n += 1)).padStart(8, '0')}`;
const later = new Date('2030-01-01T00:00:00Z');

async function setSetting(k: string, value: number) {
  await db
    .insert(s.settings)
    .values({ key: k, value, cityId: null })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value } });
}

async function grant(userId: string, coins: number) {
  await earnCoins(t(), {
    userId,
    coins,
    reason: 'Test coins',
    idemKey: `earn:test:${key()}`,
    expiresAt: later,
  });
}

async function place(
  lines: { sku: string; qty: number }[],
  coins: number,
  opts: { method?: 'cod' | 'online'; userId?: string; discount?: number } = {},
) {
  const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
  const base = opts.method === 'online' ? q.onlineTotalPaise : q.totalPaise;
  return placeOrder(t(), {
    method: opts.method ?? 'cod',
    userId: opts.userId ?? ravi,
    idempotencyKey: key(),
    address: address(),
    lines,
    expectedTotalPaise: base - (opts.discount ?? coins * 100),
    note: null,
    locale: 'en',
    coins,
  });
}

async function groupOf(code: string) {
  const [g] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, code));
  if (!g) throw new Error('group');
  const subs = await db.select().from(s.orders).where(eq(s.orders.groupId, g.id)).orderBy(s.orders.subNo);
  return { g, subs };
}

/** Walk a sub-order to delivered through the state machine (system/shop actors). */
async function deliver(orderId: string) {
  const [shop] = await db.select({ id: s.shops.id }).from(s.shops).limit(1);
  const step = async (from: string, to: string, actor: 'system' | 'shop', patch = {}) => {
    const [o] = await db.select({ version: s.orders.version }).from(s.orders).where(eq(s.orders.id, orderId));
    await db.transaction((tx) =>
      transitionOrder(tx as unknown as Tx, {
        orderId,
        from: from as never,
        to: to as never,
        expectedVersion: o!.version,
        actor: { type: actor, userId: null },
        patch,
      }),
    );
  };
  await step('placed', 'awaiting_shop', 'system');
  await step('awaiting_shop', 'confirmed', 'shop', { shopId: shop!.id, confirmedAt: new Date() });
  await step('confirmed', 'packed', 'shop');
  await step('packed', 'shipped', 'shop');
  await step('shipped', 'delivered', 'system', { deliveredAt: new Date() });
}

async function cancel(orderId: string, to: 'cancelled' | 'rejected' = 'cancelled') {
  const [o] = await db
    .select({ version: s.orders.version, status: s.orders.status })
    .from(s.orders)
    .where(eq(s.orders.id, orderId));
  await db.transaction((tx) =>
    transitionOrder(tx as unknown as Tx, {
      orderId,
      from: o!.status as never,
      to,
      expectedVersion: o!.version,
      actor: { type: 'admin', userId: staff },
      patch:
        to === 'cancelled'
          ? { statusReasonCode: 'other' }
          : { statusReasonCode: 'other', customerMessage: 'Sorry, we could not deliver this part.' },
    }),
  );
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  const users = await db
    .insert(s.users)
    .values([
      { firebaseUid: 'fb-coins-ravi' },
      { firebaseUid: 'fb-coins-staff' },
      { firebaseUid: 'fb-coins-asha' },
    ])
    .returning();
  [ravi, staff, other] = users.map((u) => u.id) as [string, string, string];
});

afterAll(async () => {
  await client.close();
});

describe('redeeming coins at checkout (spec 20)', () => {
  it('takes a whole-coin discount from the products only, split across the sub-orders, in one transaction', async () => {
    await grant(ravi, 500);
    const lines = [
      { sku: OIL, qty: 2 },
      { sku: TYRE(), qty: 1 },
    ];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const max = Math.floor(q.subtotalPaise / 10 / 100); // 10% of products, ₹1 a coin
    const placed = await place(lines, max);
    expect(placed).toMatchObject({ coinsRedeemed: max, coinDiscountPaise: max * 100 });
    expect(placed.totalPaise).toBe(q.totalPaise - max * 100);
    const { g, subs } = await groupOf(placed.code);
    expect(g).toMatchObject({ coinsRedeemed: max, coinDiscountPaise: max * 100, discountPaise: max * 100 });
    expect(subs).toHaveLength(2);
    expect(subs.reduce((a, o) => a + o.coinsRedeemed, 0)).toBe(max);
    expect(subs.reduce((a, o) => a + o.totalPaise, 0)).toBe(g.totalPaise);
    for (const o of subs) {
      expect(o.coinDiscountPaise).toBe(o.coinsRedeemed * 100);
      expect(o.discountPaise).toBe(o.coinDiscountPaise);
    }
    expect(await coinBalance(t(), ravi)).toBe(500 - max);
    const ledger = await db.select().from(s.coinLedger).where(eq(s.coinLedger.orderGroupId, g.id));
    expect(ledger).toEqual([
      expect.objectContaining({ kind: 'redeem', delta: -max, reasonCode: 'order_redeem' }),
    ]);
  });

  it('refuses more coins than the cap or the balance (COINS_CHANGED) and a total that ignores them', async () => {
    const lines = [{ sku: OIL, qty: 1 }]; // ₹440 → at most 44 coins
    await expect(place(lines, 45)).rejects.toMatchObject({ code: 'COINS_CHANGED' });
    await expect(place(lines, 10, { discount: 0 })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    await expect(place(lines, 5, { userId: other })).rejects.toMatchObject({ code: 'COINS_CHANGED' });
    // Fewer than the most allowed is fine.
    const placed = await place(lines, 10);
    expect(placed.coinsRedeemed).toBe(10);
  });

  it('online payment asks only for what is left after the coins', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const placed = await place(lines, 20, { method: 'online' });
    expect(placed.totalPaise).toBe(q.onlineTotalPaise - 2_000);
  });

  it('a retry with the same key returns the same order and spends the coins once', async () => {
    const lines = [{ sku: OIL, qty: 1 }];
    const q = await quoteCheckout(t(), { pincode: '492004', lines, locale: 'en' });
    const before = await coinBalance(t(), ravi);
    const input = {
      userId: ravi,
      idempotencyKey: key(),
      address: address(),
      lines,
      expectedTotalPaise: q.totalPaise - 1_500,
      note: null,
      locale: 'en' as const,
      coins: 15,
    };
    const first = await placeCodOrder(t(), input);
    const again = await placeCodOrder(t(), input);
    expect(again).toMatchObject({ code: first.code, replayed: true, coinsRedeemed: 15 });
    expect(await coinBalance(t(), ravi)).toBe(before - 15);
    // Same key, other coins: a different request.
    await expect(placeCodOrder(t(), { ...input, coins: 14 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
  });

  it('two checkouts racing for the same coins: one wins, the balance never goes negative', async () => {
    await grant(other, 40);
    const lines = [{ sku: OIL, qty: 1 }];
    const results = await Promise.allSettled([
      place(lines, 40, { userId: other }),
      place(lines, 40, { userId: other }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    const code = (refused?.reason as { code?: string } | undefined)?.code ?? '';
    expect(['COINS_CHANGED', 'INSUFFICIENT_COINS']).toContain(code);
    expect(await coinBalance(t(), other)).toBe(0);
    // No half-placed order: exactly one order for this customer.
    expect(await db.$count(s.orderGroups, eq(s.orderGroups.userId, other))).toBe(1);
  });
});

describe('coins come back when an order is cancelled or rejected (as coins, never money)', () => {
  it('a cancelled part returns its own share once; rejecting the rest returns the remainder', async () => {
    const before = await coinBalance(t(), ravi);
    const lines = [
      { sku: OIL, qty: 2 },
      { sku: TYRE(), qty: 1 },
    ];
    const placed = await place(lines, 30);
    const { g, subs } = await groupOf(placed.code);
    const [a, b] = subs as [(typeof subs)[number], (typeof subs)[number]];
    await cancel(a.id);
    expect(await coinBalance(t(), ravi)).toBe(before - 30 + a.coinsRedeemed);
    await cancel(b.id, 'rejected');
    expect(await coinBalance(t(), ravi)).toBe(before);
    const rows = await db
      .select()
      .from(s.coinLedger)
      .where(and(eq(s.coinLedger.orderGroupId, g.id), eq(s.coinLedger.kind, 'restore')));
    expect(rows.map((r) => r.delta).sort()).toEqual([a.coinsRedeemed, b.coinsRedeemed].sort());
    expect(rows.every((r) => r.reasonCode === 'order_cancelled' && r.expiresAt !== null)).toBe(true);
    // The group still records what was used; nothing is refunded as money for coins.
    const [after] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.id, g.id));
    expect(after?.coinsRedeemed).toBe(30);
  });
});

describe('earning (Q24): rewards on delivery, usable after the unlock days', () => {
  beforeEach(async () => {
    await setSetting('coins.earn_order_bp', 0);
    await setSetting('coins.first_order_bonus', 0);
  });

  it('earns nothing while the admin has set no reward (all rewards default to 0)', async () => {
    const placed = await place([{ sku: OIL, qty: 1 }], 0);
    const { subs } = await groupOf(placed.code);
    await deliver(subs[0]!.id);
    expect(await db.$count(s.coinRewards, eq(s.coinRewards.orderId, subs[0]!.id))).toBe(0);
  });

  it('a delivered order earns its share plus the first-order bonus once; credited only after the wait', async () => {
    await setSetting('coins.earn_order_bp', 500); // 5%
    await setSetting('coins.first_order_bonus', 50);
    await setSetting('coins.unlock_days', 8);
    const fresh = (await db.insert(s.users).values({ firebaseUid: 'fb-coins-new' }).returning())[0]!.id;
    const lines = [{ sku: OIL, qty: 2 }]; // ₹880 → 5% = ₹44 → 44 coins
    const first = await place(lines, 0, { userId: fresh });
    const second = await place(lines, 0, { userId: fresh });
    const a = (await groupOf(first.code)).subs[0]!;
    const b = (await groupOf(second.code)).subs[0]!;
    await deliver(a.id);
    await deliver(b.id);
    const rewards = await db.select().from(s.coinRewards).where(eq(s.coinRewards.userId, fresh));
    // 5% of what each order's products cost, whole coins (the second order may be priced by another shop).
    const share = (o: typeof a) => Math.floor(((o.subtotalPaise - o.discountPaise) * 0.05) / 100);
    expect(share(a)).toBe(44);
    expect(rewards.map((r) => [r.source, r.orderId, r.coins, r.status]).sort()).toEqual(
      [
        ['first_order', a.id, 50, 'pending'],
        ['order', a.id, share(a), 'pending'],
        ['order', b.id, share(b), 'pending'],
      ].sort(),
    );
    const total = 50 + share(a) + share(b);
    const days = (rewards[0]!.availableAt.getTime() - rewards[0]!.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(8);
    // Not yet: nothing credited.
    await releaseDueCoinRewards(t());
    expect(await coinBalance(t(), fresh)).toBe(0);
    expect((await myCoins(t(), fresh)).pendingCoins).toBe(total);
    // The wait is over (moved back in time): credited once, even if the job runs twice.
    await db
      .update(s.coinRewards)
      .set({ availableAt: sql`now() - interval '1 minute'` })
      .where(eq(s.coinRewards.userId, fresh));
    const run = await releaseDueCoinRewards(t());
    expect(run.credited).toBeGreaterThanOrEqual(3);
    await releaseDueCoinRewards(t());
    expect(await coinBalance(t(), fresh)).toBe(total);
    const earned = await db
      .select()
      .from(s.coinLedger)
      .where(and(eq(s.coinLedger.userId, fresh), eq(s.coinLedger.kind, 'earn')));
    expect(earned).toHaveLength(3);
    expect(earned.every((e) => e.expiresAt !== null && e.idemKey.startsWith('reward:'))).toBe(true);
    const credited = await db.select().from(s.coinRewards).where(eq(s.coinRewards.userId, fresh));
    expect(credited.every((r) => r.status === 'credited' && r.ledgerId !== null)).toBe(true);
  });
});

describe('expiry: unused coins lapse after the expiry days (first-expiring used first)', () => {
  it('expires only what is left of lapsed lots, once', async () => {
    const asha = (await db.insert(s.users).values({ firebaseUid: 'fb-coins-expiry' }).returning())[0]!.id;
    await earnCoins(t(), {
      userId: asha,
      coins: 100,
      reason: 'Old coins',
      idemKey: `earn:old:${key()}`,
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    await earnCoins(t(), {
      userId: asha,
      coins: 30,
      reason: 'New coins',
      idemKey: `earn:new:${key()}`,
      expiresAt: later,
    });
    // 40 of the old lot were used before it lapsed.
    await place([{ sku: OIL, qty: 1 }], 40, { userId: asha });
    const run = await expireDueCoins(t());
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect(await coinBalance(t(), asha)).toBe(30);
    await expireDueCoins(t());
    expect(await coinBalance(t(), asha)).toBe(30);
    const rows = await db
      .select()
      .from(s.coinLedger)
      .where(and(eq(s.coinLedger.userId, asha), eq(s.coinLedger.kind, 'expire')));
    expect(rows.map((r) => [r.delta, r.reasonCode])).toEqual([[-60, 'expired']]);
  });
});

describe('staff adjustments (coins:adjust)', () => {
  it('needs a reason code, refuses a stale version and overdrawing, replays by key, is audited', async () => {
    const acct = await adminCoinAccount(t(), ravi);
    const input = {
      userId: ravi,
      delta: 25,
      reasonCode: 'goodwill' as const,
      note: 'Late delivery',
      idemKey: `adjust:${key()}`,
      staffUserId: staff,
      expectedVersion: acct.version,
    };
    const entry = await adjustCoins(t(), input);
    expect(entry.balanceAfter).toBe(acct.balance + 25);
    // Retried request: same entry, no second credit, one audit row.
    expect((await adjustCoins(t(), input)).id).toBe(entry.id);
    expect(await coinBalance(t(), ravi)).toBe(acct.balance + 25);
    expect(
      await db.$count(
        s.auditLog,
        and(eq(s.auditLog.action, 'coins.adjusted'), eq(s.auditLog.entityId, entry.id)),
      ),
    ).toBe(1);
    // A new adjustment from the old screen (old version) is refused.
    await expect(adjustCoins(t(), { ...input, idemKey: `adjust:${key()}` })).rejects.toMatchObject({
      code: 'STALE_COINS',
    });
    const now = await adminCoinAccount(t(), ravi);
    await expect(
      adjustCoins(t(), {
        ...input,
        delta: -(now.balance + 1),
        reasonCode: 'correction',
        idemKey: `adjust:${key()}`,
        expectedVersion: now.version,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    const [row] = await db.select().from(s.coinLedger).where(eq(s.coinLedger.id, entry.id));
    expect(row).toMatchObject({ kind: 'adjust', reasonCode: 'goodwill', createdBy: staff });
    expect(row?.expiresAt).not.toBeNull();
  });

  it('an unknown customer is 404', async () => {
    await expect(adminCoinAccount(t(), '01900000-0000-7000-8000-000000000000')).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });
});

describe('a customer sees only their own coins', () => {
  it('balance, pending, rules and history are the caller’s own; history pages by cursor', async () => {
    const mine = await myCoins(t(), ravi);
    expect(mine.balance).toBe(await coinBalance(t(), ravi));
    expect(mine.rules).toMatchObject({
      coinValuePaise: 100,
      maxRedeemBp: 1_000,
      unlockDays: 8,
      expiryDays: 180,
    });
    const page1 = await myCoinLedger(t(), ravi, { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await myCoinLedger(t(), ravi, { limit: 2, cursor: page1.nextCursor });
    expect(page2.entries[0]?.id).not.toBe(page1.entries[1]?.id);
    const all = await myCoinLedger(t(), ravi, { limit: 50 });
    const ids = new Set(
      (await db.select({ id: s.coinLedger.id }).from(s.coinLedger).where(eq(s.coinLedger.userId, ravi))).map(
        (r) => r.id,
      ),
    );
    expect(all.entries.every((e) => ids.has(e.id))).toBe(true);
    // Order codes, not ids, on the customer's history.
    expect(all.entries.some((e) => e.kind === 'redeem' && (e.orderCode ?? '').startsWith('MD-RPR-'))).toBe(
      true,
    );
    const activity = await coinActivity(t(), { limit: 5 });
    expect(activity.entries.length).toBe(5);
    expect(activity.entries[0]).toHaveProperty('userId');
  });
});
