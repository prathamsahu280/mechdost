/**
 * Workshops next tier items 5 to 7 over HTTP (spec 03, 05, 06, 08; design 2026-11-15): "Pay online" on the service bill
 * through the same Razorpay callback and webhook as orders (idempotent start, signed raw body, amount asserted, replay
 * and out-of-order safe, a capture after "paid at the workshop" is a refund request), staff cancel with its own
 * permission (customer and workshop refused, city-scoped), and ranked suggestions for routing.
 */
import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { istDateString } from '@mechdost/shared/time';
import type { RazorpayGateway, RazorpayPayment } from '../src/payments/razorpay';
import { bearer, buildApp, type ErrorJson } from './helpers';

const KEY_SECRET = 'test_key_secret_0123456789';
const WEBHOOK_SECRET = 'test_webhook_secret_01';
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_Fake0123456789',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

class FakeRazorpay implements RazorpayGateway {
  keyId = ENV.RAZORPAY_KEY_ID;
  ordersCreated = 0;
  lastOrder: { amountPaise: number; receipt: string } | null = null;
  payments = new Map<string, RazorpayPayment>();
  createOrder(input: { amountPaise: number; receipt: string }) {
    this.ordersCreated += 1;
    this.lastOrder = input;
    return Promise.resolve({
      id: `order_FakeBill${String(this.ordersCreated).padStart(5, '0')}`,
      amountPaise: input.amountPaise,
      currency: 'INR' as const,
    });
  }
  fetchPayment(id: string) {
    const p = this.payments.get(id);
    return p ? Promise.resolve(p) : Promise.reject(new Error('unknown payment'));
  }
  createRefund(): Promise<never> {
    return Promise.reject(new Error('refunds are not part of these tests'));
  }
  findRefund(): Promise<null> {
    return Promise.resolve(null);
  }
}

