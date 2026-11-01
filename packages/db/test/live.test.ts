/**
 * Live updates outbox (decision 2026-11-01, docs/research/realtime-alternatives.md): pings are written by
 * triggers in the same transaction as the change, carry ids + versions only, are claimed once by parallel relays,
 * and go only to people Postgres says may see the entity.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { parseLivePing } from '@mechdost/shared/live';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  claimLiveBatch,
  grantRole,
  markLiveSent,
  offerOrderToShop,
  oldestPendingLiveMs,
  purgeSentLive,
  resolveLiveRecipients,
  setShopStanding,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
let seq = 0;

async function mkUser(uid: string) {
  return (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
}

async function newOrder() {
  seq += 1;
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const code = `MD-RPR-2026-RTDB${B32[Math.floor(seq / 32) % 32] ?? '0'}${B32[seq % 32] ?? '0'}`;
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: F.customer!,
      cityId: F.city!,
      paymentMethod: 'cod',
      paymentStatus: 'cod_pending',
      subtotalPaise: 50000,
      totalPaise: 50000,
      idempotencyKey: `live-idem-${seq}-xxxxxxxxxxxx`,
    })
    .returning();
  return (
    await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: 1,
        code: `${code}-1`,
        userId: F.customer!,
        cityId: F.city!,
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        pincode: '492001',
        subtotalPaise: 50000,
        totalPaise: 50000,
      })
      .returning()
  )[0]!;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const mkCity = async (code: string, slug: string) =>
    (
      await db
        .insert(s.cities)
        .values({
          stateId: state!.id,
          code,
          slug,
          name: slug,
          status: 'live',
          centroid: { lng: 81.64, lat: 21.227 },
        })
        .returning()
    )[0]!.id;
  F.city = await mkCity('RPR', 'raipur');
  F.otherCity = await mkCity('BLS', 'bilaspur');
  F.state = state!.id;
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: F.state,
    cityId: F.city,
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.customer = await mkUser('fb-live-customer');
  F.stranger = await mkUser('fb-live-stranger');
  F.shopUser = await mkUser('fb-live-shop');
  F.cityStaff = await mkUser('fb-live-city-staff');
  F.otherCityStaff = await mkUser('fb-live-other-staff');
  F.globalStaff = await mkUser('fb-live-global-staff');
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Live Shop',
      phone: '+919000000001',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: F.city,
      stateId: F.state,
      status: 'approved',
      location: { lng: 81.63, lat: 21.22 },
    })
    .returning();
  F.shop = shop!.id;
  await db.insert(s.shopUsers).values({ shopId: F.shop, userId: F.shopUser, role: 'owner' });
  await grantRole(t(), { userId: F.cityStaff, role: 'city_manager', cityId: F.city, grantedBy: null });
  await grantRole(t(), {
    userId: F.otherCityStaff,
    role: 'city_manager',
    cityId: F.otherCity,
    grantedBy: null,
  });
  await grantRole(t(), { userId: F.globalStaff, role: 'ops_manager', grantedBy: null });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  // Each test starts from an empty queue (setup rows are not under test).
  await db.execute(sql`delete from live_outbox`);
});

describe('live outbox (decision 2026-11-01)', () => {
  it('writes a thin ping in the same transaction as an order change', async () => {
    const order = await newOrder();
    const [row] = await claimLiveBatch(t());
    expect(row?.topic).toBe(`order:${order.id}`);
    expect(parseLivePing(row?.ping)).toEqual({
      e: 'order.status_changed',
      k: 'order',
      id: order.id,
      v: order.version,
      at: expect.any(String) as string,
    });
  });

  it('a rolled-back change leaves no ping', async () => {
    const order = await newOrder();
    await db.execute(sql`delete from live_outbox`);
    await expect(
      db.transaction(async (tx) => {
        await tx.update(s.orders).set({ pincode: '492001' }).where(eq(s.orders.id, order.id));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await claimLiveBatch(t())).toHaveLength(0);
  });

  it('versions grow with each change so clients can drop stale pings', async () => {
    const order = await newOrder();
    await db.update(s.orders).set({ pincode: '492001' }).where(eq(s.orders.id, order.id));
    await db.update(s.orders).set({ pincode: '492001' }).where(eq(s.orders.id, order.id));
    const versions = (await claimLiveBatch(t())).map((r) => r.ping.v);
    expect(versions).toEqual([order.version, order.version + 1, order.version + 2]);
  });

  it('an offer pings the shop, and standing changes ping the shop too', async () => {
    const order = await newOrder();
    await offerOrderToShop(t(), {
      orderId: order.id,
      shopId: F.shop!,
      expectedOrderVersion: order.version,
      timeoutMinutes: 15,
      actor: { type: 'admin' },
    });
    const [shop] = await db.select({ v: s.shops.version }).from(s.shops).where(eq(s.shops.id, F.shop!));
    await setShopStanding(t(), {
      shopId: F.shop!,
      to: 'paused',
      reason: 'Owner on leave this week',
      staffUserId: F.globalStaff!,
      expectedVersion: shop!.v,
    });
    const rows = await claimLiveBatch(t());
    expect(rows.map((r) => [r.topic.split(':')[0], r.ping.e])).toEqual(
      expect.arrayContaining([
        ['order', 'order.status_changed'],
        ['shop', 'assignment.changed'],
        ['shop', 'partner.status_changed'],
      ]),
    );
    // Restore for later tests.
    const [after] = await db.select({ v: s.shops.version }).from(s.shops).where(eq(s.shops.id, F.shop!));
    await setShopStanding(t(), {
      shopId: F.shop!,
      to: 'approved',
      reason: 'Owner is back now',
      staffUserId: F.globalStaff!,
      expectedVersion: after!.v,
    });
  });

  it('two relays never claim the same rows; a lapsed claim is retried', async () => {
    await newOrder();
    await newOrder();
    await newOrder();
    const [a, b] = await Promise.all([claimLiveBatch(t(), { limit: 2 }), claimLiveBatch(t(), { limit: 2 })]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    // Nothing more to claim while leases are fresh.
    expect(await claimLiveBatch(t())).toHaveLength(0);
    // A relay that crashed before marking sent: its lease lapses and the rows come back.
    await db.execute(sql`update live_outbox set claimed_at = now() - interval '1 minute'`);
    expect(await claimLiveBatch(t(), { leaseSeconds: 30 })).toHaveLength(3);
  });

  it('marks sent, reports lag and purges after 24 h', async () => {
    await newOrder();
    expect(await oldestPendingLiveMs(t())).toBeGreaterThanOrEqual(0);
    const rows = await claimLiveBatch(t());
    await markLiveSent(
      t(),
      rows.map((r) => r.id),
    );
    expect(await claimLiveBatch(t(), { leaseSeconds: 5 })).toHaveLength(0);
    expect(await oldestPendingLiveMs(t())).toBe(0);
    expect(await purgeSentLive(t())).toBe(0);
    await db.execute(sql`update live_outbox set sent_at = now() - interval '25 hours'`);
    expect(await purgeSentLive(t())).toBe(rows.length);
  });

  it('the database refuses pings that are not thin', async () => {
    await expect(
      db.execute(
        sql`insert into live_outbox (topic, kind, entity_id, entity_version, event) values ('order:+919876543210', 'order', gen_random_uuid(), 1, 'order.status_changed')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into live_outbox (topic, kind, entity_id, entity_version, event) values (${`order:${F.shop!}`}, 'order', gen_random_uuid(), 1, 'order status changed')`,
      ),
    ).rejects.toThrow();
  });
});

describe('live recipients come from Postgres (role-leak suite)', () => {
  it('an order reaches its customer, the offered shop and that city’s staff only', async () => {
    const order = await newOrder();
    const before = (await resolveLiveRecipients(t(), `order:${order.id}`)).map((r) => r.firebaseUid);
    expect(before.sort()).toEqual(['fb-live-city-staff', 'fb-live-customer', 'fb-live-global-staff']);
    await offerOrderToShop(t(), {
      orderId: order.id,
      shopId: F.shop!,
      expectedOrderVersion: order.version,
      timeoutMinutes: 15,
      actor: { type: 'admin' },
    });
    const after = (await resolveLiveRecipients(t(), `order:${order.id}`)).map((r) => r.firebaseUid);
    expect(after).toContain('fb-live-shop');
    expect(after).not.toContain('fb-live-stranger');
    expect(after).not.toContain('fb-live-other-staff');
  });

  it('a shop topic reaches its users and its city staff; unknown topics reach nobody', async () => {
    const shop = (await resolveLiveRecipients(t(), `shop:${F.shop!}`)).map((r) => r.firebaseUid).sort();
    expect(shop).toEqual(['fb-live-city-staff', 'fb-live-global-staff', 'fb-live-shop']);
    expect(await resolveLiveRecipients(t(), 'shop:not-a-uuid')).toEqual([]);
    expect(await resolveLiveRecipients(t(), `quote:${F.shop!}`)).toEqual([]);
  });

  it('deactivated users receive nothing', async () => {
    await db.update(s.users).set({ status: 'deactivated' }).where(eq(s.users.id, F.shopUser!));
    const shop = (await resolveLiveRecipients(t(), `shop:${F.shop!}`)).map((r) => r.firebaseUid);
    expect(shop).not.toContain('fb-live-shop');
    await db.update(s.users).set({ status: 'active' }).where(eq(s.users.id, F.shopUser!));
  });
});
