/**
 * Admin analytics (spec 08 "Analytics"): read-only aggregates over the order, service and event tables. Covers IST
 * day bucketing (an order at 00:30 IST belongs to that IST day), the city filter, unpaid online checkouts kept out of
 * orders, GMV without cancelled/rejected parts, new vs repeat customers, the funnel, top products and searches (two
 * visitors at least), areas, shop acceptance and workshop performance, and the live Overview queues.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { resolveAnalyticsRange, type AnalyticsRange } from '@mechdost/shared/analytics-range';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { adminOverviewCounts, analyticsCities, analyticsDashboard, type Tx } from '../src/repo';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const P: Record<string, string> = {};
let n = 0;

const NOW = new Date('2026-11-14T06:00:00Z');
function range(from: string, to: string): AnalyticsRange {
  const r = resolveAnalyticsRange({ from, to }, NOW);
  if (!r.ok) throw new Error(r.code);
  return r;
}
const NOV = () => range('2026-11-01', '2026-11-10');

interface Part {
  status: string;
  totalPaise: number;
  pincode?: string;
  reason?: string;
  variant: string;
  qty: number;
}

/** One checkout (order group) with its parts, placed at `at`. */
async function group(input: {
  userId: string;
  cityId: string;
  at: string;
  method: 'cod' | 'online';
  paymentStatus: string;
  parts: Part[];
}): Promise<string[]> {
  n += 1;
  const code = `MD-RPR-2026-AN${String(n).padStart(4, '0')}`;
  const total = input.parts.reduce((sum, p) => sum + p.totalPaise, 0);
  const [g] = await db
    .insert(s.orderGroups)
    .values({
      code,
      userId: input.userId,
      cityId: input.cityId,
      paymentMethod: input.method,
      paymentStatus: input.paymentStatus,
      subtotalPaise: total,
      totalPaise: total,
      idempotencyKey: `analytics-order-${String(n).padStart(8, '0')}`,
      createdAt: new Date(input.at),
    })
    .returning();
  const ids: string[] = [];
  for (const [i, p] of input.parts.entries()) {
    const shopless = ['placed', 'awaiting_shop', 'needs_rerouting', 'cancelled', 'rejected'].includes(
      p.status,
    );
    const [o] = await db
      .insert(s.orders)
      .values({
        groupId: g!.id,
        subNo: i + 1,
        code: `${code}-${String(i + 1)}`,
        userId: input.userId,
        cityId: input.cityId,
        status: p.status,
        shopId: shopless ? null : P.shop!,
        shippingAddress: { line1: 'Sarona', pincode: p.pincode ?? '492001' },
        pincode: p.pincode ?? '492001',
        subtotalPaise: p.totalPaise,
        totalPaise: p.totalPaise,
        placedAt: new Date(input.at),
        statusReasonCode: p.reason ?? null,
        customerMessage: p.status === 'rejected' ? 'Sorry, no shop can supply this.' : null,
      })
      .returning();
    await db.insert(s.orderItems).values({
      orderId: o!.id,
      variantId: p.variant,
      title: 'Item',
      sku: 'SKU',
      hsn: '2710',
      gstRateBp: 1800,
      unitPaise: Math.floor(p.totalPaise / p.qty),
      qty: p.qty,
      taxablePaise: p.totalPaise,
      totalPaise: p.totalPaise,
    });
    ids.push(o!.id);
  }
  return ids;
}

async function offer(orderId: string, at: string, status: string, answeredAfterS: number | null) {
  const offered = new Date(at);
  await db.insert(s.orderAssignments).values({
    orderId,
    shopId: P.shop!,
    status,
    offeredAt: offered,
    expiresAt: new Date(offered.getTime() + 15 * 60_000),
    respondedAt: answeredAfterS === null ? null : new Date(offered.getTime() + answeredAfterS * 1000),
    declineReason: status === 'declined' ? 'out_of_stock' : null,
  });
}

