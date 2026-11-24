/**
 * Roadside assistance over HTTP (spec 22): availability without sign-in, the settings screen (own permission, city
 * scope, audited, stale version), request creation (verified email NOT required, validation, idempotency, area and
 * 3W refusals, mass assignment), the advance through the checkout callback and the webhook (amount from the server,
 * one order, replay safe), dispatch, the workshop steps, the balance, cancel with a refund request, and role leaks.
 */
import { createHmac } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { loadKeyring } from '@mechdost/db/crypto';
import * as s from '@mechdost/db/schema';
import { defaultRsaSettings } from '@mechdost/shared/rsa';
import type { RazorpayGateway, RazorpayPayment } from '../src/payments/razorpay';
import { bearer, buildApp, type ErrorJson } from './helpers';

const KEY_SECRET = 'test_key_secret_0123456789';
const WEBHOOK_SECRET = 'test_webhook_secret_01';
const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_Fake0123456789',
  RAZORPAY_KEY_SECRET: KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

class FakeRazorpay implements RazorpayGateway {
  keyId = ENV.RAZORPAY_KEY_ID;
  ordersCreated = 0;
  lastOrder: { amountPaise: number; receipt: string } | null = null;
  payments = new Map<string, RazorpayPayment>();
  createOrder(input: { amountPaise: number; receipt: string }) {
    this.ordersCreated += 1;
    this.lastOrder = input;
    return Promise.resolve({
      id: `order_FakeRsa${String(this.ordersCreated).padStart(5, '0')}`,
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
let workshopId = '';

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(
  n: string,
  opts: { role?: string; cityId?: string; emailVerified?: boolean } = {},
): Promise<Person> {
  const identity = {
    firebaseUid: `rsa-api-${n}`,
    phone: `+9198555555${n}`,
    email: `rsa-api-${n}@example.com`,
    emailVerified: opts.emailVerified ?? true,
  };
  const token = ctx.verifier.add(`token-rsa-api-0000000${n}`, identity);
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

const call = async (
  p: Person | null,
  method: string,
  path: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? {}), ...extra },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

let keyN = 0;
const idem = () => ({ 'idempotency-key': `rsa-api-key-${String((keyN += 1)).padStart(8, '0')}` });
const REQUEST = { vehicleType: '2W', fuel: 'petrol', lat: 21.2514, lng: 81.6296, pincode: '492001' };

let ops: Person;
let superAdmin: Person;
let owner: Person;
let customer: Person;
let other: Person;
let noEmail: Person;
let bhilaiManager: Person;

const event = (orderId: string, amountPaise: number, paymentId: string) =>
  JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          status: 'captured',
          amount: amountPaise,
          currency: 'INR',
          method: 'upi',
        },
      },
    },
  });
const hook = (raw: string, eventId: string) =>
  ctx.app.request('/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-event-id': eventId,
      'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex'),
    },
    body: raw,
  });

/** Make a request as `who` and pay the advance through the signed webhook: ends `requested`. */
async function live(who: Person) {
  const made = await call(who, 'POST', '/roadside/requests', REQUEST, idem());
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const code = String(made.body.code);
  const order = await call(who, 'POST', `/roadside/requests/${code}/pay-advance`);
  expect(order.status, JSON.stringify(order.body)).toBe(200);
  const res = await hook(
    event(String(order.body.orderId), 50_000, `pay_rsaapi${code.replace(/[^A-Za-z0-9]/g, '')}`),
    `evt_rsa_${code.replace(/[^A-Za-z0-9]/g, '')}`,
  );
  expect(res.status).toBe(200);
  const view = await call(who, 'GET', `/roadside/requests/${code}`);
  expect(view.body.status).toBe('requested');
  return { code, version: Number(view.body.version) };
}

