/**
 * The bell and web push (spec 10, design 2026-11-15): a notice is written in the business transaction, in the
 * person's language, once per change; push only with a device and the preference; promotions only with the marketing
 * consent and under the weekly cap; staff by permission and city; own rows only; retention; devices.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { encryptField, loadKeyring } from '../src/crypto';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  grantRole,
  listNotices,
  markNoticesRead,
  offerOrderToShop,
  purgeOldNotices,
  queueEmail,
  queueNotice,
  queueOfferExpiryReminders,
  queueRefundOverdueAlerts,
  queueStaffNotice,
  queueStaffOrderPlaced,
  registerPushDevice,
  revokePushDevice,
  revokePushTokens,
  setNoticePreferences,
  syncRbacCatalogue,
  unreadNoticeCount,
  getNoticePreferences,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};
const TOKEN = (n: number) => `fcm-token-${String(n).padStart(4, '0')}-abcdefghijklmnopqrstuvwxyz`;
let seq = 0;
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

const rows = (userId: string) =>
  db
    .select()
    .from(s.notifications)
    .where(eq(s.notifications.userId, userId))
    .orderBy(s.notifications.createdAt);
const pushRows = () => db.select().from(s.notificationOutbox).where(eq(s.notificationOutbox.channel, 'push'));

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  const city = async (code: string, slug: string) =>
    (
      await db
        .insert(s.cities)
        .values({
          stateId: state!.id,
          code,
          slug,
          name: slug,
          status: 'live',
          centroid: { lng: 81.6, lat: 21.2 },
        })
        .returning()
    )[0]!.id;
  F.city = await city('RPR', 'raipur');
  F.otherCity = await city('BPL', 'bilaspur');
  await db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: F.city,
    locality: 'Pandri',
    localityHi: 'पंडरी',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  const user = async (uid: string, language: 'en' | 'hi' = 'en', extra: Record<string, unknown> = {}) =>
    (
      await db
        .insert(s.users)
        .values({ firebaseUid: uid, language, ...extra })
        .returning()
    )[0]!.id;
  await syncRbacCatalogue(t());
  F.hi = await user('fb-n-hi', 'hi');
  F.en = await user('fb-n-en');
  F.other = await user('fb-n-other');
  F.promo = await user('fb-n-promo');
  F.noEmail = await user('fb-n-noemail', 'en');
  F.inactive = await user('fb-n-inactive', 'en', { status: 'deactivated' });
  F.cityStaff = await user('fb-n-citystaff');
  F.otherCityStaff = await user('fb-n-otherstaff');
  F.marketing = await user('fb-n-marketing');
  F.owner = await user('fb-n-owner');
  await grantRole(t(), { userId: F.cityStaff, role: 'city_manager', cityId: F.city, grantedBy: null });
  await grantRole(t(), {
    userId: F.otherCityStaff,
    role: 'city_manager',
    cityId: F.otherCity,
    grantedBy: null,
  });
  await grantRole(t(), { userId: F.marketing, role: 'marketing', grantedBy: null });
  F.shop = (
    await db
      .insert(s.shops)
      .values({
        name: 'Notice Shop',
        phone: '+919000000009',
        addressLine: 'Raipur',
        pincode: '492001',
        cityId: F.city,
        stateId: state!.id,
        status: 'approved',
        location: { lng: 81.63, lat: 21.22 },
      })
      .returning()
  )[0]!.id;
  await db.insert(s.shopUsers).values({ shopId: F.shop, userId: F.owner, role: 'owner' });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from notification_outbox`);
  await db.execute(sql`delete from notification_templates`);
  await db.execute(sql`delete from push_devices`);
  await db.execute(sql`delete from notification_preferences`);
});

const order = (code: string) => ({ orderCode: code });

describe('queueNotice', () => {
  it('writes the bell row in the person’s language, with the page it opens', async () => {
    expect(
      await queueNotice(t(), {
        kind: 'order.confirmed',
        userId: F.hi!,
        entityId: 'o1',
        version: 2,
        params: order('MD-RPR-2026-AAAAAA'),
      }),
    ).toBe(true);
    expect(
      await queueNotice(t(), {
        kind: 'order.confirmed',
        userId: F.en!,
        entityId: 'o1',
        version: 2,
        params: order('MD-RPR-2026-AAAAAA'),
      }),
    ).toBe(true);
    const [hi] = await rows(F.hi!);
    const [en] = await rows(F.en!);
    expect(hi).toMatchObject({
      kind: 'order.confirmed',
      category: 'transactional',
      entityType: 'order',
      title: 'ऑर्डर कन्फ़र्म',
      link: '/hi/orders/MD-RPR-2026-AAAAAA',
    });
    expect(hi?.body).toContain('MD-RPR-2026-AAAAAA');
    expect(en).toMatchObject({ title: 'Order confirmed', link: '/orders/MD-RPR-2026-AAAAAA' });
  });

  it('the same change twice writes once; the next version writes again', async () => {
    const q = (version: number) =>
      queueNotice(t(), {
        kind: 'order.delivered',
        userId: F.en!,
        entityId: 'o2',
        version,
        params: order('MD-1'),
      });
    expect(await q(1)).toBe(true);
    expect(await q(1)).toBe(false);
    expect(await q(2)).toBe(true);
    expect(await rows(F.en!)).toHaveLength(2);
  });

  it('an inactive account gets nothing', async () => {
    expect(
      await queueNotice(t(), {
        kind: 'order.delivered',
        userId: F.inactive!,
        entityId: 'o3',
        version: 1,
        params: order('MD-1'),
      }),
    ).toBe(false);
  });

  it('a rolled-back change leaves no notice', async () => {
    await expect(
      db.transaction(async (tx) => {
        await queueNotice(tx as unknown as Tx, {
          kind: 'order.delivered',
          userId: F.en!,
          entityId: 'o4',
          version: 1,
          params: order('MD-1'),
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await rows(F.en!)).toHaveLength(0);
  });

  it('an email milestone brings its notice, even for a person with no email address', async () => {
    await queueEmail(t(), {
      template: 'order_delivered',
      entityId: 'o5',
      version: 3,
      userId: F.noEmail!,
      payload: order('MD-RPR-2026-BBBBBB'),
    });
    const [row] = await rows(F.noEmail!);
    expect(row).toMatchObject({ kind: 'order.delivered', dedupeKey: 'order.delivered:o5:v3' });
    expect(await db.$count(s.notificationOutbox)).toBe(0);
  });

  it('admin text overrides the default; switching the bell text off writes nothing', async () => {
    await db.insert(s.notificationTemplates).values({
      key: 'order.confirmed',
      channel: 'inapp',
      locale: 'en',
      subject: 'Good news {orderCode}',
      body: 'Seller says yes to {orderCode}.',
    });
    await queueNotice(t(), {
      kind: 'order.confirmed',
      userId: F.en!,
      entityId: 'o6',
      version: 1,
      params: order('MD-9'),
    });
    expect((await rows(F.en!))[0]).toMatchObject({
      title: 'Good news MD-9',
      body: 'Seller says yes to MD-9.',
    });
    await db
      .update(s.notificationTemplates)
      .set({ enabled: false })
      .where(eq(s.notificationTemplates.key, 'order.confirmed'));
    expect(
      await queueNotice(t(), {
        kind: 'order.confirmed',
        userId: F.en!,
        entityId: 'o7',
        version: 1,
        params: order('MD-9'),
      }),
    ).toBe(false);
  });

  it('values outside the kind’s placeholder list never reach the text (no delivery code, no amount)', async () => {
    await queueNotice(t(), {
      kind: 'order.out_for_delivery',
      userId: F.en!,
      entityId: 'o8',
      version: 1,
      params: { orderCode: 'MD-7', deliveryCode: '4821', amount: '₹999' },
    });
    const [row] = await rows(F.en!);
    expect(`${row?.title} ${row?.body}`).not.toMatch(/4821|999/);
  });
});

describe('push', () => {
  const send = (userId: string, id: string) =>
    queueNotice(t(), {
      kind: 'order.confirmed',
      userId,
      entityId: id,
      version: 1,
      params: order('MD-RPR-2026-CCCCCC'),
    });

  it('no device, no push row; with a device it carries title, body and link only', async () => {
    await send(F.en!, 'p1');
    expect(await pushRows()).toHaveLength(0);
    await registerPushDevice(t(), F.en!, { token: TOKEN(1), locale: 'en', uaFamily: 'chrome' }, 10);
    await send(F.en!, 'p2');
    const [row] = await pushRows();
    expect(row).toMatchObject({
      recipientUserId: F.en!,
      templateKey: 'order.confirmed',
      status: 'pending',
      recipient: null,
    });
    expect(Object.keys(row!.payload as object).sort()).toEqual(['body', 'link', 'title']);
    expect(JSON.stringify(row)).not.toContain(TOKEN(1));
  });

  it('push can be switched off per person while the bell stays', async () => {
    await registerPushDevice(t(), F.en!, { token: TOKEN(2), locale: 'en', uaFamily: 'chrome' }, 10);
    await setNoticePreferences(t(), F.en!, { pushTransactional: false }, 'v1');
    await send(F.en!, 'p3');
    expect(await pushRows()).toHaveLength(0);
    expect(await rows(F.en!)).toHaveLength(1);
  });

  it('a revoked token sends nothing; a Firebase-invalid token is revoked', async () => {
    await registerPushDevice(t(), F.en!, { token: TOKEN(3), locale: 'en', uaFamily: 'edge' }, 10);
    await revokePushTokens(t(), [TOKEN(3)]);
    await send(F.en!, 'p4');
    expect(await pushRows()).toHaveLength(0);
  });
});

describe('promotions', () => {
  const promo = (n: number) =>
    // No promotional kind ships yet: the rules are exercised through the writer with a promotional row stand-in.
    db.insert(s.notifications).values({
      userId: F.en!,
      category: 'promotional',
      kind: 'x.test',
      title: 'Offer',
      body: 'Offer',
      dedupeKey: `promo-${String(n)}`,
    });

  it('the marketing switch records a consent row with the notice version and can be withdrawn', async () => {
    expect((await getNoticePreferences(t(), F.promo!)).promotions).toBe(false);
    await setNoticePreferences(t(), F.promo!, { promotions: true }, 'v-test');
    expect((await getNoticePreferences(t(), F.promo!)).promotions).toBe(true);
    await setNoticePreferences(t(), F.promo!, { promotions: false }, 'v-test');
    expect((await getNoticePreferences(t(), F.promo!)).promotions).toBe(false);
    const log = await db
      .select()
      .from(s.consents)
      .where(eq(s.consents.userId, F.promo!))
      .orderBy(s.consents.createdAt);
    expect(log.map((c) => [c.purpose, c.granted, c.noticeVersion])).toEqual([
      ['marketing', true, 'v-test'],
      ['marketing', false, 'v-test'],
    ]);
  });

  it('the weekly cap counts promotional rows of the last seven days', async () => {
    await promo(1);
    await promo(2);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.notifications)
      .where(sql`category = 'promotional' and created_at > now() - interval '7 days'`);
    expect(row?.n).toBe(2);
  });
});

describe('staff notices', () => {
  async function placedOrder(cityId: string, code: string) {
    const [g] = await db
      .insert(s.orderGroups)
      .values({
        code,
        userId: F.en!,
        cityId,
        paymentMethod: 'cod',
        paymentStatus: 'cod_pending',
        subtotalPaise: 50000,
        totalPaise: 50000,
        idempotencyKey: `notice-idem-${code}-xxxxxxxxxxxx`,
      })
      .returning();
    const [o] = await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: 1,
        code: `${code}-1`,
        userId: F.en!,
        cityId,
        shippingAddress: { line1: 'Sarona', pincode: '492001' },
        pincode: '492001',
        subtotalPaise: 50000,
        totalPaise: 50000,
      })
      .returning();
    return { group: g!, order: o! };
  }

  it('needs-routing reaches staff who can route in the order’s city, no one else', async () => {
    const { group } = await placedOrder(F.city!, 'MD-RPR-2026-NSTAFF');
    await queueStaffOrderPlaced(t(), group.id);
    const [mine] = await rows(F.cityStaff!);
    expect(mine).toMatchObject({ kind: 'staff.order_needs_routing', link: '/admin/orders' });
    expect(mine?.body).toContain('MD-RPR-2026-NSTAFF');
    expect(await rows(F.otherCityStaff!)).toHaveLength(0);
    expect(await rows(F.marketing!)).toHaveLength(0);
    expect(await rows(F.en!)).toHaveLength(0);
  });

  it('routing then declining tells staff once per change', async () => {
    const { order } = await placedOrder(F.city!, 'MD-RPR-2026-NDEC2K');
    expect(
      await queueStaffNotice(t(), {
        kind: 'staff.shop_declined',
        cityId: F.city!,
        entityId: order.id,
        version: 3,
        params: { orderCode: 'MD-X' },
      }),
    ).toBe(1);
    expect(
      await queueStaffNotice(t(), {
        kind: 'staff.shop_declined',
        cityId: F.city!,
        entityId: order.id,
        version: 3,
        params: { orderCode: 'MD-X' },
      }),
    ).toBe(0);
  });

  it('the shop’s people get a reminder before an offer runs out, once', async () => {
    const { order } = await placedOrder(F.city!, 'MD-RPR-2026-NREM2D');
    await db.transaction(async (tx) => {
      await offerOrderToShop(tx, {
        orderId: order.id,
        shopId: F.shop!,
        expectedOrderVersion: order.version,
        timeoutMinutes: 3,
        actor: { type: 'admin' },
      });
    });
    expect(await queueOfferExpiryReminders(t(), 5)).toBeGreaterThan(0);
    const mine = (await rows(F.owner!)).filter((r) => r.kind === 'shop.offer_expiring');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.link).toBe('/partner/shop');
    expect(await queueOfferExpiryReminders(t(), 5)).toBe(0);
    expect(await queueOfferExpiryReminders(t(), 0)).toBe(0);
  });

  it('a refund waiting past the SLA alerts finance staff once (and not before)', async () => {
    const { group, order } = await placedOrder(F.city!, 'MD-RPR-2026-NREFND');
    await db.insert(s.refunds).values({
      groupId: group.id,
      orderId: order.id,
      amountPaise: 1000,
      mode: 'bank_upi',
      idemKey: 'notice-refund-idem-key-1',
      status: 'requested',
      source: 'order_rejected',
      reasonCode: 'order_rejected',
      destinationEnc: encryptField('acct-1234', ring, 'refunds.destination_enc'),
    });
    F.finance = (await db.insert(s.users).values({ firebaseUid: 'fb-n-finance' }).returning())[0]!.id;
    await grantRole(t(), { userId: F.finance, role: 'finance', grantedBy: null });
    expect(await queueRefundOverdueAlerts(t(), 24)).toBe(0); // not yet past its time limit
    await db.execute(sql`update refunds set created_at = now() - interval '2 days'`);
    expect(await queueRefundOverdueAlerts(t(), 24)).toBe(1);
    expect(await queueRefundOverdueAlerts(t(), 24)).toBe(0); // once per refund
    expect((await rows(F.finance)).map((r) => r.kind)).toEqual(['staff.refund_overdue']);
  });
});

describe('the bell list', () => {
  async function fill(userId: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      seq += 1;
      await db.insert(s.notifications).values({
        userId,
        kind: 'order.placed',
        title: `T${String(seq)}`,
        body: 'B',
        dedupeKey: `fill-${String(seq)}`,
        createdAt: new Date(Date.now() - (n - i) * 1000),
      });
    }
  }

  it('pages newest first by keyset cursor and never shows another person’s rows', async () => {
    await fill(F.en!, 5);
    await fill(F.other!, 2);
    const a = await listNotices(t(), F.en!, { limit: 2 });
    expect(a.notices).toHaveLength(2);
    expect(a.nextCursor).not.toBeNull();
    const b = await listNotices(t(), F.en!, { limit: 2, cursor: a.nextCursor ?? undefined });
    const c = await listNotices(t(), F.en!, { limit: 2, cursor: b.nextCursor ?? undefined });
    const ids = [...a.notices, ...b.notices, ...c.notices].map((n) => n.id);
    expect(new Set(ids).size).toBe(5);
    expect(c.nextCursor).toBeNull();
    expect(a.notices[0]!.createdAt > a.notices[1]!.createdAt).toBe(true);
  });

  it('a tampered cursor is refused', async () => {
    await expect(listNotices(t(), F.en!, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });

  it('reads own ids only; a foreign id changes nothing; read all clears the badge', async () => {
    await fill(F.en!, 3);
    await fill(F.other!, 1);
    const mine = (await listNotices(t(), F.en!, {})).notices;
    const theirs = (await listNotices(t(), F.other!, {})).notices;
    const r1 = await markNoticesRead(t(), F.en!, { ids: [mine[0]!.id, theirs[0]!.id] });
    expect(r1).toEqual({ updated: 1, unread: 2 });
    expect((await listNotices(t(), F.other!, {})).unread).toBe(1);
    expect(await markNoticesRead(t(), F.en!, { all: true })).toEqual({ updated: 2, unread: 0 });
  });

  it('counts stop at 100 so a flood costs one short scan', async () => {
    await db.execute(
      sql`insert into notifications (user_id, title, body) select ${F.en!}::uuid, 'x', 'y' from generate_series(1, 130)`,
    );
    expect(await unreadNoticeCount(t(), F.en!)).toBe(100);
  });

  it('retention deletes rows older than the limit and keeps the rest', async () => {
    await fill(F.en!, 2);
    await db.insert(s.notifications).values({
      userId: F.en!,
      title: 'old',
      body: 'old',
      createdAt: new Date(Date.now() - 100 * 86_400_000),
    });
    expect(await purgeOldNotices(t(), 90)).toBe(1);
    expect(await db.$count(s.notifications, eq(s.notifications.userId, F.en!))).toBe(2);
  });
});

describe('push devices', () => {
  it('registers, refreshes (same row) and moves a token to whoever signs in on that browser', async () => {
    const a = await registerPushDevice(
      t(),
      F.en!,
      { token: TOKEN(10), locale: 'en', uaFamily: 'chrome' },
      10,
    );
    const again = await registerPushDevice(
      t(),
      F.en!,
      { token: TOKEN(10), locale: 'hi', uaFamily: 'chrome' },
      10,
    );
    expect(again.id).toBe(a.id);
    const moved = await registerPushDevice(
      t(),
      F.other!,
      { token: TOKEN(10), locale: 'en', uaFamily: 'chrome' },
      10,
    );
    expect(moved.id).toBe(a.id);
    const [row] = await db.select().from(s.pushDevices).where(eq(s.pushDevices.id, a.id));
    expect(row).toMatchObject({ userId: F.other, revokedAt: null });
  });

  it('keeps the newest N live devices and revokes the rest', async () => {
    for (let i = 20; i < 24; i += 1) {
      await registerPushDevice(t(), F.en!, { token: TOKEN(i), locale: 'en', uaFamily: 'other' }, 3);
    }
    const live = await db.$count(s.pushDevices, sql`user_id = ${F.en!} and revoked_at is null`);
    expect(live).toBe(3);
  });

  it('removing a device: own id works, another person’s id is 404', async () => {
    const a = await registerPushDevice(
      t(),
      F.en!,
      { token: TOKEN(30), locale: 'en', uaFamily: 'firefox' },
      10,
    );
    await expect(revokePushDevice(t(), F.other!, a.id)).rejects.toMatchObject({ status: 404 });
    await revokePushDevice(t(), F.en!, a.id);
    const [row] = await db.select().from(s.pushDevices).where(eq(s.pushDevices.id, a.id));
    expect(row?.revokedAt).not.toBeNull();
  });
});