async function service(input: {
  cityId: string;
  at: string;
  status: string;
  pincode: string;
  workshopId: string | null;
  reason?: string;
}): Promise<string> {
  n += 1;
  const received = ![
    'requested',
    'needs_routing',
    'awaiting_workshop',
    'proposed',
    'confirmed',
    'cancelled',
  ].includes(input.status);
  const [r] = await db
    .insert(s.serviceRequests)
    .values({
      code: `SR-RPR-2026-AN${String(n).padStart(4, '0')}`,
      userId: f.customer,
      cityId: input.cityId,
      workshopId: input.workshopId,
      routingMode: 'chosen',
      vehicleType: '2W',
      vehicleText: 'Honda Activa 6G',
      vehicleKey: 'honda activa 6g',
      services: [],
      pincode: input.pincode,
      preferredDate: '2026-11-20',
      preferredSlot: 'morning',
      status: input.status,
      statusReasonCode: input.reason ?? null,
      odometerKm: received ? 12_400 : null,
      receivedAt: received ? new Date(input.at) : null,
      idempotencyKey: `analytics-service-${String(n).padStart(8, '0')}`,
      createdAt: new Date(input.at),
    })
    .returning();
  return r!.id;
}

async function event(input: { event: string; at: string; anon: string; props: Record<string, unknown> }) {
  await db.execute(sql`insert into events (occurred_at, source, event, anonymous_id, session_id, props)
    values (${input.at}::timestamptz, 'web', ${input.event}, ${input.anon}, ${`s-${input.anon}`},
      ${JSON.stringify(input.props)}::jsonb)`);
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  await db
    .update(s.pincodes)
    .set({ locality: 'Shankar Nagar', localityHi: 'शंकर नगर' })
    .where(eq(s.pincodes.pincode, '492001'));
  const [state] = await db.select().from(s.states).limit(1);
  const [shop] = await db
    .insert(s.shops)
    .values({
      name: 'Sharma Auto Parts',
      nameHi: 'शर्मा ऑटो पार्ट्स',
      phone: '+919800000000',
      addressLine: 'Raipur',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: { lng: 81.641, lat: 21.227 },
      status: 'approved',
    })
    .returning();
  P.shop = shop!.id;
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'lubricants', name: 'Lubricants', sort: 1 })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'castrol', name: 'Castrol' }).returning();
  for (const [slug, name, nameHi] of [
    ['castrol-activ', 'Castrol Activ 4T Engine Oil', 'कैस्ट्रॉल एक्टिव 4T इंजन ऑयल'],
    ['brake-pad', 'Brake Pad Set', 'ब्रेक पैड सेट'],
  ] as const) {
    const [p] = await db
      .insert(s.products)
      .values({
        slug,
        name,
        nameHi,
        brandId: brand!.id,
        categoryId: cat!.id,
        hsn: '2710',
        gstRateBp: 1800,
        status: 'live',
      })
      .returning();
    const [v] = await db
      .insert(s.productVariants)
      .values({ productId: p!.id, sku: `SKU-${slug}`, mrpPaise: 60000 })
      .returning();
    P[slug] = v!.id;
  }
  const oil = P['castrol-activ']!;
  const pad = P['brake-pad']!;

  // F: the customer's earlier order (before the range) → the customer is not new, and is a repeat customer.
  await group({
    userId: f.customer,
    cityId: f.raipur,
    at: '2026-10-01T06:00:00Z',
    method: 'cod',
    paymentStatus: 'cod_pending',
    parts: [{ status: 'delivered', totalPaise: 10000, variant: oil, qty: 1 }],
  });
  // A: 2026-11-01 IST, delivered; the shop declined once (60 s offer later accepted).
  const [a] = await group({
    userId: f.customer,
    cityId: f.raipur,
    at: '2026-11-01T04:00:00Z',
    method: 'cod',
    paymentStatus: 'cod_pending',
    parts: [{ status: 'delivered', totalPaise: 50000, variant: oil, qty: 2 }],
  });
  await offer(a!, '2026-11-01T04:05:00Z', 'declined', 30);
  await offer(a!, '2026-11-01T04:10:00Z', 'accepted', 60);
  // B: online and paid at 00:30 IST on 11 November (19:00 UTC on the 10th) → belongs to 11 November.
  await group({
    userId: f.customer,
    cityId: f.raipur,
    at: '2026-11-10T19:00:00Z',
    method: 'online',
    paymentStatus: 'paid',
    parts: [{ status: 'placed', totalPaise: 20000, variant: pad, qty: 1 }],
  });
  // C: 23:59 IST on 5 November; one part cancelled, the other confirmed (accepted after 120 s).
  const [, c2] = await group({
    userId: f.other,
    cityId: f.raipur,
    at: '2026-11-05T18:29:00Z',
    method: 'cod',
    paymentStatus: 'cod_pending',
    parts: [
      { status: 'cancelled', totalPaise: 15000, reason: 'changed_mind', variant: oil, qty: 1 },
      { status: 'confirmed', totalPaise: 30000, variant: pad, qty: 1 },
    ],
  });
  await offer(c2!, '2026-11-05T18:40:00Z', 'accepted', 120);
  // D: online checkout whose payment failed → not an order.
  await group({
    userId: f.other,
    cityId: f.raipur,
    at: '2026-11-06T06:00:00Z',
    method: 'online',
    paymentStatus: 'failed',
    parts: [{ status: 'placed', totalPaise: 9000, variant: oil, qty: 1 }],
  });
  // H: rejected (the offer timed out), PIN 492004.
  const [h] = await group({
    userId: f.other,
    cityId: f.raipur,
    at: '2026-11-07T06:00:00Z',
    method: 'cod',
    paymentStatus: 'cod_pending',
    parts: [
      {
        status: 'rejected',
        totalPaise: 12000,
        reason: 'all_shops_declined',
        pincode: '492004',
        variant: oil,
        qty: 1,
      },
    ],
  });
  await offer(h!, '2026-11-07T06:05:00Z', 'expired', null);
  // E: Bhilai.
  await group({
    userId: f.other,
    cityId: f.bhilai,
    at: '2026-11-03T06:00:00Z',
    method: 'cod',
    paymentStatus: 'cod_pending',
    parts: [{ status: 'placed', totalPaise: 70000, pincode: '490001', variant: oil, qty: 1 }],
  });

  const w = await addWorkshop(db, f);
  P.workshop = w.id;
  await service({
    cityId: f.raipur,
    at: '2026-11-02T06:00:00Z',
    status: 'completed',
    pincode: '492001',
    workshopId: w.id,
  });
  await service({
    cityId: f.raipur,
    at: '2026-11-03T06:00:00Z',
    status: 'cancelled',
    reason: 'changed_mind',
    pincode: '492001',
    workshopId: w.id,
  });
  const s3 = await service({
    cityId: f.raipur,
    at: '2026-11-04T06:00:00Z',
    status: 'confirmed',
    pincode: '492004',
    workshopId: w.id,
  });
  await db.insert(s.serviceProposals).values({
    requestId: s3,
    workshopId: w.id,
    proposedDate: '2026-11-05',
    slot: 'morning',
    lowPaise: 50000,
    highPaise: 90000,
    status: 'accepted',
    createdAt: new Date('2026-11-04T06:30:00Z'),
  });
  await service({
    cityId: f.bhilai,
    at: '2026-11-04T06:00:00Z',
    status: 'needs_routing',
    pincode: '490001',
    workshopId: null,
  });

  // Web events: v1 views the oil twice, adds to cart, starts checkout; v2 views the home page and the oil.
  await event({
    event: 'page_view',
    at: '2026-11-02T05:00:00Z',
    anon: 'v1',
    props: { path: '/shop/castrol-activ', locale: 'en' },
  });
  await event({
    event: 'page_view',
    at: '2026-11-02T05:01:00Z',
    anon: 'v1',
    props: { path: '/shop/castrol-activ', locale: 'en' },
  });
  await event({
    event: 'add_to_cart',
    at: '2026-11-02T05:02:00Z',
    anon: 'v1',
    props: { slug: 'castrol-activ', qty: 1 },
  });
  await event({
    event: 'begin_checkout',
    at: '2026-11-02T05:03:00Z',
    anon: 'v1',
    props: { items: 1, valuePaise: 50000 },
  });
  await event({
    event: 'page_view',
    at: '2026-11-02T07:00:00Z',
    anon: 'v2',
    props: { path: '/', locale: 'hi' },
  });
  await event({
    event: 'page_view',
    at: '2026-11-03T07:00:00Z',
    anon: 'v2',
    props: { path: '/shop/castrol-activ', locale: 'hi' },
  });
  // Searches: two visitors each for "engine oil" (a product matches) and "xyzzy" (nothing does); one for a phrase
  // only one visitor typed (never shown: k-anonymity of 2).
  await event({
    event: 'search',
    at: '2026-11-02T05:00:00Z',
    anon: 'v1',
    props: { query: 'Engine Oil ', source: 'shop' },
  });
  await event({
    event: 'search',
    at: '2026-11-03T05:00:00Z',
    anon: 'v2',
    props: { query: 'engine oil', source: 'shop' },
  });
  await event({
    event: 'search',
    at: '2026-11-03T05:01:00Z',
    anon: 'v2',
    props: { query: 'engine oil', source: 'home' },
  });
  await event({
    event: 'search',
    at: '2026-11-02T05:05:00Z',
    anon: 'v1',
    props: { query: 'xyzzy', source: 'shop' },
  });
  await event({
    event: 'search',
    at: '2026-11-03T05:05:00Z',
    anon: 'v2',
    props: { query: 'xyzzy', source: 'shop' },
  });
  await event({
    event: 'search',
    at: '2026-11-03T05:06:00Z',
    anon: 'v1',
    props: { query: 'ravi kumar', source: 'shop' },
  });
  // 00:30 IST on 11 November: outside a range ending on the 10th.
  await event({
    event: 'page_view',
    at: '2026-11-10T19:00:00Z',
    anon: 'v3',
    props: { path: '/', locale: 'en' },
  });
});