beforeAll(async () => {
  razorpay = new FakeRazorpay();
  ctx = await buildApp({ env: ENV, razorpay, keyring });
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
  await ctx.db.insert(s.pincodes).values({
    pincode: '492001',
    stateId: state!.id,
    cityId: city.RPR!,
    centroid: { lng: 81.6296, lat: 21.2514 },
  });
  ops = await person('01', { role: 'ops_manager' });
  superAdmin = await person('02', { role: 'super_admin' });
  owner = await person('03');
  customer = await person('04');
  other = await person('05');
  bhilaiManager = await person('06', { role: 'city_manager', cityId: city.BHI });
  noEmail = await person('07', { emailVerified: false });
  const main = await call(ops, 'POST', '/admin/workshops', {
    slug: 'rsa-main',
    name: 'Workshop rsa-main',
    nameHi: 'वर्कशॉप आरएसए',
    addressLine: 'GE Road, Raipur',
    addressLineHi: 'जीई रोड, रायपुर',
    area: 'Shankar Nagar',
    areaHi: 'शंकर नगर',
    pincode: '492001',
    lat: 21.2514,
    lng: 81.6296,
    phone: '+919811199999',
    vehicleTypes: ['2W', '4W'],
    hours: { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
    gstin: '22AAAAA0000A1Z5',
    locationVerified: true,
    published: true,
    menu: [],
  });
  expect(main.status, JSON.stringify(main.body)).toBe(201);
  workshopId = String(main.body.id);
  await call(ops, 'POST', `/admin/workshops/${workshopId}/members`, {
    phone: '+919855555503',
    role: 'workshop_owner',
  });
});

describe('settings', () => {
  const body = { ...defaultRsaSettings(), enabled: true, pincodes: ['492001'], version: 0 };

  it('are for roadside:settings only, scoped to the staff cities, and audited', async () => {
    expect((await call(customer, 'GET', '/admin/roadside/settings?city=RPR')).status).toBe(403);
    expect((await call(ops, 'PUT', '/admin/roadside/settings?city=RPR', body)).status).toBe(403);
    expect((await call(bhilaiManager, 'GET', '/admin/roadside/settings?city=RPR')).status).toBe(403);
    const put = await call(superAdmin, 'PUT', '/admin/roadside/settings?city=RPR', body);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ enabled: true, vehicleTypes: ['2W', '4W'], version: 1 });
    expect((await call(superAdmin, 'PUT', '/admin/roadside/settings?city=RPR', body)).body.error.code).toBe(
      'STALE_SETTINGS',
    );
    expect(
      (await ctx.db.select().from(s.auditLog)).filter((a) => a.action === 'rsa.settings_saved'),
    ).toHaveLength(1);
  });

  it('refuse a 3W advance when 3W is not offered, unknown keys, and a bad phone', async () => {
    const put = (over: Record<string, unknown>) =>
      call(superAdmin, 'PUT', '/admin/roadside/settings?city=RPR', { ...body, version: 1, ...over });
    expect((await put({ advancePaise: { '2W': 50_000, '4W': 50_000, '3W': 50_000 } })).status).toBe(400);
    expect((await put({ surprise: true })).status).toBe(400);
    expect((await put({ sosPhone: '12345' })).status).toBe(400);
  });
});

describe('availability and creating a request', () => {
  it('answer without sign-in with the offered types and the advance, and say no for another PIN code', async () => {
    const ok = await call(null, 'GET', '/roadside/availability?pincode=492001');
    expect(ok.body).toMatchObject({
      available: true,
      vehicleTypes: ['2W', '4W'],
      advancePaise: { '2W': 50_000, '4W': 50_000 },
    });
    expect((await call(null, 'GET', '/roadside/availability?pincode=492009')).body).toMatchObject({
      available: false,
    });
    expect((await call(null, 'GET', '/roadside/availability?pincode=abc')).status).toBe(400);
  });

  it('need a signed-in customer, not a verified email, and refuse 3W and unknown fields', async () => {
    expect((await call(null, 'POST', '/roadside/requests', REQUEST, idem())).status).toBe(401);
    expect((await call(customer, 'POST', '/roadside/requests', REQUEST)).status).toBe(400);
    expect(
      (await call(customer, 'POST', '/roadside/requests', { ...REQUEST, vehicleType: '3W' }, idem())).body
        .error.code,
    ).toBe('RSA_VEHICLE_NOT_OFFERED');
    expect(
      (await call(customer, 'POST', '/roadside/requests', { ...REQUEST, advancePaise: 1 }, idem())).status,
    ).toBe(400);
    expect(
      (await call(customer, 'POST', '/roadside/requests', { ...REQUEST, pincode: '492009' }, idem())).body
        .error.code,
    ).toBe('PINCODE_NOT_SERVED');
    const made = await call(
      noEmail,
      'POST',
      '/roadside/requests',
      { ...REQUEST, problemType: 'unknown' },
      idem(),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ status: 'awaiting_payment', advancePaise: 50_000 });
    expect((await call(noEmail, 'POST', `/roadside/requests/${String(made.body.code)}/cancel`)).status).toBe(
      200,
    );
  });

  it('replay the same Idempotency-Key as 200 and refuse a second live request', async () => {
    const key = idem();
    const a = await call(other, 'POST', '/roadside/requests', REQUEST, key);
    const b = await call(other, 'POST', '/roadside/requests', REQUEST, key);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.code).toBe(a.body.code);
    expect((await call(other, 'POST', '/roadside/requests', REQUEST, idem())).body.error.code).toBe(
      'RSA_ALREADY_OPEN',
    );
    await call(other, 'POST', `/roadside/requests/${String(a.body.code)}/cancel`);
  });
});

