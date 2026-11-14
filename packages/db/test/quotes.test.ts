/**
 * Bulk quotes (spec 19 acceptance tests): request snapshot and limits, actor scoping (foreign codes 404), the
 * negotiation thread, versioned offers (one active), accepting exactly the latest unexpired offer into a normal
 * order with negotiated prices (one order per quote, however often or concurrently it is accepted), closing,
 * expiry, and the live recipients of a quote topic. Runs on the Raipur demo catalogue.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { istDateString } from '@mechdost/shared/time';
import { loadKeyring } from '../src/crypto';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  acceptQuoteOffer,
  acceptShopOffer,
  advanceShopOrder,
  blockCustomer,
  deliverShopOrder,
  deliveryCodeFor,
  listShopOrders,
  pgCode,
  rankShopsForOrder,
  routeOrder,
  createQuote,
  declineQuote,
  expireQuotes,
  getAdminQuote,
  getMyQuote,
  grantRole,
  listAdminQuotes,
  listMyQuotes,
  postCustomerQuoteMessage,
  postStaffQuoteMessage,
  quoteRules,
  resolveLiveRecipients,
  sendQuoteOffer,
  syncRbacCatalogue,
  withdrawQuote,
  type CityScope,
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
let meera = '';
let staff = '';
let cityId = '';
const ALL: CityScope = { all: true };
let elsewhere: CityScope = { all: false, cityIds: [] };

const OIL = 'castrol-activ-4t-20w40-900ml'; // CAS-ACT4T-0900, ₹440 at Sharma (12 on hand)
const PLUG = 'spark-plug-iridium'; // PRT-SPK-IR, ₹620 at Sharma (12 on hand)
const address = {
  contactName: 'Ravi Sahu',
  contactPhone: '+919876543210',
  line1: 'House 12, Pandri',
  landmark: null,
  pincode: '492004',
};
let n = 0;
const key = () => `quote-key-${String(++n).padStart(8, '0')}`;

async function newQuote(userId = ravi, lines = [{ slug: OIL, qty: 10 }]) {
  return createQuote(t(), {
    userId,
    idempotencyKey: key(),
    lines,
    address,
    note: 'Need these for my garage by Friday',
    locale: 'en',
  });
}

/** Staff offer at the given unit price for every line; returns the quote version after it. */
async function offer(code: string, unitPaise: number, deliveryPaise = 0, validDays = 3) {
  const q = await getAdminQuote(t(), ALL, code, 'en');
  return sendQuoteOffer(t(), {
    scope: ALL,
    staffUserId: staff,
    code,
    expectedVersion: q.version,
    lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise })),
    deliveryPaise,
    validDays,
    terms: 'Cash on delivery',
    // These tests offer below the shop price on purpose: staff confirm it (review I2).
    confirmLowPrices: true,
  });
}

async function closeAllOpen(userId: string) {
  for (const q of (await listMyQuotes(t(), userId, { cursor: null }, 'en')).items) {
    if (['open', 'negotiating', 'offered'].includes(q.status))
      await declineQuote(t(), { userId, code: q.code, reasonCode: 'no_longer_needed' });
  }
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  const mk = async (uid: string) =>
    (await db.insert(s.users).values({ firebaseUid: uid }).returning())[0]!.id;
  ravi = await mk('fb-quote-ravi');
  meera = await mk('fb-quote-meera');
  staff = await mk('fb-quote-staff');
  cityId = (await db.select({ id: s.cities.id }).from(s.cities).where(eq(s.cities.code, 'RPR')))[0]!.id;
  const [other] = await db
    .insert(s.cities)
    .values({
      code: 'BLS',
      slug: 'bilaspur',
      name: 'Bilaspur',
      stateId: (await db.select().from(s.states))[0]!.id,
    })
    .returning();
  elsewhere = { all: false, cityIds: [other!.id] };
  await grantRole(t(), { userId: staff, role: 'city_manager', cityId, grantedBy: null });
});