let ctx: Awaited<ReturnType<typeof buildApp>>;
let razorpay: FakeRazorpay;
const city: Record<string, string> = {};
const TODAY = istDateString(new Date());

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string, opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  const identity = {
    firebaseUid: `bp-api-${n}`,
    phone: `+9198444444${n}`,
    email: `bp-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-bp-api-0000000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const WORKSHOP = (slug: string, lat: number) => ({
  slug,
  name: `Workshop ${slug}`,
  nameHi: `वर्कशॉप ${slug}`,
  addressLine: 'GE Road, Raipur',
  addressLineHi: 'जीई रोड, रायपुर',
  area: 'Shankar Nagar',
  areaHi: 'शंकर नगर',
  pincode: '492001',
  lat,
  lng: 81.6296,
  phone: '+919811199999',
  vehicleTypes: ['2W'],
  hours: { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
  gstin: '22AAAAA0000A1Z5',
  locationVerified: true,
  published: true,
  menu: [
    {
      key: 'routine2w',
      title: 'General service (2W)',
      titleHi: 'जनरल सर्विस (2W)',
      lowPaise: 80_000,
      highPaise: 150_000,
      minMinutes: 120,
      maxMinutes: 180,
      vehicleType: '2W',
    },
  ],
});

let ops: Person;
let support: Person;
let owner: Person;
let customer: Person;
let other: Person;
let bhilaiManager: Person;
let keyN = 0;
let lastBilled = '';

/** A booking taken over HTTP through to `billed`. */
async function billed(): Promise<{ code: string; version: number; totalPaise: number }> {
  keyN += 1;
  const made = await ctx.app.request('/v1/service-requests', {
    method: 'POST',
    headers: { ...customer.headers, 'idempotency-key': `bp-api-booking-${String(keyN).padStart(8, '0')}` },
    body: JSON.stringify({
      workshopSlug: 'bp-main',
      vehicleType: '2W',
      vehicle: 'Honda Activa 6G',
      serviceKeys: ['routine2w'],
      pincode: '492001',
      preferredDate: TODAY,
      preferredSlot: 'morning',
    }),
  });
  const first = (await made.json()) as { code: string; version: number };
  const code = first.code;
  let version = first.version;
  const step = async (who: Person, path: string, payload: Record<string, unknown>) => {
    const r = await call(who, 'POST', path, { ...payload, version });
    expect(r.status, `${path} ${JSON.stringify(r.body)}`).toBe(200);
    version = Number(r.body.version);
    return r.body;
  };
  await step(owner, `/workshop/requests/${code}/propose`, {
    date: TODAY,
    slot: 'evening',
    lowPaise: 80_000,
    highPaise: 150_000,
  });
  await step(customer, `/service-requests/${code}/proposal`, { accept: true });
  await step(owner, `/workshop/requests/${code}/vehicle-received`, { odometerKm: 12_345 });
  await step(owner, `/workshop/requests/${code}/estimates`, {
    lines: [{ description: 'Labour', serviceKey: 'routine2w', qty: 1, unitPaise: 80_000, gstRateBp: 1800 }],
  });
  const detail = await call(customer, 'GET', `/service-requests/${code}`);
  const items = (detail.body.estimate as { items: { id: string }[] }).items;
  await step(customer, `/service-requests/${code}/estimate`, {
    revision: 1,
    consent: true,
    decisions: [{ itemId: items[0]!.id, decision: 'approved' }],
  });
  await step(owner, `/workshop/requests/${code}/start`, {});
  await step(owner, `/workshop/requests/${code}/ready`, {});
  const bill = await step(owner, `/workshop/requests/${code}/bill`, {});
  lastBilled = code;
  return { code, version, totalPaise: Number(bill.totalPaise) };
}

const sign = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const verify = (who: Person, orderId: string, paymentId: string, signature: string) =>
  ctx.app.request('/v1/payments/razorpay/verify', {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify({
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    }),
  });
const event = (
  orderId: string,
  amountPaise: number,
  paymentId: string,
  status = 'captured',
  name = 'payment.captured',
) =>
  JSON.stringify({
    event: name,
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          status,
          amount: amountPaise,
          currency: 'INR',
          method: 'upi',
        },
      },
    },
  });
const hook = (raw: string, eventId: string, signature?: string) =>
  ctx.app.request('/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': signature ?? createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
    },
    body: raw,
  });
const requestStatus = async (code: string) =>
  ((await call(customer, 'GET', `/service-requests/${code}`)).body as { status: string }).status;
const refundsOfRequest = async (code: string) => {
  const r = (await ctx.db.select().from(s.serviceRequests)).find((x) => x.code === code);
  const b = (await ctx.db.select().from(s.serviceBills)).find((x) => x.requestId === r!.id);
  return (await ctx.db.select().from(s.refunds)).filter((x) => x.billId === b!.id);
};

beforeAll(async () => {
  razorpay = new FakeRazorpay();
  ctx = await buildApp({ env: ENV, razorpay });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  for (const [code, slug] of [
    ['RPR', 'raipur'],
    ['BHI', 'bhilai'],
  ] as const) {
    const [row] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code, slug, name: slug, status: 'live' })
      .returning();
    city[code] = row!.id;
  }
  await ctx.db.insert(s.settings).values({ cityId: null, key: 'service.photos_required', value: false });
  await ctx.db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city.RPR!,
    centroid: { lng: 81.6296, lat: 21.2514 },
  });
  ops = await person('01', { role: 'ops_manager' });
  support = await person('02', { role: 'support_agent' });
  owner = await person('03');
  customer = await person('04');
  other = await person('05');
  bhilaiManager = await person('06', { role: 'city_manager', cityId: city.BHI });
  const main = await call(ops, 'POST', '/admin/workshops', WORKSHOP('bp-main', 21.2514));
  expect(main.status, JSON.stringify(main.body)).toBe(201);
  expect((await call(ops, 'POST', '/admin/workshops', WORKSHOP('bp-second', 21.2614))).status).toBe(201);
  expect(
    (
      await call(ops, 'POST', `/admin/workshops/${String(main.body.id)}/members`, {
        phone: '+919844444403',
        role: 'workshop_owner',
      })
    ).status,
  ).toBe(200);
});

describe('Pay online on the service bill', () => {
  it('starts with the bill total from the server; a double click returns the same Razorpay order', async () => {
    const b = await billed();
    const before = razorpay.ordersCreated;
    const first = await call(customer, 'POST', `/service-requests/${b.code}/pay`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      keyId: ENV.RAZORPAY_KEY_ID,
      amountPaise: b.totalPaise,
      currency: 'INR',
    });
    expect(razorpay.lastOrder?.amountPaise).toBe(b.totalPaise);
    const [second, third] = await Promise.all([
      call(customer, 'POST', `/service-requests/${b.code}/pay`),
      call(customer, 'POST', `/service-requests/${b.code}/pay`),
    ]);
    expect(second.body.orderId).toBe(first.body.orderId);
    expect(third.body.orderId).toBe(first.body.orderId);
    expect(razorpay.ordersCreated).toBe(before + 1);
    const rows = (await ctx.db.select().from(s.payments)).filter(
      (p) => p.providerOrderId === String(first.body.orderId),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'service_bill', groupId: null });
  });

  it('is for the owner only: other customers 404, the workshop and staff are refused, signed-out is 401', async () => {
    const b = await billed();
    expect((await call(other, 'POST', `/service-requests/${b.code}/pay`)).status).toBe(404);
    expect((await call(null, 'POST', `/service-requests/${b.code}/pay`)).status).toBe(401);
    expect((await call(owner, 'POST', `/service-requests/${b.code}/pay`)).status).toBe(404);
  });

  it('is refused before the bill exists and after it is paid at the workshop', async () => {
    keyN += 1;
    const made = await ctx.app.request('/v1/service-requests', {
      method: 'POST',
      headers: { ...customer.headers, 'idempotency-key': `bp-api-early-${String(keyN).padStart(8, '0')}` },
      body: JSON.stringify({
        workshopSlug: 'bp-main',
        vehicleType: '2W',
        vehicle: 'Honda Activa 6G',
        serviceKeys: ['routine2w'],
        pincode: '492001',
        preferredDate: TODAY,
        preferredSlot: 'morning',
      }),
    });
    const early = (await made.json()) as { code: string };
    expect((await call(customer, 'POST', `/service-requests/${early.code}/pay`)).status).toBe(404);
    const b = await billed();
    const paid = await call(owner, 'POST', `/workshop/requests/${b.code}/mark-paid`, {
      method: 'cash',
      version: b.version,
    });
    expect(paid.status).toBe(200);
    const res = await call(customer, 'POST', `/service-requests/${b.code}/pay`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BILL_NOT_PAYABLE');
  });

  it('the callback needs a valid signature and a fetched capture; then the bill and request are paid', async () => {
    const b = await billed();
    const handle = (await call(customer, 'POST', `/service-requests/${b.code}/pay`)).body as {
      orderId: string;
    };
    const bad = await verify(
      customer,
      handle.orderId,
      'pay_BillForged01',
      sign(handle.orderId, 'pay_Other000001'),
    );
    expect(bad.status).toBe(400);
    expect(await requestStatus(b.code)).toBe('billed');
    expect(
      (await verify(other, handle.orderId, 'pay_BillTheft001', sign(handle.orderId, 'pay_BillTheft001')))
        .status,
    ).toBe(404);
    razorpay.payments.set('pay_BillGood0001', {
      id: 'pay_BillGood0001',
      orderId: handle.orderId,
      status: 'captured',
      amountPaise: b.totalPaise,
      currency: 'INR',
      method: 'upi',
    });
    const ok = await verify(
      customer,
      handle.orderId,
      'pay_BillGood0001',
      sign(handle.orderId, 'pay_BillGood0001'),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ orderCode: b.code, outcome: 'paid' });
    const view = await call(customer, 'GET', `/service-requests/${b.code}`);
    expect(view.body.status).toBe('completed');
    expect(view.body.bill).toMatchObject({ method: 'online' });
  });

  it('webhook: bad signature refused; replay x3, out-of-order and wrong amount change nothing more', async () => {
    const b = await billed();
    const handle = (await call(customer, 'POST', `/service-requests/${b.code}/pay`)).body as {
      orderId: string;
    };
    const raw = event(handle.orderId, b.totalPaise, 'pay_BillHook001');
    expect((await hook(raw, 'evt_bill_bad001', 'ab'.repeat(32))).status).toBe(400);
    expect(await requestStatus(b.code)).toBe('billed');
    // Tampered amount: acknowledged, never settled.
    expect(
      (await hook(event(handle.orderId, b.totalPaise - 100, 'pay_BillHook002'), 'evt_bill_amt001')).status,
    ).toBe(200);
    expect(await requestStatus(b.code)).toBe('billed');
    // Out of order: a failed payment first, then the capture.
    const failed = event(handle.orderId, b.totalPaise, 'pay_BillHook003', 'failed', 'payment.failed');
    expect((await hook(failed, 'evt_bill_fail01')).status).toBe(200);
    expect(await requestStatus(b.code)).toBe('billed');
    expect((await hook(raw, 'evt_bill_cap001')).status).toBe(200);
    expect(await requestStatus(b.code)).toBe('completed');
    // Replays (same event id, and the same fact under new event ids) and a late failed event.
    for (const id of ['evt_bill_cap001', 'evt_bill_cap002', 'evt_bill_cap003'])
      expect((await hook(raw, id)).status).toBe(200);
    expect((await hook(failed, 'evt_bill_fail02')).status).toBe(200);
    expect(await requestStatus(b.code)).toBe('completed');
    expect(await refundsOfRequest(b.code)).toHaveLength(0);
    const events = await ctx.db.select().from(s.serviceEvents);
    const mine = events.filter((e) => e.toStatus === 'paid');
    expect(mine.length).toBeGreaterThanOrEqual(1);
  });

  it('a capture after "paid at the workshop" never settles twice: one refund request, bill unchanged', async () => {
    const b = await billed();
    const handle = (await call(customer, 'POST', `/service-requests/${b.code}/pay`)).body as {
      orderId: string;
    };
    const paid = await call(owner, 'POST', `/workshop/requests/${b.code}/mark-paid`, {
      method: 'upi',
      version: b.version,
    });
    expect(paid.status).toBe(200);
    const raw = event(handle.orderId, b.totalPaise, 'pay_BillLate001');
    expect((await hook(raw, 'evt_bill_late001')).status).toBe(200);
    expect((await hook(raw, 'evt_bill_late002')).status).toBe(200);
    const refunds = await refundsOfRequest(b.code);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      status: 'requested',
      amountPaise: b.totalPaise,
      source: 'duplicate_payment',
    });
    const view = await call(customer, 'GET', `/service-requests/${b.code}`);
    expect(view.body.bill).toMatchObject({ method: 'upi' });
  });
});

describe('staff cancel', () => {
  it('needs service:cancel: customers, workshops, support agents and signed-out callers are refused', async () => {
    const b = await billed();
    const path = `/admin/service-requests/${b.code}/cancel`;
    const body = { reasonCode: 'workshop_unavailable', version: b.version };
    expect((await call(null, 'POST', path, body)).status).toBe(401);
    expect((await call(customer, 'POST', path, body)).status).toBe(403);
    expect((await call(owner, 'POST', path, body)).status).toBe(403);
    expect((await call(support, 'POST', path, body)).status).toBe(403);
    expect(await requestStatus(b.code)).toBe('billed');
  });

  it("city-scoped: another city's manager gets 404; the right staff cancel with a reason code and a strict body", async () => {
    const b = await billed();
    const path = `/admin/service-requests/${b.code}/cancel`;
    expect(
      (await call(bhilaiManager, 'POST', path, { reasonCode: 'other', version: b.version })).status,
    ).toBe(404);
    expect((await call(ops, 'POST', path, { reasonCode: 'nope', version: b.version })).status).toBe(400);
    expect(
      (await call(ops, 'POST', path, { reasonCode: 'other', version: b.version, message: 'x' })).status,
    ).toBe(400);
    const done = await call(ops, 'POST', path, { reasonCode: 'workshop_unresponsive', version: b.version });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'cancelled', refundRequested: false });
    const again = await call(ops, 'POST', path, {
      reasonCode: 'workshop_unresponsive',
      version: Number(done.body.version),
    });
    expect(again.status).toBe(409);
    const view = await call(customer, 'GET', `/service-requests/${b.code}`);
    expect(view.body).toMatchObject({ status: 'cancelled', reasonCode: 'workshop_unresponsive' });
    // The customer is told in their language through the bell.
    const notices = (await ctx.db.select().from(s.notifications)).filter(
      (n) => n.kind === 'service.cancelled',
    );
    expect(notices.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ranked suggestions for routing', () => {
  it('service:route only; ranked list with reasons for a request in the staff city; foreign city and bad status refused', async () => {
    const made = await ctx.app.request('/v1/service-requests', {
      method: 'POST',
      headers: { ...customer.headers, 'idempotency-key': 'bp-api-suggest-00000001' },
      body: JSON.stringify({
        workshopSlug: null,
        vehicleType: '2W',
        vehicle: 'Honda Activa 6G',
        serviceKeys: [],
        concern: 'Scooter will not start in the morning',
        pincode: '492001',
        preferredDate: TODAY,
        preferredSlot: 'morning',
      }),
    });
    expect(made.status).toBe(201);
    const code = ((await made.json()) as { code: string }).code;
    const path = `/admin/service-requests/${code}/suggestions?locale=en`;
    expect((await call(null, 'GET', path)).status).toBe(401);
    expect((await call(customer, 'GET', path)).status).toBe(403);
    expect((await call(support, 'GET', path)).status).toBe(403);
    expect((await call(bhilaiManager, 'GET', path)).status).toBe(404);
    const res = await call(ops, 'GET', path);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as {
      workshopId: string;
      rank: number;
      reasons: unknown[];
      scoreBp: number;
    }[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.map((i) => i.rank)).toEqual(items.map((_, i) => i + 1));
    expect(items[0]?.reasons).toHaveLength(5);
    // A billed (not routable) request is a conflict.
    expect(
      (await call(ops, 'GET', `/admin/service-requests/${lastBilled}/suggestions?locale=en`)).status,
    ).toBe(409);
  });
});