describe('paying the advance', () => {
  it('create one Razorpay order from the server amount, verify the callback and ignore replays', async () => {
    const made = await call(customer, 'POST', '/roadside/requests', REQUEST, idem());
    const code = String(made.body.code);
    const before = razorpay.ordersCreated;
    const [a, b] = await Promise.all([
      call(customer, 'POST', `/roadside/requests/${code}/pay-advance`),
      call(customer, 'POST', `/roadside/requests/${code}/pay-advance`),
    ]);
    expect(a.body.orderId).toBe(b.body.orderId);
    expect(a.body).toMatchObject({ amountPaise: 50_000, currency: 'INR' });
    expect(razorpay.ordersCreated - before).toBeGreaterThanOrEqual(1);
    // Another customer cannot pay or read it.
    expect((await call(other, 'POST', `/roadside/requests/${code}/pay-advance`)).status).toBe(404);
    expect((await call(other, 'GET', `/roadside/requests/${code}`)).status).toBe(404);
    // The checkout callback: signed, then fetched from Razorpay.
    const orderId = String(a.body.orderId);
    razorpay.payments.set('pay_rsacb1', {
      id: 'pay_rsacb1',
      orderId,
      status: 'captured',
      amountPaise: 50_000,
      currency: 'INR',
      method: 'upi',
    });
    const sig = createHmac('sha256', KEY_SECRET).update(`${orderId}|pay_rsacb1`).digest('hex');
    const verify = await call(customer, 'POST', '/payments/razorpay/verify', {
      razorpayOrderId: orderId,
      razorpayPaymentId: 'pay_rsacb1',
      razorpaySignature: sig,
    });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    expect((await call(customer, 'GET', `/roadside/requests/${code}`)).body.status).toBe('requested');
    for (let i = 0; i < 2; i += 1)
      expect((await hook(event(orderId, 50_000, 'pay_rsacb1'), `evt_rsa_replay${String(i)}`)).status).toBe(
        200,
      );
    expect((await call(customer, 'GET', `/roadside/requests/${code}`)).body.status).toBe('requested');
    // Nothing is left to pay.
    expect((await call(customer, 'POST', `/roadside/requests/${code}/pay-advance`)).body.error.code).toBe(
      'RSA_NOT_PAYABLE',
    );
    await call(superAdmin, 'POST', `/admin/roadside/requests/${code}/cancel`, {
      reasonCode: 'other',
      expectedVersion: Number((await call(customer, 'GET', `/roadside/requests/${code}`)).body.version),
    });
  });

  it('refuse a webhook with a different amount', async () => {
    const made = await call(other, 'POST', '/roadside/requests', REQUEST, idem());
    const code = String(made.body.code);
    const o = await call(other, 'POST', `/roadside/requests/${code}/pay-advance`);
    await hook(event(String(o.body.orderId), 10_000, 'pay_rsabadamt'), 'evt_rsa_badamt');
    expect((await call(other, 'GET', `/roadside/requests/${code}`)).body.status).toBe('awaiting_payment');
    await call(other, 'POST', `/roadside/requests/${code}/cancel`);
  });
});