afterAll(async () => {
  await client.close();
});

describe('requesting a quote', () => {
  it('snapshots the lines with the catalogue price and opens the thread with the note', async () => {
    const r = await newQuote(ravi, [
      { slug: OIL, qty: 10 },
      { slug: PLUG, qty: 4 },
    ]);
    expect(r.code).toMatch(/^QT-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(r).toMatchObject({ status: 'open', replayed: false });
    const q = await getMyQuote(t(), ravi, r.code, 'en');
    expect(q.lineItems.map((l) => [l.lineNo, l.sku, l.qty, l.listUnitPaise])).toEqual([
      [1, 'CAS-ACT4T-0900', 10, 44_000],
      [2, 'PRT-SPK-IR', 4, 62_000],
    ]);
    expect(q.units).toBe(14);
    expect(q.listTotalPaise).toBe(10 * 44_000 + 4 * 62_000);
    expect(q.messages).toMatchObject([{ from: 'customer', body: 'Need these for my garage by Friday' }]);
    expect(q.address.contactPhone).toBe('+919876543210');
    const [event] = await db.select().from(s.quoteEvents).where(eq(s.quoteEvents.kind, 'requested'));
    expect(event).toMatchObject({ toStatus: 'open', actorType: 'customer' });
    await closeAllOpen(ravi);
  });

  it('returns the same quote for the same key and refuses the key for a different request', async () => {
    const k = key();
    const input = {
      userId: ravi,
      idempotencyKey: k,
      lines: [{ slug: OIL, qty: 10 }],
      address,
      note: null,
      locale: 'en' as const,
    };
    const first = await createQuote(t(), input);
    const again = await createQuote(t(), input);
    expect(again).toMatchObject({ code: first.code, replayed: true });
    await expect(createQuote(t(), { ...input, lines: [{ slug: OIL, qty: 11 }] })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_MISMATCH',
    });
    await closeAllOpen(ravi);
  });

  it('refuses fewer units than the minimum (admin setting, default 10)', async () => {
    await expect(newQuote(ravi, [{ slug: OIL, qty: 9 }])).rejects.toMatchObject({
      code: 'QUOTE_MIN_UNITS',
      details: { minUnits: 10 },
    });
    await db.insert(s.settings).values({ key: 'quotes.min_units', value: 5 });
    expect((await quoteRules(t(), ravi)).minUnits).toBe(5);
    const r = await newQuote(ravi, [{ slug: OIL, qty: 5 }]);
    expect(r.status).toBe('open');
    await db.delete(s.settings).where(eq(s.settings.key, 'quotes.min_units'));
    await closeAllOpen(ravi);
  });

  it('refuses products that are not live and PIN codes we do not serve', async () => {
    await db.update(s.products).set({ status: 'archived' }).where(eq(s.products.slug, PLUG));
    await expect(
      newQuote(ravi, [
        { slug: OIL, qty: 10 },
        { slug: PLUG, qty: 2 },
      ]),
    ).rejects.toMatchObject({ code: 'QUOTE_PRODUCT_UNAVAILABLE', details: { slugs: [PLUG] } });
    await db.update(s.products).set({ status: 'live' }).where(eq(s.products.slug, PLUG));
    await expect(newQuote(ravi, [{ slug: 'no-such-product', qty: 10 }])).rejects.toMatchObject({
      code: 'QUOTE_PRODUCT_UNAVAILABLE',
    });
    await expect(
      createQuote(t(), {
        userId: ravi,
        idempotencyKey: key(),
        lines: [{ slug: OIL, qty: 10 }],
        address: { ...address, pincode: '110001' },
        note: null,
        locale: 'en',
      }),
    ).rejects.toMatchObject({ code: 'PINCODE_NOT_SERVICEABLE' });
  });

  it('allows three open quotes per customer', async () => {
    for (let i = 0; i < 3; i++) await newQuote(meera);
    await expect(newQuote(meera)).rejects.toMatchObject({ code: 'QUOTE_OPEN_LIMIT' });
    expect((await quoteRules(t(), meera)).open).toBe(3);
    await closeAllOpen(meera);
    expect((await quoteRules(t(), meera)).open).toBe(0);
  });
});