afterAll(async () => {
  await client.close();
});

describe('analytics dashboard', () => {
  it('counts orders, GMV without cancelled/rejected parts, payment split and customers in the city', async () => {
    const d = await analyticsDashboard(t(), { cityIds: [f.raipur], range: NOV(), traffic: false });
    expect(d.kpis).toMatchObject({
      ordersPlaced: 3,
      gmvPaise: 80000,
      aovPaise: 40000,
      codOrders: 3,
      onlineOrders: 0,
      paymentsNotCompleted: 1,
      cancelled: 1,
      cancelReasons: [{ code: 'changed_mind', count: 1 }],
      rejected: 1,
      rejectReasons: [{ code: 'all_shops_declined', count: 1 }],
      customers: 2,
      newCustomers: 1,
      repeatCustomers: 2,
      serviceRequests: 3,
      bookingsConfirmed: 2,
      bookingsCompleted: 1,
      bookingsCancelled: 1,
      offersAnswered: 4,
      offersAccepted: 2,
      medianSecondsToAccept: 90,
    });
  });

  it('buckets by IST day: 00:30 IST on the 11th is the 11th, 23:59 IST on the 5th is the 5th', async () => {
    const d = await analyticsDashboard(t(), { cityIds: [f.raipur], range: NOV(), traffic: false });
    expect(d.daily).toHaveLength(10);
    expect(d.daily.find((x) => x.date === '2026-11-05')).toEqual({
      date: '2026-11-05',
      visitors: null,
      orders: 1,
      gmvPaise: 30000,
      bookings: 0,
    });
    expect(d.daily.find((x) => x.date === '2026-11-01')).toMatchObject({ orders: 1, gmvPaise: 50000 });
    expect(d.daily.find((x) => x.date === '2026-11-02')).toMatchObject({ orders: 0, bookings: 1 });
    expect(d.daily.reduce((sum, x) => sum + x.orders, 0)).toBe(3);

    const eleventh = await analyticsDashboard(t(), {
      cityIds: [f.raipur],
      range: range('2026-11-11', '2026-11-11'),
      traffic: true,
    });
    expect(eleventh.kpis).toMatchObject({ ordersPlaced: 1, onlineOrders: 1, gmvPaise: 20000 });
    expect(eleventh.daily).toEqual([
      { date: '2026-11-11', visitors: 1, orders: 1, gmvPaise: 20000, bookings: 0 },
    ]);
  });

  it('keeps to the cities asked for; an empty scope sees nothing; "all" sees every city', async () => {
    const bhilai = await analyticsDashboard(t(), { cityIds: [f.bhilai], range: NOV(), traffic: false });
    expect(bhilai.kpis).toMatchObject({ ordersPlaced: 1, gmvPaise: 70000, serviceRequests: 1, customers: 1 });
    expect(bhilai.workshops).toEqual([]);
    const none = await analyticsDashboard(t(), { cityIds: [], range: NOV(), traffic: false });
    expect(none.kpis).toMatchObject({ ordersPlaced: 0, gmvPaise: 0, aovPaise: null, serviceRequests: 0 });
    expect(none.topOrdered).toEqual([]);
    const all = await analyticsDashboard(t(), { cityIds: 'all', range: NOV(), traffic: false });
    expect(all.kpis).toMatchObject({ ordersPlaced: 4, gmvPaise: 150000, serviceRequests: 4 });
  });

  it('reports traffic, the funnel, top viewed products and searches only when traffic is asked for', async () => {
    const without = await analyticsDashboard(t(), { cityIds: [f.raipur], range: NOV(), traffic: false });
    expect(without.traffic).toBeNull();
    expect(without.topViewed).toBeNull();
    expect(without.topSearches).toBeNull();
    expect(without.funnel.map((x) => x.step)).toEqual(['order_placed', 'order_delivered']);

    const d = await analyticsDashboard(t(), { cityIds: [f.raipur], range: NOV(), traffic: true });
    expect(d.traffic).toEqual({
      visitors: 2,
      sessions: 2,
      productViews: 3,
      searches: 6,
      cartVisitors: 1,
      checkoutVisitors: 1,
    });
    expect(d.funnel).toEqual([
      { step: 'product_view', count: 2 },
      { step: 'add_to_cart', count: 1 },
      { step: 'checkout_started', count: 1 },
      { step: 'order_placed', count: 3 },
      { step: 'order_delivered', count: 1 },
    ]);
    expect(d.daily.find((x) => x.date === '2026-11-02')?.visitors).toBe(2);
    expect(d.daily.find((x) => x.date === '2026-11-03')?.visitors).toBe(1);
    expect(d.daily.find((x) => x.date === '2026-11-04')?.visitors).toBe(0);
    expect(d.topViewed).toEqual([
      {
        slug: 'castrol-activ',
        name: 'Castrol Activ 4T Engine Oil',
        nameHi: 'कैस्ट्रॉल एक्टिव 4T इंजन ऑयल',
        views: 3,
      },
    ]);
    expect(d.topSearches).toEqual([
      { query: 'engine oil', count: 3, matches: true },
      { query: 'xyzzy', count: 2, matches: false },
    ]);
  });

  it('ranks ordered products, PIN areas, shops and workshops', async () => {
    const d = await analyticsDashboard(t(), { cityIds: [f.raipur], range: NOV(), traffic: false });
    expect(d.topOrdered).toEqual([
      {
        slug: 'castrol-activ',
        name: 'Castrol Activ 4T Engine Oil',
        nameHi: 'कैस्ट्रॉल एक्टिव 4T इंजन ऑयल',
        orders: 1,
        units: 2,
      },
      { slug: 'brake-pad', name: 'Brake Pad Set', nameHi: 'ब्रेक पैड सेट', orders: 1, units: 1 },
    ]);
    expect(d.areas).toEqual([
      { pincode: '492001', locality: 'Shankar Nagar', localityHi: 'शंकर नगर', orders: 2, bookings: 2 },
      { pincode: '492004', locality: null, localityHi: null, orders: 1, bookings: 1 },
    ]);
    expect(d.shops).toEqual([
      {
        id: P.shop,
        name: 'Sharma Auto Parts',
        nameHi: 'शर्मा ऑटो पार्ट्स',
        offers: 4,
        accepted: 2,
        declined: 1,
        expired: 1,
        medianSecondsToAccept: 90,
      },
    ]);
    expect(d.workshops).toEqual([
      expect.objectContaining({
        id: P.workshop,
        requests: 3,
        confirmed: 2,
        completed: 1,
        cancelled: 1,
        medianMinutesToPropose: 30,
      }),
    ]);
  });

  it('lists the cities in scope for the picker', async () => {
    expect((await analyticsCities(t(), { all: true })).map((c) => c.code)).toEqual(['BHI', 'RPR']);
    expect(await analyticsCities(t(), { all: false, cityIds: [f.raipur] })).toEqual([
      { id: f.raipur, code: 'RPR', name: 'Raipur', nameHi: null },
    ]);
  });
});

describe('admin overview queues', () => {
  it('counts live queues per permission scope; null when the permission is missing', async () => {
    const counts = await adminOverviewCounts(t(), {
      now: NOW,
      scopes: {
        orders: { all: false, cityIds: [f.raipur] },
        service: { all: true },
        tickets: null,
        reviews: null,
        applications: null,
        prices: null,
        analytics: { all: false, cityIds: [f.raipur] },
      },
    });
    // Raipur: B placed and paid (needs routing), D unpaid online (not shown), C part 2 confirmed (in progress).
    expect(counts).toEqual({
      ordersNeedRouting: 1,
      ordersAwaitingShop: 0,
      ordersInProgress: 1,
      servicesNeedRouting: 1,
      ticketsOpen: null,
      reviewsPending: null,
      applicationsPending: null,
      priceRequestsPending: null,
      ordersToday: 0,
      gmvTodayPaise: 0,
    });
  });
});