describe('dispatch, the job and the bill', () => {
  it('opt in, send an offer, accept, arrive with the code, bill, and pay the balance online', async () => {
    const optIn = await call(owner, 'PUT', `/workshop/roadside/opt-in/${workshopId}`, {
      enabled: true,
      radiusKm: 10,
      vehicleTypes: ['2W', '4W'],
      problemTypes: ['dead_battery', 'flat_tyre', 'unknown'],
      towing: false,
      version: 0,
    });
    expect(optIn.status, JSON.stringify(optIn.body)).toBe(200);
    // A customer or another workshop's staff cannot use the workshop screens.
    expect((await call(customer, 'GET', '/workshop/roadside')).status).toBe(403);
    expect(
      (
        await call(other, 'PUT', `/workshop/roadside/opt-in/${workshopId}`, {
          enabled: true,
          radiusKm: 5,
          vehicleTypes: ['2W'],
          problemTypes: ['unknown'],
          towing: false,
          version: 1,
        })
      ).status,
    ).toBe(403);

    const { code, version } = await live(customer);
    const queue = await call(ops, 'GET', '/admin/roadside/queue?view=needs_dispatch');
    expect((queue.body as unknown as { code: string }[]).map((q) => q.code)).toContain(code);
    expect((await call(customer, 'GET', '/admin/roadside/queue')).status).toBe(403);
    const bq = await call(bhilaiManager, 'GET', '/admin/roadside/queue?view=needs_dispatch');
    expect((bq.body as unknown as { code: string }[]).map((q) => q.code)).not.toContain(code);
    expect((await call(bhilaiManager, 'GET', `/admin/roadside/requests/${code}/suggestions`)).status).toBe(
      404,
    );
    const sug = await call(ops, 'GET', `/admin/roadside/requests/${code}/suggestions`);
    expect((sug.body as unknown as { workshopId: string }[])[0]?.workshopId).toBe(workshopId);

    const sent = await call(ops, 'POST', `/admin/roadside/requests/${code}/offer`, {
      workshopId,
      expectedVersion: version,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const mine = await call(owner, 'GET', '/workshop/roadside');
    expect((mine.body.offers as { code: string }[]).map((o) => o.code)).toContain(code);
    expect((await call(owner, 'POST', `/workshop/roadside/requests/${code}/accept`)).status).toBe(200);
    expect((await call(owner, 'POST', `/workshop/roadside/requests/${code}/accept`)).status).toBe(404);

    const view = await call(customer, 'GET', `/roadside/requests/${code}`);
    expect(view.body).toMatchObject({ status: 'accepted' });
    const arrivalCode = String(view.body.arrivalCode);
    let v = Number(view.body.version);
    const wrong = arrivalCode === '0000' ? '1111' : '0000';
    const bad = await call(owner, 'POST', `/workshop/roadside/requests/${code}/arrive`, {
      arrivalCode: wrong,
      expectedVersion: v,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('ARRIVAL_CODE_WRONG');
    const good = await call(owner, 'POST', `/workshop/roadside/requests/${code}/arrive`, {
      arrivalCode,
      expectedVersion: v,
    });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    v = Number(good.body.version);
    expect(
      (await call(owner, 'POST', `/workshop/roadside/requests/${code}/start`, { expectedVersion: v })).status,
    ).toBe(200);
    v += 1;
    const billed = await call(owner, 'POST', `/workshop/roadside/requests/${code}/bill`, {
      expectedVersion: v,
      lines: [
        { kind: 'labour', description: 'Jump start', quantity: 1, unitPricePaise: 100_000 },
        { kind: 'part', description: 'Fuse', quantity: 2, unitPricePaise: 40_000 },
      ],
    });
    expect(billed.body).toMatchObject({ totalPaise: 180_000, balancePaise: 130_000, completed: false });
    const pay = await call(customer, 'POST', `/roadside/requests/${code}/pay-balance`);
    expect(pay.body).toMatchObject({ amountPaise: 130_000 });
    expect(razorpay.lastOrder?.amountPaise).toBe(130_000);
    await hook(event(String(pay.body.orderId), 130_000, 'pay_rsabalance1'), 'evt_rsa_balance1');
    const done = await call(customer, 'GET', `/roadside/requests/${code}`);
    expect(done.body).toMatchObject({ status: 'completed' });
    expect((done.body.bill as { balancePaise: number }).balancePaise).toBe(130_000);
  });

  it('keep the customer out of workshop and admin endpoints and another customer out of the request', async () => {
    const { code, version } = await live(other);
    for (const [method, path] of [
      ['POST', `/admin/roadside/requests/${code}/offer`],
      ['POST', `/admin/roadside/requests/${code}/cancel`],
      ['POST', `/workshop/roadside/requests/${code}/accept`],
    ] as const)
      expect(
        (await call(other, method, path, { workshopId, expectedVersion: version, reasonCode: 'other' }))
          .status,
      ).toBe(403);
    expect((await call(customer, 'GET', `/roadside/requests/${code}`)).status).toBe(404);
    // Staff of another city get 404, not the request.
    expect(
      (
        await call(bhilaiManager, 'POST', `/admin/roadside/requests/${code}/cancel`, {
          reasonCode: 'other',
          expectedVersion: version,
        })
      ).status,
    ).toBe(404);
  });

  it('cancel with a refund request, once, and tell the customer nothing is promised instantly', async () => {
    const who = await person('08');
    const { code, version } = await live(who);
    const cancel = await call(ops, 'POST', `/admin/roadside/requests/${code}/cancel`, {
      reasonCode: 'no_responder_accepted',
      expectedVersion: version,
    });
    expect(cancel.body).toMatchObject({ ok: true, refundRequested: true });
    expect(
      (
        await call(ops, 'POST', `/admin/roadside/requests/${code}/cancel`, {
          reasonCode: 'no_responder_accepted',
          expectedVersion: version,
        })
      ).status,
    ).toBe(409);
    const view = await call(who, 'GET', `/roadside/requests/${code}`);
    expect(view.body).toMatchObject({
      status: 'cancelled',
      refunds: [{ amountPaise: 50_000, stage: 'under_review' }],
    });
  });

  it('rate limit creation per user', async () => {
    const spam = await person('09');
    let last = 0;
    for (let i = 0; i < 8; i += 1)
      last = (await call(spam, 'POST', '/roadside/requests', { ...REQUEST, pincode: '492009' }, idem()))
        .status;
    expect(last).toBe(429);
  });
});