describe('scoping (hard rule 3)', () => {
  it("returns 404 for another customer's quote and for staff outside the quote's city", async () => {
    const { code } = await newQuote(ravi);
    await expect(getMyQuote(t(), meera, code, 'en')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(postCustomerQuoteMessage(t(), { userId: meera, code, body: 'hello' })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      acceptQuoteOffer(t(), { userId: meera, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(declineQuote(t(), { userId: meera, code, reasonCode: 'other' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getAdminQuote(t(), elsewhere, code, 'en')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await listAdminQuotes(t(), elsewhere, 'active', { cursor: null }, 'en')).items).toEqual([]);
    expect((await listMyQuotes(t(), meera, { cursor: null }, 'en')).items.map((q) => q.code)).not.toContain(
      code,
    );
    await closeAllOpen(ravi);
  });
});

describe('negotiating', () => {
  it('moves open → negotiating on the first staff reply and shows it as waiting until then', async () => {
    const { code } = await newQuote(ravi);
    const waiting = await listAdminQuotes(t(), ALL, 'waiting', { cursor: null }, 'en');
    expect(waiting.items.map((q) => q.code)).toContain(code);
    const r = await postStaffQuoteMessage(t(), {
      scope: ALL,
      staffUserId: staff,
      code,
      body: 'Yes, we can do it.',
    });
    expect(r.status).toBe('negotiating');
    expect(
      (await listAdminQuotes(t(), ALL, 'waiting', { cursor: null }, 'en')).items.map((q) => q.code),
    ).not.toContain(code);
    const q = await getMyQuote(t(), ravi, code, 'en');
    expect(q.messages.map((m) => m.from)).toEqual(['customer', 'staff']);
    expect(q.lastMessageBy).toBe('staff');
    await closeAllOpen(ravi);
  });

  it('keeps exactly one active offer: a new version supersedes the previous one', async () => {
    const { code } = await newQuote(ravi);
    const first = await offer(code, 42_000);
    expect(first).toMatchObject({ status: 'offered', offerVersion: 1 });
    const second = await offer(code, 41_000, 2_000);
    expect(second.offerVersion).toBe(2);
    const rows = await db
      .select({ v: s.quoteOffers.offerVersion, status: s.quoteOffers.status })
      .from(s.quoteOffers)
      .innerJoin(s.quoteRequests, eq(s.quoteRequests.id, s.quoteOffers.quoteId))
      .where(eq(s.quoteRequests.code, code))
      .orderBy(s.quoteOffers.offerVersion);
    expect(rows).toEqual([
      { v: 1, status: 'superseded' },
      { v: 2, status: 'active' },
    ]);
    const q = await getMyQuote(t(), ravi, code, 'en');
    expect(q.currentOffer).toMatchObject({
      version: 2,
      subtotalPaise: 410_000,
      deliveryPaise: 2_000,
      totalPaise: 412_000,
    });
    // A superseded offer cannot be accepted (spec 19 acceptance test).
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ status: 409, code: 'QUOTE_OFFER_STALE' });
    await closeAllOpen(ravi);
  });

  it('refuses an offer built on a stale quote version or missing a line', async () => {
    const { code } = await newQuote(ravi, [
      { slug: OIL, qty: 10 },
      { slug: PLUG, qty: 2 },
    ]);
    const q = await getAdminQuote(t(), ALL, code, 'en');
    await postCustomerQuoteMessage(t(), { userId: ravi, code, body: 'Any update?' });
    await expect(
      sendQuoteOffer(t(), {
        scope: ALL,
        staffUserId: staff,
        code,
        expectedVersion: q.version,
        lines: q.lineItems.map((l) => ({ lineNo: l.lineNo, unitPaise: 40_000 })),
        deliveryPaise: 0,
        validDays: 3,
        terms: null,
      }),
    ).rejects.toMatchObject({ code: 'STALE_QUOTE' });
    const fresh = await getAdminQuote(t(), ALL, code, 'en');
    await expect(
      sendQuoteOffer(t(), {
        scope: ALL,
        staffUserId: staff,
        code,
        expectedVersion: fresh.version,
        lines: [{ lineNo: 1, unitPaise: 40_000 }],
        deliveryPaise: 0,
        validDays: 3,
        terms: null,
      }),
    ).rejects.toMatchObject({ code: 'QUOTE_OFFER_LINES' });
    await closeAllOpen(ravi);
  });

  it('reopens talks when the customer writes on an offered quote (offer superseded)', async () => {
    const { code } = await newQuote(ravi);
    await offer(code, 42_000);
    const r = await postCustomerQuoteMessage(t(), { userId: ravi, code, body: 'Can you do ₹400 each?' });
    expect(r.status).toBe('negotiating');
    const q = await getMyQuote(t(), ravi, code, 'en');
    expect(q.currentOffer).toBeNull();
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ code: 'QUOTE_OFFER_STALE' });
    await closeAllOpen(ravi);
  });

  it('limits a customer to 30 messages an hour on one quote', async () => {
    const { code } = await newQuote(ravi);
    const [row] = await db
      .select({ id: s.quoteRequests.id })
      .from(s.quoteRequests)
      .where(eq(s.quoteRequests.code, code));
    await db.insert(s.quoteMessages).values(
      Array.from({ length: 29 }, () => ({
        quoteId: row!.id,
        authorUserId: ravi,
        authorRole: 'customer',
        body: 'x',
      })),
    );
    // The note was the first message: 1 + 29 = 30 this hour.
    await expect(
      postCustomerQuoteMessage(t(), { userId: ravi, code, body: 'one more' }),
    ).rejects.toMatchObject({
      code: 'QUOTE_MESSAGE_LIMIT',
    });
    await closeAllOpen(ravi);
  });
});

describe('offer email', () => {
  it('emails a verified customer once per offer version, and nobody without a verified email', async () => {
    const { code } = await newQuote(meera);
    await offer(code, 42_000);
    const queued = () =>
      db
        .select({ key: s.notificationOutbox.dedupeKey, template: s.notificationOutbox.templateKey })
        .from(s.notificationOutbox)
        .where(eq(s.notificationOutbox.templateKey, 'quote_offer'));
    expect(await queued()).toEqual([]);
    await db
      .update(s.users)
      .set({ email: 'meera@example.com', emailVerifiedAt: new Date() })
      .where(eq(s.users.id, meera));
    await offer(code, 41_000);
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toMatch(/^quote_offer:.+:v2:email$/);
    await closeAllOpen(meera);
  });
});

describe('accepting an offer', () => {
  it('creates a normal COD order with the negotiated prices (below the shop price allowed)', async () => {
    const { code } = await newQuote(ravi, [
      { slug: OIL, qty: 10 },
      { slug: PLUG, qty: 2 },
    ]);
    // ₹400 per oil is below Sharma's approved ₹440: MechDost pays the shop its price (price_source 'quote').
    await offer(code, 40_000, 3_000);
    const r = await acceptQuoteOffer(t(), {
      userId: ravi,
      code,
      offerVersion: 1,
      idempotencyKey: key(),
      locale: 'en',
    });
    expect(r).toMatchObject({ totalPaise: 12 * 40_000 + 3_000, replayed: false });
    expect(r.orderCode).toMatch(/^MD-RPR-/);

    const [group] = await db.select().from(s.orderGroups).where(eq(s.orderGroups.code, r.orderCode));
    expect(group).toMatchObject({
      paymentMethod: 'cod',
      codFeePaise: 0,
      shippingPaise: 3_000,
      totalPaise: r.totalPaise,
    });
    expect(group!.quoteId).not.toBeNull();
    const items = await db
      .select({
        sku: s.orderItems.sku,
        unit: s.orderItems.unitPaise,
        shopUnit: s.orderItems.shopUnitPaise,
        source: s.orderItems.priceSource,
        qty: s.orderItems.qty,
      })
      .from(s.orderItems)
      .innerJoin(s.orders, eq(s.orders.id, s.orderItems.orderId))
      .where(eq(s.orders.groupId, group!.id))
      .orderBy(s.orderItems.sku);
    expect(items).toEqual([
      { sku: 'CAS-ACT4T-0900', unit: 40_000, shopUnit: 44_000, source: 'quote', qty: 10 },
      { sku: 'PRT-SPK-IR', unit: 40_000, shopUnit: 62_000, source: 'quote', qty: 2 },
    ]);
    const [sub] = await db.select().from(s.orders).where(eq(s.orders.groupId, group!.id));
    expect(sub).toMatchObject({ status: 'placed', shippingPaise: 3_000 });

    const q = await getMyQuote(t(), ravi, code, 'en');
    expect(q).toMatchObject({ status: 'accepted', orderCode: r.orderCode });
    expect(q.currentOffer).toMatchObject({ version: 1, status: 'accepted' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'quote.accepted'));
    expect(audit).toHaveLength(1);
  });

  it('places exactly one order when two accepts race; the same key replays it', async () => {
    const { code } = await newQuote(ravi);
    await offer(code, 41_000);
    const k1 = key();
    const results = await Promise.allSettled([
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: k1, locale: 'en' }),
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ]);
    const ok = results.filter((x) => x.status === 'fulfilled');
    const failed = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed.map((f) => (f.reason as { code: string }).code)).toEqual(['QUOTE_CLOSED']);
    const [row] = await db
      .select({ id: s.quoteRequests.id })
      .from(s.quoteRequests)
      .where(eq(s.quoteRequests.code, code));
    expect(await db.$count(s.orderGroups, eq(s.orderGroups.quoteId, row!.id))).toBe(1);
    const replay = await acceptQuoteOffer(t(), {
      userId: ravi,
      code,
      offerVersion: 1,
      idempotencyKey: k1,
      locale: 'en',
    });
    expect(replay.replayed).toBe(true);
  });

  it('refuses an expired offer with 409', async () => {
    const { code } = await newQuote(ravi);
    await offer(code, 41_000);
    await db.execute(sql`
      update quote_offers set created_at = now() - interval '4 days', valid_until = now() - interval '1 minute'
      where quote_id = (select id from quote_requests where code = ${code})`);
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ status: 409, code: 'QUOTE_OFFER_EXPIRED' });
    expect((await getMyQuote(t(), ravi, code, 'en')).currentOffer?.expired).toBe(true);
    await closeAllOpen(ravi);
  });

  it('refuses before any offer and when the products ran out (nothing changes)', async () => {
    const { code } = await newQuote(ravi);
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ code: 'QUOTE_OFFER_STALE' });
    await offer(code, 41_000);
    await db.execute(sql`update shop_inventory set active = false`);
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_UNAVAILABLE' });
    await db.execute(sql`update shop_inventory set active = true`);
    expect((await getMyQuote(t(), ravi, code, 'en')).status).toBe('offered');
    await closeAllOpen(ravi);
  });
});

