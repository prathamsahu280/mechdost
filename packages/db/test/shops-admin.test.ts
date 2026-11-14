/**
 * Shop management for staff and the shop's own profile (specs 07/08 "Real API mode", decision 2026-11-14 "Shop
 * management"): city-scoped list (cursor) and detail, profile edit with compare-and-set and audit, GSTIN only with
 * approval rights in the shop's city, delivery coverage per PIN (same city only), standing with a reason code + note
 * (history kept; paused shops never priced), portal members by phone (role grant + shop_users for live pings), and
 * a pending shop going live once it has a product on sale and a PIN.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { gstinCheckChar } from '@mechdost/shared/gst';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  addShopMember,
  getAdminShop,
  getMyShops,
  grantRole,
  listAdminShops,
  quoteCheckout,
  saveShopOffer,
  setOwnShopHours,
  setShopCoverage,
  setShopStanding,
  syncRbacCatalogue,
  updateShopProfile,
  type CityScope,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const OIL = 'CAS-ACT4T-0900';
const GSTIN = `22AAAAA0000A1Z${gstinCheckChar('22AAAAA0000A1Z')}`;
const WRONG_GSTIN = `22AAAAA0000A1Z${gstinCheckChar('22AAAAA0000A1Z') === '9' ? '8' : '9'}`;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur: CityScope = { all: false, cityIds: [] };
let elsewhere: CityScope = { all: false, cityIds: [] };
let bhilaiPin = '';
const shop: Record<string, string> = {};

const version = async (id: string) =>
  (await db.select({ v: s.shops.version }).from(s.shops).where(eq(s.shops.id, id)))[0]!.v;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-shops-staff' }).returning())[0]!.id;
  for (const row of await db.select().from(s.shops)) shop[row.name] = row.id;
  const [city] = await db.select().from(s.cities).where(eq(s.cities.code, 'RPR'));
  raipur = { all: false, cityIds: [city!.id] };
  const [bhilai] = await db
    .insert(s.cities)
    .values({
      stateId: city!.stateId,
      code: 'BHI',
      slug: 'bhilai',
      name: 'Bhilai',
      status: 'live',
      centroid: { lng: 81.38, lat: 21.21 },
    })
    .returning();
  elsewhere = { all: false, cityIds: [bhilai!.id] };
  bhilaiPin = '490001';
  await db.insert(s.pincodes).values({
    pincode: bhilaiPin,
    stateId: city!.stateId,
    cityId: bhilai!.id,
    centroid: { lng: 81.38, lat: 21.21 },
  });
});

afterAll(async () => {
  await client.close();
});

describe('admin shop list and detail', () => {
  it('lists the shops of the caller’s cities only, by name, with a cursor', async () => {
    const first = await listAdminShops(t(), raipur, { limit: 2 });
    expect(first.items.map((r) => r.name)).toEqual(['Chhattisgarh Tyre House', 'Gupta Lubes & Spares']);
    expect(first.nextCursor).not.toBeNull();
    const second = await listAdminShops(t(), raipur, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.name)).toEqual(['Raipur Battery Point', 'Sharma Auto Parts']);
    expect(second.nextCursor).toBeNull();
    expect(first.items[0]).toMatchObject({ status: 'approved', coveragePincodes: 5, missingHindi: [] });
    expect((await listAdminShops(t(), elsewhere, {})).items).toEqual([]);
    expect((await listAdminShops(t(), raipur, { status: 'paused' })).items).toEqual([]);
  });

  it('a shop outside the caller’s cities is 404', async () => {
    await expect(getAdminShop(t(), elsewhere, shop['Sharma Auto Parts']!)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const d = await getAdminShop(t(), raipur, shop['Sharma Auto Parts']!);
    expect(d.coverage).toHaveLength(5);
    expect(d.coverage[0]).toMatchObject({ pincode: '492001', shippingPaise: 4000, active: true });
    expect(d.history).toEqual([]);
  });
});

describe('profile edit', () => {
  it('changes only the fields sent, with the version, and audits before/after', async () => {
    const id = shop['Raipur Battery Point']!;
    const v = await version(id);
    const r = await updateShopProfile(t(), {
      scope: raipur,
      approveScope: { all: false, cityIds: [] },
      staffUserId: staff,
      shopId: id,
      expectedVersion: v,
      patch: { nameHi: 'रायपुर बैटरी पॉइंट', acceptanceTimeoutMin: 20, freeDeliveryMinPaise: 0 },
    });
    expect(r.version).toBeGreaterThan(v);
    const d = await getAdminShop(t(), raipur, id);
    expect(d).toMatchObject({ acceptanceTimeoutMin: 20, freeDeliveryMinPaise: 0 });
    await expect(
      updateShopProfile(t(), {
        scope: raipur,
        approveScope: raipur,
        staffUserId: staff,
        shopId: id,
        expectedVersion: v,
        patch: { name: 'Stale edit' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_SHOP' });
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, 'shop.updated')));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ acceptanceTimeoutMin: 20, freeDeliveryMinPaise: 0 });
    // Back to the city setting.
    await updateShopProfile(t(), {
      scope: raipur,
      approveScope: raipur,
      staffUserId: staff,
      shopId: id,
      expectedVersion: r.version,
      patch: { freeDeliveryMinPaise: null, acceptanceTimeoutMin: null },
    });
    expect(await getAdminShop(t(), raipur, id)).toMatchObject({
      acceptanceTimeoutMin: null,
      freeDeliveryMinPaise: null,
    });
  });

  it('a GSTIN change needs approval rights in the shop’s city, and must be a valid GSTIN', async () => {
    const id = shop['Gupta Lubes & Spares']!;
    const base = { scope: raipur, staffUserId: staff, shopId: id };
    await expect(
      updateShopProfile(t(), {
        ...base,
        approveScope: elsewhere,
        expectedVersion: await version(id),
        patch: { gstin: GSTIN },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      updateShopProfile(t(), {
        ...base,
        approveScope: raipur,
        expectedVersion: await version(id),
        patch: { gstin: WRONG_GSTIN },
      }),
    ).rejects.toMatchObject({ code: 'GSTIN_INVALID' });
    await db.update(s.shops).set({ gstStatus: 'enrolled' }).where(eq(s.shops.id, id));
    await updateShopProfile(t(), {
      ...base,
      approveScope: raipur,
      expectedVersion: await version(id),
      patch: { gstin: GSTIN },
    });
    expect(await getAdminShop(t(), raipur, id)).toMatchObject({
      gstin: GSTIN,
      gstStatus: 'registered',
    });
  });

  it('out-of-city shops cannot be edited (404)', async () => {
    const id = shop['Gupta Lubes & Spares']!;
    await expect(
      updateShopProfile(t(), {
        scope: elsewhere,
        approveScope: elsewhere,
        staffUserId: staff,
        shopId: id,
        expectedVersion: await version(id),
        patch: { name: 'Hijack' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('working hours (user 2026-11-14)', () => {
  it('new shops get 09:00–21:00 Mon–Sat; staff and the owner change them with the version; bad hours refused', async () => {
    const id = shop['Raipur Battery Point']!;
    expect((await getAdminShop(t(), raipur, id)).hours).toEqual({
      open: '09:00',
      close: '21:00',
      days: [1, 2, 3, 4, 5, 6],
    });
    const sunday = { open: '10:00', close: '20:00', days: [0, 1, 2, 3, 4, 5, 6] };
    await updateShopProfile(t(), {
      scope: raipur,
      approveScope: raipur,
      staffUserId: staff,
      shopId: id,
      expectedVersion: await version(id),
      patch: { hours: sunday },
    });
    expect((await getAdminShop(t(), raipur, id)).hours).toEqual(sunday);
    await expect(
      updateShopProfile(t(), {
        scope: raipur,
        approveScope: raipur,
        staffUserId: staff,
        shopId: id,
        expectedVersion: await version(id),
        patch: { hours: { open: '20:00', close: '10:00', days: [1] } },
      }),
    ).rejects.toMatchObject({ code: 'HOURS_INVALID' });

    const owner = (await db.insert(s.users).values({ firebaseUid: 'fb-hours-owner' }).returning())[0]!.id;
    const r = await setOwnShopHours(t(), {
      shopId: id,
      userId: owner,
      expectedVersion: await version(id),
      hours: { open: '08:30', close: '24:00', days: [1, 2, 3, 4, 5, 6] },
    });
    await expect(
      setOwnShopHours(t(), {
        shopId: id,
        userId: owner,
        expectedVersion: r.version - 1,
        hours: sunday,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SHOP' });
    const [me] = await getMyShops(t(), [id]);
    expect(me).toMatchObject({
      hours: { open: '08:30', close: '24:00', days: [1, 2, 3, 4, 5, 6] },
      version: r.version,
    });
    expect(typeof me!.openNow).toBe('boolean');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, 'shop.hours_changed')));
    expect(audit.map((a) => a.actorRole)).toEqual(['shop']);
  });
});

describe('coverage', () => {
  it('adds, changes and removes PIN codes of the shop’s own city, with the version', async () => {
    const id = shop['Chhattisgarh Tyre House']!;
    const r = await setShopCoverage(t(), {
      scope: raipur,
      staffUserId: staff,
      shopId: id,
      expectedVersion: await version(id),
      upsert: [{ pincode: '492001', shippingPaise: 2500, leadDays: 1, active: true }],
      remove: ['492099'],
    });
    const d = await getAdminShop(t(), raipur, id);
    expect(d.version).toBe(r.version);
    expect(d.coverage.map((c) => c.pincode)).toEqual(['492001', '492004', '492006', '492007']);
    expect(d.coverage[0]).toMatchObject({ shippingPaise: 2500, leadDays: 1 });

    await expect(
      setShopCoverage(t(), {
        scope: raipur,
        staffUserId: staff,
        shopId: id,
        expectedVersion: r.version,
        upsert: [{ pincode: bhilaiPin, shippingPaise: 0, leadDays: 1, active: true }],
        remove: [],
      }),
    ).rejects.toMatchObject({ code: 'PINCODE_OTHER_CITY' });
    await expect(
      setShopCoverage(t(), {
        scope: raipur,
        staffUserId: staff,
        shopId: id,
        expectedVersion: r.version - 1,
        upsert: [],
        remove: ['492001'],
      }),
    ).rejects.toMatchObject({ code: 'STALE_SHOP' });
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, id), eq(s.auditLog.action, 'shop.coverage_changed')));
    expect(audit).toHaveLength(1);
  });

  it('a pending shop goes live once it has a PIN and a product on sale', async () => {
    const [p] = await db
      .insert(s.shops)
      .values({
        name: 'New Pending Spares',
        phone: '+919000000099',
        addressLine: 'Telibandha, Raipur',
        pincode: '492001',
        cityId: raipur.all ? '' : raipur.cityIds[0]!,
        stateId: (await db.select().from(s.states))[0]!.id,
        location: { lng: 81.65, lat: 21.24 },
      })
      .returning();
    const id = p!.id;
    expect(p!.status).toBe('pending');
    await setShopCoverage(t(), {
      scope: raipur,
      staffUserId: staff,
      shopId: id,
      expectedVersion: await version(id),
      upsert: [{ pincode: '492001', shippingPaise: 3000, leadDays: 2, active: true }],
      remove: [],
    });
    expect((await getAdminShop(t(), raipur, id)).status).toBe('pending'); // nothing on sale yet
    await saveShopOffer(t(), {
      shopId: id,
      sku: OIL,
      expectedVersion: null,
      changes: { sellingPaise: 43000, onHand: 4 },
      actorUserId: staff,
      actorRole: 'staff',
    });
    expect((await getAdminShop(t(), raipur, id)).status).toBe('approved');
  });
});

describe('standing', () => {
  it('pause with a reason code + note: history kept, never priced while paused, 404 outside the city', async () => {
    const id = shop['Gupta Lubes & Spares']!;
    await expect(
      setShopStanding(t(), {
        scope: elsewhere,
        shopId: id,
        to: 'paused',
        reasonCode: 'late_deliveries',
        reason: 'Three late deliveries this week',
        staffUserId: staff,
        expectedVersion: await version(id),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await setShopStanding(t(), {
      scope: raipur,
      shopId: id,
      to: 'paused',
      reasonCode: 'late_deliveries',
      reason: 'Three late deliveries this week',
      staffUserId: staff,
      expectedVersion: await version(id),
    });
    const d = await getAdminShop(t(), raipur, id);
    expect(d).toMatchObject({ status: 'paused', statusReasonCode: 'late_deliveries' });
    expect(d.history[0]).toMatchObject({
      from: 'approved',
      to: 'paused',
      reasonCode: 'late_deliveries',
      reason: 'Three late deliveries this week',
    });
    // Sharma also sells the oil; while Gupta is paused it is never the seller.
    await setShopStanding(t(), {
      scope: raipur,
      shopId: shop['Sharma Auto Parts']!,
      to: 'paused',
      reasonCode: 'partner_request',
      reason: 'Owner travelling',
      staffUserId: staff,
      expectedVersion: await version(shop['Sharma Auto Parts']!),
    });
    const q = await quoteCheckout(t(), { pincode: '492004', lines: [{ sku: OIL, qty: 1 }], locale: 'en' });
    expect(q.groups.map((g) => g.seller)).not.toContain('Gupta Lubes & Spares');
    expect(q.groups.map((g) => g.seller)).not.toContain('Sharma Auto Parts');
    for (const name of ['Gupta Lubes & Spares', 'Sharma Auto Parts'])
      await setShopStanding(t(), {
        scope: raipur,
        shopId: shop[name]!,
        to: 'approved',
        reasonCode: 'issue_resolved',
        reason: 'Back to normal',
        staffUserId: staff,
        expectedVersion: await version(shop[name]!),
      });
    const after = await getMyShops(t(), [id]);
    expect(after[0]).toMatchObject({ status: 'approved', standing: null });
  });

  it('refuses an unknown reason code', async () => {
    const id = shop['Gupta Lubes & Spares']!;
    await expect(
      setShopStanding(t(), {
        scope: raipur,
        shopId: id,
        to: 'suspended',
        reasonCode: 'pause_ended',
        reason: 'Not a staff reason',
        staffUserId: staff,
        expectedVersion: await version(id),
      }),
    ).rejects.toMatchObject({ code: 'STATUS_REASON_CODE' });
  });
});

describe('members and the shop’s own profile', () => {
  it('gives a signed-up person portal access (role + shop_users), once; never to staff', async () => {
    const id = shop['Raipur Battery Point']!;
    const [u] = await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-shops-owner', phone: '+919811100001' })
      .returning();
    await expect(
      addShopMember(t(), {
        scope: raipur,
        staffUserId: staff,
        shopId: id,
        phone: '+919811100099',
        role: 'seller_owner',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const r = await addShopMember(t(), {
      scope: raipur,
      staffUserId: staff,
      shopId: id,
      phone: '+919811100001',
      role: 'seller_owner',
    });
    expect(r.userId).toBe(u!.id);
    await addShopMember(t(), {
      scope: raipur,
      staffUserId: staff,
      shopId: id,
      phone: '+919811100001',
      role: 'seller_owner',
    });
    const members = await db.select().from(s.shopUsers).where(eq(s.shopUsers.shopId, id));
    expect(members.map((m) => [m.userId, m.role])).toEqual([[u!.id, 'owner']]);
    const roles = await db.select().from(s.userRoles).where(eq(s.userRoles.userId, u!.id));
    expect(roles.map((x) => x.shopId)).toEqual([id]);
    expect((await getAdminShop(t(), raipur, id)).members).toEqual([
      { userId: u!.id, role: 'seller_owner', phoneLast4: '0001' },
    ]);

    const [ops] = await db
      .insert(s.users)
      .values({ firebaseUid: 'fb-shops-ops', phone: '+919811100002' })
      .returning();
    await grantRole(t(), { userId: ops!.id, role: 'ops_manager', grantedBy: null });
    await expect(
      addShopMember(t(), {
        scope: raipur,
        staffUserId: staff,
        shopId: id,
        phone: '+919811100002',
        role: 'seller_staff',
      }),
    ).rejects.toMatchObject({ code: 'MEMBER_IS_STAFF' });
  });

  it('the shop sees its name, standing with the reason code, and a coverage summary', async () => {
    const id = shop['Sharma Auto Parts']!;
    await setShopStanding(t(), {
      scope: raipur,
      shopId: id,
      to: 'paused',
      reasonCode: 'documents_pending',
      reason: 'Send the shop licence',
      staffUserId: staff,
      expectedVersion: await version(id),
      pausedUntil: new Date('2026-12-01T00:00:00Z'),
    });
    const [me] = await getMyShops(t(), [id]);
    expect(me).toMatchObject({
      id,
      name: 'Sharma Auto Parts',
      nameHi: 'शर्मा ऑटो पार्ट्स',
      status: 'paused',
      standing: {
        reasonCode: 'documents_pending',
        note: 'Send the shop licence',
        until: '2026-12-01T00:00:00.000Z',
      },
      coverage: { pincodes: 5, minShippingPaise: 4000, maxShippingPaise: 4000 },
    });
    expect(me!.offersOnSale).toBeGreaterThan(0);
    expect(await getMyShops(t(), [])).toEqual([]);
  });
});