describe('closing', () => {
  it('lets the customer decline with a reason; the thread is then read-only', async () => {
    const { code } = await newQuote(ravi);
    const r = await declineQuote(t(), { userId: ravi, code, reasonCode: 'price_too_high' });
    expect(r.status).toBe('declined');
    const q = await getMyQuote(t(), ravi, code, 'en');
    expect(q).toMatchObject({ status: 'declined', reasonCode: 'price_too_high' });
    await expect(postCustomerQuoteMessage(t(), { userId: ravi, code, body: 'wait' })).rejects.toMatchObject({
      code: 'QUOTE_CLOSED',
    });
  });

  it('lets staff withdraw with a reason code and a message for the customer', async () => {
    const { code } = await newQuote(ravi);
    const { version } = await getAdminQuote(t(), ALL, code, 'en');
    await expect(
      withdrawQuote(t(), {
        scope: ALL,
        staffUserId: staff,
        code,
        expectedVersion: version + 5,
        reasonCode: 'cannot_supply',
        message: 'We cannot source these this month.',
      }),
    ).rejects.toMatchObject({ code: 'STALE_QUOTE' });
    const r = await withdrawQuote(t(), {
      scope: ALL,
      staffUserId: staff,
      code,
      expectedVersion: version,
      reasonCode: 'cannot_supply',
      message: 'We cannot source these this month.',
    });
    expect(r.status).toBe('withdrawn');
    expect(await getMyQuote(t(), ravi, code, 'en')).toMatchObject({
      reasonCode: 'cannot_supply',
      closingMessage: 'We cannot source these this month.',
    });
  });

  it('reopens talks when an offer runs out, and expires only quotes nobody wrote on', async () => {
    const offered = (await newQuote(ravi)).code;
    await offer(offered, 41_000);
    await db.execute(sql`
      update quote_offers set created_at = now() - interval '4 days', valid_until = now() - interval '1 minute'
      where quote_id = (select id from quote_requests where code = ${offered})`);
    const quiet = (await newQuote(ravi)).code;
    await db.execute(
      sql`update quote_requests set expires_at = now() - interval '1 minute' where code = ${quiet}`,
    );
    const fresh = (await newQuote(ravi)).code;

    const r = await expireQuotes(t());
    expect(r).toMatchObject({ offersExpired: 1, expired: 1, failed: [] });
    // The quote stays open: the customer can ask for a new offer in the chat.
    const reopened = await getMyQuote(t(), ravi, offered, 'en');
    expect(reopened).toMatchObject({ status: 'negotiating', reasonCode: null, currentOffer: null });
    expect(
      (await postCustomerQuoteMessage(t(), { userId: ravi, code: offered, body: 'Please send a new offer' }))
        .status,
    ).toBe('negotiating');
    expect(await getMyQuote(t(), ravi, quiet, 'en')).toMatchObject({
      status: 'expired',
      reasonCode: 'inactive',
    });
    expect((await getMyQuote(t(), ravi, fresh, 'en')).status).toBe('open');
    await closeAllOpen(ravi);
  });
});

describe('live updates', () => {
  it('pings the customer and the city staff who can read quotes', async () => {
    const { code } = await newQuote(ravi);
    const [row] = await db
      .select({ id: s.quoteRequests.id })
      .from(s.quoteRequests)
      .where(eq(s.quoteRequests.code, code));
    const pending = await db.execute(sql`select topic from live_outbox where topic = ${`quote:${row!.id}`}`);
    expect(pending.rows.length).toBeGreaterThan(0);
    const who = (await resolveLiveRecipients(t(), `quote:${row!.id}`)).map((r) => r.firebaseUid).sort();
    expect(who).toEqual(['fb-quote-ravi', 'fb-quote-staff']);
    await closeAllOpen(ravi);
  });
});

describe('review fixes 2026-11-14', () => {
  const keyring = loadKeyring({
    DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
    DATA_ENCRYPTION_KEY_ID: 'k1',
    DATA_INDEX_KEY: randomBytes(32).toString('base64'),
  });
  const shopId = async (name: string) =>
    (await db.select({ id: s.shops.id }).from(s.shops).where(eq(s.shops.name, name)))[0]!.id;
  const subOrder = async (groupCode: string) =>
    (
      await db
        .select()
        .from(s.orders)
        .where(eq(s.orders.code, `${groupCode}-1`))
    )[0]!;

  beforeAll(async () => {
    // The tests above reserved most of the demo stock: give every shop 50 free units again.
    await db.execute(sql`update shop_inventory set on_hand = reserved + 50`);
  });

  it('routes, confirms and delivers a quote order priced below the shop price (C1, I1)', async () => {
    const { code } = await newQuote(ravi);
    await offer(code, 40_000); // Sharma is paid ₹440; the customer pays ₹400
    const accepted = await acceptQuoteOffer(t(), {
      userId: ravi,
      code,
      offerVersion: 1,
      idempotencyKey: key(),
      locale: 'en',
    });
    const sharma = await shopId('Sharma Auto Parts');
    let order = await subOrder(accepted.orderCode);
    const ranked = await rankShopsForOrder(t(), order.id, 'en');
    expect(ranked.find((x) => x.shopId === sharma)).toMatchObject({ eligible: true, stockedItems: 1 });

    await routeOrder(t(), {
      scope: ALL,
      code: order.code,
      shopId: sharma,
      expectedVersion: order.version,
      staffUserId: staff,
    });
    // Shops see their own price, the total they are paid and what to collect on delivery — never our discount.
    const [offered] = (await listShopOrders(t(), [sharma], 'offers')).items.filter(
      (o) => o.code === order.code,
    );
    expect(offered?.items).toMatchObject([{ sku: 'CAS-ACT4T-0900', qty: 10, unitPaise: 44_000 }]);
    expect(offered).toMatchObject({ payoutPaise: 440_000, collectPaise: 400_000 });

    await acceptShopOffer(t(), {
      shopIds: [sharma],
      assignmentId: offered!.assignmentId!,
      staffUserId: staff,
    });
    const step = async (to: 'packed' | 'shipped' | 'out_for_delivery') =>
      advanceShopOrder(t(), {
        shopIds: [sharma],
        code: order.code,
        expectedVersion: (await subOrder(accepted.orderCode)).version,
        step: to === 'shipped' ? { to, mode: 'own' } : { to },
        staffUserId: staff,
        keyring,
      });
    await step('packed');
    await step('shipped');
    await step('out_for_delivery');
    order = await subOrder(accepted.orderCode);
    const [shipment] = await db.select().from(s.shipments).where(eq(s.shipments.orderId, order.id));
    const deliveryCode = await deliveryCodeFor(t(), keyring, shipment!.id);
    expect(
      await deliverShopOrder(t(), {
        shopIds: [sharma],
        code: order.code,
        deliveryCode: deliveryCode!,
        expectedVersion: order.version,
        staffUserId: staff,
        keyring,
      }),
    ).toMatchObject({ ok: true });
    expect((await subOrder(accepted.orderCode)).status).toBe('delivered');
  });

  it('refuses cash on delivery above the quote COD ceiling and changes nothing (I3)', async () => {
    const { code } = await newQuote(ravi);
    await db.insert(s.settings).values({ key: 'quotes.cod_cap_paise', value: 300_000 });
    await offer(code, 40_000); // ₹4,000 > ₹3,000
    await expect(
      acceptQuoteOffer(t(), { userId: ravi, code, offerVersion: 1, idempotencyKey: key(), locale: 'en' }),
    ).rejects.toMatchObject({ status: 422, code: 'QUOTE_COD_CAP', details: { capPaise: 300_000 } });
    expect((await getMyQuote(t(), ravi, code, 'en')).status).toBe('offered');
    await db.delete(s.settings).where(eq(s.settings.key, 'quotes.cod_cap_paise'));
    await closeAllOpen(ravi);
  });

  it('shows staff each line’s shop price and stock at the PIN, never the customer (I2)', async () => {
    const { code } = await newQuote(ravi, [
      { slug: OIL, qty: 10 },
      { slug: PLUG, qty: 2 },
    ]);
    const staffView = await getAdminQuote(t(), ALL, code, 'en');
    expect(staffView.lineItems.map((l) => [l.sku, l.costPaise, l.stock])).toEqual([
      ['CAS-ACT4T-0900', 44_000, 50],
      ['PRT-SPK-IR', 62_000, 50],
    ]);
    const mine = await getMyQuote(t(), ravi, code, 'en');
    expect(mine.lineItems.map((l) => [l.costPaise, l.stock])).toEqual([
      [null, null],
      [null, null],
    ]);
    await closeAllOpen(ravi);
  });

  it('asks staff to confirm a price below the shop price or under a tenth of list (I2)', async () => {
    const { code } = await newQuote(ravi);
    const send = async (unitPaise: number, confirmLowPrices: boolean) => {
      const q = await getAdminQuote(t(), ALL, code, 'en');
      return sendQuoteOffer(t(), {
        scope: ALL,
        staffUserId: staff,
        code,
        expectedVersion: q.version,
        lines: [{ lineNo: 1, unitPaise }],
        deliveryPaise: 0,
        validDays: 3,
        terms: null,
        confirmLowPrices,
      });
    };
    await expect(send(43_000, false)).rejects.toMatchObject({
      code: 'QUOTE_OFFER_CONFIRM_LOW',
      details: { belowCost: [1], belowTenthOfList: [] },
    });
    await expect(send(4_000, false)).rejects.toMatchObject({
      details: { belowCost: [1], belowTenthOfList: [1] },
    });
    expect((await send(45_000, false)).offerVersion).toBe(1);
    expect((await send(43_000, true)).offerVersion).toBe(2);
    await closeAllOpen(ravi);
  });

  it('refuses a quote from a customer who may not order or pay cash (minor)', async () => {
    const blocked = (await db.insert(s.users).values({ firebaseUid: 'fb-quote-blocked' }).returning())[0]!.id;
    await blockCustomer(t(), {
      userId: blocked,
      level: 'cod_only',
      reasonCode: 'cod_refused',
      note: null,
      endsAt: null,
      staffUserId: staff,
    });
    await expect(newQuote(blocked)).rejects.toMatchObject({ status: 403, code: 'QUOTE_COD_BLOCKED' });
  });

  it('reads the minimum for the PIN code’s city, else the global value (minor)', async () => {
    await db.insert(s.settings).values([
      { key: 'quotes.min_units', value: 12 },
      { key: 'quotes.min_units', value: 7, cityId },
    ]);
    expect((await quoteRules(t(), ravi, '492004')).minUnits).toBe(7);
    expect((await quoteRules(t(), ravi, null)).minUnits).toBe(12);
    await db.delete(s.settings).where(eq(s.settings.key, 'quotes.min_units'));
    expect((await quoteRules(t(), ravi, null)).minUnits).toBe(10);
  });

  it('dates the offer email in India time (minor)', async () => {
    const { code } = await newQuote(meera);
    await offer(code, 42_000);
    const [quote] = await db.select().from(s.quoteRequests).where(eq(s.quoteRequests.code, code));
    const [latest] = await db.select().from(s.quoteOffers).where(eq(s.quoteOffers.quoteId, quote!.id));
    const [mail] = await db
      .select({ payload: s.notificationOutbox.payload })
      .from(s.notificationOutbox)
      .where(eq(s.notificationOutbox.dedupeKey, `quote_offer:${quote!.id}:v1:email`));
    expect(mail?.payload).toMatchObject({ validUntil: istDateString(latest!.validUntil) });
    await closeAllOpen(meera);
  });

  it('keeps the thread append-only: a user who wrote messages cannot be hard-deleted (minor)', async () => {
    const writer = (await db.insert(s.users).values({ firebaseUid: 'fb-quote-writer' }).returning())[0]!.id;
    const [q] = await db.select({ id: s.quoteRequests.id }).from(s.quoteRequests).limit(1);
    await db
      .insert(s.quoteMessages)
      .values({ quoteId: q!.id, authorUserId: writer, authorRole: 'staff', body: 'Hi' });
    const err = await db
      .delete(s.users)
      .where(eq(s.users.id, writer))
      .then(() => null)
      .catch((e: unknown) => e);
    // A foreign-key refusal, not the append-only trigger tripping over ON DELETE SET NULL.
    expect(pgCode(err)).toBe('23503');
  });
});
