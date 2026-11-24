/**
 * Roadside assistance, phase 1 (spec 22, design 2026-11-24): per-city settings, request creation and its refusals, the
 * advance payment (one Razorpay order, snapshot amount, replays, late capture), manual dispatch with ranked
 * suggestions and the accept timer, the arrival code, the bill and the balance (online, cash, covered, under the
 * advance), automatic refund requests, scope (404 for foreign ids) and the integrity constraints.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { defaultRsaSettings } from '@mechdost/shared/rsa';
import type { RsaSettingsInputT } from '@mechdost/shared/rsa-api';
import type { CreateRsaRequestInput } from '@mechdost/shared/rsa-api';
import { loadKeyring } from '../src/crypto';
import {
  acceptRsaOffer,
  applyRazorpayPayment,
  applyRazorpayRefund,
  approveRefund,
  claimRefundDispatch,
  recordRefundSent,
  billRsa,
  cancelRsaByStaff,
  cancelUnpaidRsa,
  confirmRsaArrival,
  createRsaRequest,
  declineRsaOffer,
  expireDueRsaOffers,
  expireUnpaidRsa,
  getAdminWorkshop,
  getCustomerRsa,
  getRsaSettings,
  listAdminRefunds,
  listRsaQueue,
  listWorkshopRsa,
  markRsaBalanceCash,
  markRsaEnRoute,
  openPaymentForRsa,
  overrideRsaArrival,
  payableRsaOfUser,
  recordRsaRazorpayOrder,
  saveRsaOptIn,
  saveRsaSettings,
  sendRsaOffer,
  setWorkshopStanding,
  startRsaWork,
  suggestRsaResponders,
  withdrawRsaOffer,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const ALL = { all: true as const };
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});
const W: Record<string, { id: string; slug: string }> = {};
let keyN = 0;
let payN = 0;

const SETTINGS: RsaSettingsInputT = {
  ...defaultRsaSettings(),
  enabled: true,
  pincodes: ['492001', '492004'],
  version: 0,
};

const place: CreateRsaRequestInput = {
  vehicleType: '2W',
  fuel: 'petrol',
  lat: 21.2514,
  lng: 81.6296,
  pincode: '492001',
};

const idem = () => `rsa-test-key-${String((keyN += 1)).padStart(6, '0')}`;
/** Who owns each request code (every request gets its own customer: one live request per person). */
const owner = new Map<string, string>();
let userN = 0;
async function newUser(): Promise<string> {
  userN += 1;
  const [u] = await db
    .insert(s.users)
    .values({
      firebaseUid: `rsa-cust-${String(userN)}`,
      phone: `+9198111${String(50000 + userN)}`,
      name: 'Rider',
      language: 'hi',
    })
    .returning();
  return u!.id;
}
async function create(over: Partial<CreateRsaRequestInput> = {}, userId?: string) {
  const uid = userId ?? (await newUser());
  const r = await createRsaRequest(t(), { userId: uid, idemKey: idem(), request: { ...place, ...over } });
  owner.set(r.code, uid);
  return r;
}

const fact = (providerOrderId: string, amountPaise: number, over: Record<string, unknown> = {}) => ({
  providerOrderId,
  providerPaymentId: `pay_rsa_${String((payN += 1)).padStart(5, '0')}`,
  status: 'captured' as const,
  amountPaise,
  currency: 'INR',
  method: 'upi',
  ...over,
});

async function order(code: string, purpose: 'rsa_advance' | 'rsa_balance', userId?: string) {
  const due = await payableRsaOfUser(t(), { userId: userId ?? owner.get(code)!, code, purpose });
  const open = await openPaymentForRsa(t(), due.requestId, purpose);
  return (
    open ??
    (await recordRsaRazorpayOrder(t(), {
      requestId: due.requestId,
      purpose,
      providerOrderId: `order_rsa_${String((payN += 1)).padStart(6, '0')}`,
      amountPaise: due.amountPaise,
    }))
  );
}

async function pay(code: string, purpose: 'rsa_advance' | 'rsa_balance' = 'rsa_advance') {
  const o = await order(code, purpose);
  return applyRazorpayPayment(t(), fact(o.providerOrderId, o.amountPaise));
}

/** A request with the advance paid (status `requested`). */
async function live(over: Partial<CreateRsaRequestInput> = {}, userId?: string) {
  const r = await create(over, userId);
  const o = await order(r.code, 'rsa_advance');
  expect(await applyRazorpayPayment(t(), fact(o.providerOrderId, o.amountPaise))).toEqual({
    outcome: 'paid',
  });
  return { code: r.code, id: await idOf(r.code) };
}

async function idOf(code: string) {
  const [r] = await db
    .select({ id: s.rsaRequests.id })
    .from(s.rsaRequests)
    .where(eq(s.rsaRequests.code, code));
  return r!.id;
}
const row = async (code: string) =>
  (await db.select().from(s.rsaRequests).where(eq(s.rsaRequests.code, code)))[0]!;
const refundsOf = async (code: string) =>
  db
    .select()
    .from(s.refunds)
    .where(eq(s.refunds.rsaRequestId, await idOf(code)));
const step = (code: string, version: number, who: 'main' | 'near' = 'main') => ({
  workshopIds: [W[who]!.id],
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

/** Offer to `main`, accepted: ready for the job steps. Returns the request version after accepting. */
async function accepted() {
  const { code } = await live();
  const v = (await row(code)).version;
  await sendRsaOffer(t(), {
    scope: ALL,
    code,
    workshopId: W.main!.id,
    expectedVersion: v,
    staffUserId: f.staff,
  });
  const out = await acceptRsaOffer(t(), { workshopIds: [W.main!.id], code, staffUserId: f.staff, keyring });
  return { code, version: out.version };
}

async function inProgress() {
  const a = await accepted();
  const view = await getCustomerRsa(t(), { userId: owner.get(a.code)!, code: a.code, keyring });
  const arrived = await confirmRsaArrival(t(), {
    ...step(a.code, a.version),
    arrivalCode: view.arrivalCode!,
    keyring,
  });
  if (!arrived.ok || !('version' in arrived)) throw new Error('arrival');
  const started = await startRsaWork(t(), step(a.code, arrived.version));
  return { code: a.code, version: started.version };
}

const LINES = [
  { kind: 'labour' as const, description: 'Jump start and check', quantity: 1, unitPricePaise: 80_000 },
  { kind: 'part' as const, description: 'Battery terminal', quantity: 2, unitPricePaise: 50_000 },
];

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.main = await addWorkshop(db, f, { name: 'Main Garage' });
  W.near = await addWorkshop(db, f, { name: 'Near Garage', lat: 21.2614, lng: 81.6296 });
  W.far = await addWorkshop(db, f, { name: 'Far Garage', lat: 21.5, lng: 81.9 });
  W.closed = await addWorkshop(db, f, { name: 'Not Opted In' });
  for (const key of ['main', 'near', 'far'] as const) {
    await saveRsaOptIn(t(), {
      workshopIds: [W[key]!.id],
      workshopId: W[key]!.id,
      staffUserId: f.staff,
      optIn: {
        enabled: true,
        radiusKm: 10,
        vehicleTypes: ['2W', '4W'],
        problemTypes: ['dead_battery', 'flat_tyre', 'out_of_fuel', 'minor_fix', 'unknown'],
        towing: false,
        version: 0,
      },
    });
  }
});

afterAll(async () => {
  await client.close();
});

describe('city settings', () => {
  it('start switched off with 2W and 4W at 500 rupees and no 3W', async () => {
    const d = await getRsaSettings(t(), f.raipur);
    expect(d).toMatchObject({
      enabled: false,
      vehicleTypes: ['2W', '4W'],
      routingMode: 'manual',
      version: 0,
    });
    expect(d.advancePaise).toEqual({ '2W': 50_000, '4W': 50_000 });
  });

  it('refuse a request while nothing is saved', async () => {
    await expect(create()).rejects.toMatchObject({ code: 'RSA_NOT_AVAILABLE' });
  });

  it('save with an audit row, refuse a stale version and a PIN code of another city', async () => {
    await expect(
      saveRsaSettings(t(), {
        cityId: f.raipur,
        staffUserId: f.staff,
        settings: { ...SETTINGS, pincodes: ['490001'] },
      }),
    ).rejects.toMatchObject({ code: 'RSA_PINCODE_UNKNOWN' });
    const saved = await saveRsaSettings(t(), { cityId: f.raipur, staffUserId: f.staff, settings: SETTINGS });
    expect(saved.version).toBe(1);
    await expect(
      saveRsaSettings(t(), { cityId: f.raipur, staffUserId: f.staff, settings: { ...SETTINGS, version: 0 } }),
    ).rejects.toMatchObject({ code: 'STALE_SETTINGS' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'rsa.settings_saved'));
    expect(audit).toHaveLength(1);
  });

  it('keep the CHECK that the advance amounts are exactly the offered types (3W can be added later)', async () => {
    await expect(
      db
        .update(s.rsaCitySettings)
        .set({ vehicleTypes: ['2W', '3W', '4W'] })
        .where(eq(s.rsaCitySettings.cityId, f.raipur)),
    ).rejects.toThrow();
    const three = await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: {
        ...SETTINGS,
        version: 1,
        vehicleTypes: ['2W', '3W', '4W'],
        advancePaise: { '2W': 50_000, '3W': 40_000, '4W': 50_000 },
      },
    });
    expect(three.vehicleTypes).toContain('3W');
    await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: { ...SETTINGS, version: 2 },
    });
  });
});

describe('creating a request', () => {
  it('refuses an area outside the PIN list, a closed hour, and a vehicle type that is not offered', async () => {
    await expect(create({ pincode: '492009' })).rejects.toMatchObject({ code: 'RSA_OUT_OF_AREA' });
    await expect(create({ vehicleType: '3W' })).rejects.toMatchObject({ code: 'RSA_VEHICLE_NOT_OFFERED' });
    const cur = await getRsaSettings(t(), f.raipur);
    const m = new Date(Date.now() + 330 * 60_000);
    const now = m.getUTCHours() * 60 + m.getUTCMinutes();
    await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: {
        ...SETTINGS,
        version: cur.version,
        alwaysOpen: false,
        opensAtMinute: (now + 120) % 1440,
        closesAtMinute: (now + 180) % 1440,
      },
    });
    await expect(create()).rejects.toMatchObject({ code: 'RSA_CLOSED' });
    await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: { ...SETTINGS, version: cur.version + 1 },
    });
  });

  it('snapshot the advance, replay the same Idempotency-Key and allow one live request per customer', async () => {
    const key = idem();
    const a = await createRsaRequest(t(), { userId: f.customer, idemKey: key, request: place });
    owner.set(a.code, f.customer);
    expect(a).toMatchObject({ status: 'awaiting_payment', advancePaise: 50_000, replayed: false });
    expect(a.code).toMatch(/^RSA-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(await createRsaRequest(t(), { userId: f.customer, idemKey: key, request: place })).toMatchObject({
      code: a.code,
      replayed: true,
    });
    await expect(create({}, f.customer)).rejects.toMatchObject({ code: 'RSA_ALREADY_OPEN' });
    // A different person is not blocked.
    const b = await create({}, f.other);
    expect(b.code).not.toBe(a.code);
    await cancelUnpaidRsa(t(), { userId: owner.get(a.code)!, code: a.code });
    await cancelUnpaidRsa(t(), { userId: f.other, code: b.code });
  });

  it('accept the problem types: skipped, unknown and a known one', async () => {
    for (const problemType of [undefined, 'unknown', 'flat_tyre'] as const) {
      const r = await create(problemType ? { problemType } : {});
      expect((await row(r.code)).problemType).toBe(problemType ?? null);
      await cancelUnpaidRsa(t(), { userId: owner.get(r.code)!, code: r.code });
    }
  });

  it('keep what the customer saw when the setting changes later', async () => {
    const r = await create();
    const cur = await getRsaSettings(t(), f.raipur);
    await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: { ...SETTINGS, version: cur.version, advancePaise: { '2W': 70_000, '4W': 70_000 } },
    });
    const due = await payableRsaOfUser(t(), {
      userId: owner.get(r.code)!,
      code: r.code,
      purpose: 'rsa_advance',
    });
    expect(due.amountPaise).toBe(50_000);
    await cancelUnpaidRsa(t(), { userId: owner.get(r.code)!, code: r.code });
    await saveRsaSettings(t(), {
      cityId: f.raipur,
      staffUserId: f.staff,
      settings: { ...SETTINGS, version: cur.version + 1 },
    });
  });

  it('are private: another customer gets 404 for the page and for paying', async () => {
    const r = await create();
    await expect(getCustomerRsa(t(), { userId: f.other, code: r.code, keyring })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      payableRsaOfUser(t(), { userId: f.other, code: r.code, purpose: 'rsa_advance' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(cancelUnpaidRsa(t(), { userId: f.other, code: r.code })).rejects.toMatchObject({
      status: 404,
    });
    await cancelUnpaidRsa(t(), { userId: owner.get(r.code)!, code: r.code });
  });
});

describe('paying the advance', () => {
  it('store one Razorpay order for the snapshot amount, reuse it, and go live only when captured', async () => {
    const r = await create();
    const a = await order(r.code, 'rsa_advance');
    const b = await order(r.code, 'rsa_advance');
    expect(b.providerOrderId).toBe(a.providerOrderId);
    expect(a.amountPaise).toBe(50_000);
    expect((await row(r.code)).status).toBe('awaiting_payment');
    // A different amount is never applied.
    expect(await applyRazorpayPayment(t(), fact(a.providerOrderId, 49_900))).toEqual({ outcome: 'mismatch' });
    expect(await applyRazorpayPayment(t(), fact(a.providerOrderId, 50_000, { status: 'failed' }))).toEqual({
      outcome: 'failed',
    });
    expect((await row(r.code)).status).toBe('awaiting_payment');
    const cap = fact(a.providerOrderId, 50_000);
    expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'paid' });
    const live1 = await row(r.code);
    expect(live1.status).toBe('requested');
    expect(live1.advancePaidAt).not.toBeNull();
    // Replays change nothing; a second captured payment is flagged and refunded once.
    for (let i = 0; i < 3; i += 1)
      expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'unchanged' });
    expect(await applyRazorpayPayment(t(), fact(a.providerOrderId, 50_000))).toEqual({
      outcome: 'needs_refund',
    });
    const events = await db.select().from(s.rsaEvents).where(eq(s.rsaEvents.requestId, live1.id));
    expect(events.filter((e) => e.toStatus === 'requested')).toHaveLength(1);
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code: r.code,
      reasonCode: 'other',
      expectedVersion: live1.version,
      staffUserId: f.staff,
    });
  });

  it('refuse a new order for a request that is already paid or cancelled', async () => {
    const r = await create();
    await cancelUnpaidRsa(t(), { userId: owner.get(r.code)!, code: r.code });
    await expect(
      payableRsaOfUser(t(), { userId: owner.get(r.code)!, code: r.code, purpose: 'rsa_advance' }),
    ).rejects.toMatchObject({ code: 'RSA_NOT_PAYABLE' });
  });

  it('record a capture after the request was closed and raise exactly one refund request for it', async () => {
    const r = await create();
    const o = await order(r.code, 'rsa_advance');
    await db
      .update(s.rsaRequests)
      .set({ createdAt: sql`now() - interval '2 hours'` })
      .where(eq(s.rsaRequests.code, r.code));
    expect(await expireUnpaidRsa(t(), { olderThanMinutes: 30 })).toBeGreaterThanOrEqual(1);
    expect((await row(r.code)).status).toBe('cancelled');
    const cap = fact(o.providerOrderId, o.amountPaise);
    expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'unchanged' });
    const refunds = await refundsOf(r.code);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amountPaise: 50_000,
      source: 'payment_after_close',
      status: 'requested',
    });
    expect((await row(r.code)).status).toBe('cancelled');
  });
});

describe('dispatch', () => {
  it('suggest only opted-in, in-radius, eligible workshops, nearest first, never paused ones', async () => {
    const { code } = await live();
    const list = await suggestRsaResponders(t(), ALL, code);
    const ids = list.map((x) => x.workshopId);
    expect(ids).toContain(W.main!.id);
    expect(ids).toContain(W.near!.id);
    expect(ids).not.toContain(W.far!.id);
    expect(ids).not.toContain(W.closed!.id);
    expect(list[0]!.distanceM).toBeLessThanOrEqual(list[1]!.distanceM);
    const near = await getAdminWorkshop(t(), ALL, W.near!.id);
    await setWorkshopStanding(t(), {
      scope: ALL,
      staffUserId: f.staff,
      workshopId: W.near!.id,
      status: 'paused',
      reason: 'Paused for checks',
      expectedVersion: near.version,
    });
    expect((await suggestRsaResponders(t(), ALL, code)).map((x) => x.workshopId)).not.toContain(W.near!.id);
    await expect(
      sendRsaOffer(t(), {
        scope: ALL,
        code,
        workshopId: W.near!.id,
        expectedVersion: (await row(code)).version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WORKSHOP_NOT_ELIGIBLE' });
    const back = await getAdminWorkshop(t(), ALL, W.near!.id);
    await setWorkshopStanding(t(), {
      scope: ALL,
      staffUserId: f.staff,
      workshopId: W.near!.id,
      status: 'approved',
      reason: 'Checks done',
      expectedVersion: back.version,
    });
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'other',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
  });

  it('skip a workshop that does not serve the vehicle type or the problem', async () => {
    const { code } = await live({ vehicleType: '4W', problemType: 'needs_towing' });
    // Nobody tows in the fixture, so there is no one to offer to.
    expect(await suggestRsaResponders(t(), ALL, code)).toEqual([]);
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
  });

  it('send one offer at a time and show it in the queue with a timer', async () => {
    const { code } = await live();
    const v = (await row(code)).version;
    const sent = await sendRsaOffer(t(), {
      scope: ALL,
      code,
      workshopId: W.main!.id,
      expectedVersion: v,
      staffUserId: f.staff,
    });
    expect(new Date(sent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await expect(
      sendRsaOffer(t(), {
        scope: ALL,
        code,
        workshopId: W.near!.id,
        expectedVersion: v + 1,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
    const queue = await listRsaQueue(t(), ALL, 'needs_dispatch');
    expect(queue.find((q) => q.code === code)).toMatchObject({
      status: 'offered',
      workshopName: 'Main Garage',
      attempts: 1,
    });
    // The offer reached the workshop's list, and another workshop sees nothing.
    expect((await listWorkshopRsa(t(), [W.main!.id])).offers.map((o) => o.code)).toContain(code);
    expect((await listWorkshopRsa(t(), [W.near!.id])).offers.map((o) => o.code)).not.toContain(code);
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
    const offers = await db
      .select()
      .from(s.rsaOffers)
      .where(eq(s.rsaOffers.requestId, await idOf(code)));
    expect(offers.map((o) => o.status)).toEqual(['withdrawn']);
  });

  it('give the request to exactly one of two parallel accepts', async () => {
    const { code } = await live();
    await sendRsaOffer(t(), {
      scope: ALL,
      code,
      workshopId: W.main!.id,
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
    const tries = await Promise.allSettled([
      acceptRsaOffer(t(), { workshopIds: [W.main!.id], code, staffUserId: f.staff, keyring }),
      acceptRsaOffer(t(), { workshopIds: [W.main!.id], code, staffUserId: f.staff, keyring }),
    ]);
    expect(tries.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(tries.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const r = await row(code);
    expect(r).toMatchObject({ status: 'accepted', workshopId: W.main!.id });
    const active = await db
      .select()
      .from(s.rsaOffers)
      .where(and(eq(s.rsaOffers.requestId, r.id), sql`${s.rsaOffers.status} in ('offered','accepted')`));
    expect(active).toHaveLength(1);
    // The customer now sees the responder and a 4-digit code; the code is never in a notice.
    const view = await getCustomerRsa(t(), { userId: owner.get(code)!, code, keyring });
    expect(view.responder?.workshopName).toBe('Main Garage');
    expect(view.arrivalCode).toMatch(/^\d{4}$/);
    const notices = await db.select().from(s.notifications).where(eq(s.notifications.kind, 'rsa.accepted'));
    expect(JSON.stringify(notices)).not.toContain(view.arrivalCode!);
  });

  it('send a declined request back to the queue and never offer it to that workshop again', async () => {
    const { code } = await live();
    await sendRsaOffer(t(), {
      scope: ALL,
      code,
      workshopId: W.main!.id,
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
    await declineRsaOffer(t(), { workshopIds: [W.main!.id], code, staffUserId: f.staff, reasonCode: 'busy' });
    expect((await row(code)).status).toBe('requested');
    expect((await suggestRsaResponders(t(), ALL, code)).map((x) => x.workshopId)).not.toContain(W.main!.id);
    await expect(
      acceptRsaOffer(t(), { workshopIds: [W.main!.id], code, staffUserId: f.staff, keyring }),
    ).rejects.toMatchObject({ status: 404 });
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
  });

  it('expire an offer past its timer through the sweep, and refuse a late accept before the sweep ran', async () => {
    const { code } = await live();
    await sendRsaOffer(t(), {
      scope: ALL,
      code,
      workshopId: W.near!.id,
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
    const id = await idOf(code);
    await db
      .update(s.rsaOffers)
      .set({ offeredAt: sql`now() - interval '10 minutes'`, expiresAt: sql`now() - interval '5 minutes'` })
      .where(eq(s.rsaOffers.requestId, id));
    await expect(
      acceptRsaOffer(t(), { workshopIds: [W.near!.id], code, staffUserId: f.staff, keyring }),
    ).rejects.toMatchObject({ code: 'OFFER_EXPIRED' });
    expect((await expireDueRsaOffers(t())).expired).toBe(1);
    expect((await expireDueRsaOffers(t())).expired).toBe(0);
    expect((await row(code)).status).toBe('requested');
    const [offer] = await db.select().from(s.rsaOffers).where(eq(s.rsaOffers.requestId, id));
    expect(offer!.status).toBe('expired');
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
  });

  it('refuse a second active offer with the partial unique index', async () => {
    const { code } = await live();
    const id = await idOf(code);
    const base = { requestId: id, workshopId: W.main!.id, expiresAt: sql`now() + interval '1 minute'` };
    await db.insert(s.rsaOffers).values(base);
    await expect(db.insert(s.rsaOffers).values({ ...base, workshopId: W.near!.id })).rejects.toThrow();
    await db.update(s.rsaOffers).set({ status: 'withdrawn' }).where(eq(s.rsaOffers.requestId, id));
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'other',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
  });

  it('let admin take a job back from a workshop that has not arrived', async () => {
    const a = await accepted();
    await markRsaEnRoute(t(), step(a.code, a.version));
    await withdrawRsaOffer(t(), {
      scope: ALL,
      code: a.code,
      expectedVersion: a.version + 1,
      staffUserId: f.staff,
    });
    expect(await row(a.code)).toMatchObject({ status: 'requested', workshopId: null });
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code: a.code,
      reasonCode: 'other',
      expectedVersion: (await row(a.code)).version,
      staffUserId: f.staff,
    });
  });
});

describe('cancelling', () => {
  it('refund the advance once, however many times admin clicks', async () => {
    const { code } = await live();
    const v = (await row(code)).version;
    const input = {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted' as const,
      expectedVersion: v,
      staffUserId: f.staff,
    };
    const out = await cancelRsaByStaff(t(), input);
    expect(out.refundId).not.toBeNull();
    await expect(cancelRsaByStaff(t(), input)).rejects.toMatchObject({ code: 'WRONG_STEP' });
    const refunds = await refundsOf(code);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amountPaise: 50_000,
      source: 'rsa_cancelled',
      status: 'requested',
      requestedBy: null,
    });
    expect(refunds[0]!.groupId).toBeNull();
    // It shows in the finance queue of the city, and not in another city's.
    const page = await listAdminRefunds(t(), ALL, { view: 'waiting', cursor: null, staffUserId: f.staff });
    expect(page.items.map((x) => x.id)).toContain(refunds[0]!.id);
    const other = await listAdminRefunds(
      t(),
      { all: false, cityIds: [f.bhilai] },
      { view: 'waiting', cursor: null, staffUserId: f.staff },
    );
    expect(other.items.map((x) => x.id)).not.toContain(refunds[0]!.id);
    // A parallel pair of cancels still leaves one refund (the second finds the request closed).
    const view = await getCustomerRsa(t(), { userId: owner.get(code)!, code, keyring });
    expect(view).toMatchObject({ status: 'cancelled', cancelReason: 'no_responder_accepted' });
    expect(view.refunds).toEqual([{ amountPaise: 50_000, stage: 'under_review' }]);
  });

  it('send the refund through approval to Razorpay, update the payment ledger and tell the customer once', async () => {
    const { code } = await live();
    await cancelRsaByStaff(t(), {
      scope: ALL,
      code,
      reasonCode: 'no_responder_accepted',
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    });
    const [refund] = await refundsOf(code);
    // The system asked, so staff other than the requester approve it (four eyes): finance approves, nothing is automatic.
    expect(refund).toMatchObject({ status: 'requested', requestedBy: null });
    const approved = await approveRefund(t(), {
      scope: ALL,
      staffUserId: f.other,
      refundId: refund!.id,
      expectedVersion: refund!.version,
    });
    expect(approved.status).toBe('approved');
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.id, refund!.paymentId!));
    const job = await claimRefundDispatch(t(), refund!.id);
    expect(job).toMatchObject({ amountPaise: 50_000, providerPaymentId: pay!.providerPaymentId });
    await recordRefundSent(t(), refund!.id, `rfnd_rsa${String((payN += 1)).padStart(6, '0')}`);
    const [sent] = await refundsOf(code);
    const done = {
      providerRefundId: sent!.providerRefundId!,
      providerPaymentId: pay!.providerPaymentId!,
      refundId: refund!.id,
      status: 'processed' as const,
      amountPaise: 50_000,
      currency: 'INR',
    };
    expect(await applyRazorpayRefund(t(), done)).toEqual({ outcome: 'processed' });
    expect(await applyRazorpayRefund(t(), done)).toEqual({ outcome: 'unchanged' });
    const [after] = await db.select().from(s.payments).where(eq(s.payments.id, pay!.id));
    expect(after).toMatchObject({ status: 'refunded', refundedPaise: 50_000, refundReservedPaise: 50_000 });
    // One bell notice for the customer, and no order email for a request with no order.
    const notices = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.kind, 'rsa.refunded'), eq(s.notifications.userId, owner.get(code)!)));
    expect(notices).toHaveLength(1);
    const view = await getCustomerRsa(t(), { userId: owner.get(code)!, code, keyring });
    expect(view.refunds).toEqual([{ amountPaise: 50_000, stage: 'refunded' }]);
  });

  it('let only one of two parallel cancels win', async () => {
    const { code } = await live();
    const input = {
      scope: ALL,
      code,
      reasonCode: 'other' as const,
      expectedVersion: (await row(code)).version,
      staffUserId: f.staff,
    };
    const tries = await Promise.allSettled([cancelRsaByStaff(t(), input), cancelRsaByStaff(t(), input)]);
    expect(tries.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await refundsOf(code)).toHaveLength(1);
  });

  it('refuse a cancel after a workshop accepted, and 404 outside the staff city scope', async () => {
    const a = await accepted();
    await expect(
      cancelRsaByStaff(t(), {
        scope: ALL,
        code: a.code,
        reasonCode: 'other',
        expectedVersion: a.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
    await expect(
      cancelRsaByStaff(t(), {
        scope: { all: false, cityIds: [f.bhilai] },
        code: a.code,
        reasonCode: 'other',
        expectedVersion: a.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await listRsaQueue(t(), { all: false, cityIds: [f.bhilai] }, 'active')).map((q) => q.code),
    ).not.toContain(a.code);
    expect((await listRsaQueue(t(), ALL, 'active')).map((q) => q.code)).toContain(a.code);
  });
});

describe('the job', () => {
  it('lock the arrival code after five wrong tries, then allow an audited override only with a reason', async () => {
    const a = await accepted();
    const view = await getCustomerRsa(t(), { userId: owner.get(a.code)!, code: a.code, keyring });
    const wrong = view.arrivalCode === '0000' ? '1111' : '0000';
    for (let i = 0; i < 4; i += 1)
      expect(
        await confirmRsaArrival(t(), { ...step(a.code, a.version), arrivalCode: wrong, keyring }),
      ).toMatchObject({
        ok: false,
        reason: 'wrong',
      });
    expect(
      await confirmRsaArrival(t(), { ...step(a.code, a.version), arrivalCode: wrong, keyring }),
    ).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    // Even the right code is refused once locked.
    expect(
      await confirmRsaArrival(t(), { ...step(a.code, a.version), arrivalCode: view.arrivalCode!, keyring }),
    ).toMatchObject({ ok: false, reason: 'locked' });
    await expect(
      overrideRsaArrival(t(), {
        scope: ALL,
        code: a.code,
        reason: 'no',
        expectedVersion: a.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    await overrideRsaArrival(t(), {
      scope: ALL,
      code: a.code,
      reason: 'Customer lost the phone, called support',
      expectedVersion: a.version,
      staffUserId: f.staff,
    });
    expect((await row(a.code)).status).toBe('arrived');
    expect(
      await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'rsa.arrival_override')),
    ).toHaveLength(1);
  });

  it('keep another workshop out of the job (404) and hide the code once the mechanic arrived', async () => {
    const a = await accepted();
    await expect(markRsaEnRoute(t(), step(a.code, a.version, 'near'))).rejects.toMatchObject({ status: 404 });
    expect((await listWorkshopRsa(t(), [W.near!.id])).jobs.map((j) => j.code)).not.toContain(a.code);
    const job = (await listWorkshopRsa(t(), [W.main!.id])).jobs.find((j) => j.code === a.code);
    expect(job).toMatchObject({ status: 'accepted', lat: expect.any(Number) as number });
    expect(JSON.stringify(job)).not.toContain('phone');
    const en = await markRsaEnRoute(t(), step(a.code, a.version));
    const view = await getCustomerRsa(t(), { userId: owner.get(a.code)!, code: a.code, keyring });
    const ok = await confirmRsaArrival(t(), {
      ...step(a.code, en.version),
      arrivalCode: view.arrivalCode!,
      keyring,
    });
    expect(ok).toMatchObject({ ok: true });
    expect(
      (await getCustomerRsa(t(), { userId: owner.get(a.code)!, code: a.code, keyring })).arrivalCode,
    ).toBeNull();
  });

  it('bill, then pay the balance online: total minus advance, one order, completed on capture', async () => {
    const j = await inProgress();
    const billed = await billRsa(t(), { ...step(j.code, j.version), lines: LINES });
    expect(billed).toMatchObject({
      totalPaise: 180_000,
      advancePaise: 50_000,
      balancePaise: 130_000,
      overpaidPaise: 0,
      completed: false,
    });
    const r = await row(j.code);
    expect(r).toMatchObject({
      status: 'billed',
      totalPaise: 180_000,
      balancePaise: 130_000,
      overpaidPaise: 0,
    });
    // The lines are append-only.
    await expect(
      db.update(s.rsaBillLines).set({ description: 'x' }).where(eq(s.rsaBillLines.requestId, r.id)),
    ).rejects.toThrow();
    const o = await order(j.code, 'rsa_balance');
    expect(o.amountPaise).toBe(130_000);
    expect((await order(j.code, 'rsa_balance')).providerOrderId).toBe(o.providerOrderId);
    expect(await applyRazorpayPayment(t(), fact(o.providerOrderId, 129_999))).toEqual({
      outcome: 'mismatch',
    });
    expect(await applyRazorpayPayment(t(), fact(o.providerOrderId, 130_000))).toEqual({ outcome: 'paid' });
    expect(await row(j.code)).toMatchObject({ status: 'completed', balanceMethod: 'online' });
    const view = await getCustomerRsa(t(), { userId: owner.get(j.code)!, code: j.code, keyring });
    expect(view.bill).toMatchObject({ totalPaise: 180_000, balancePaise: 130_000 });
    expect(view.bill!.lines).toHaveLength(2);
    expect(await refundsOf(j.code)).toHaveLength(0);
  });

  it('refund the difference when the total is under the advance, with no balance order', async () => {
    const j = await inProgress();
    const billed = await billRsa(t(), {
      ...step(j.code, j.version),
      lines: [{ kind: 'labour', description: 'Quick check', quantity: 1, unitPricePaise: 30_000 }],
    });
    expect(billed).toMatchObject({
      totalPaise: 30_000,
      balancePaise: 0,
      overpaidPaise: 20_000,
      completed: true,
    });
    expect(await row(j.code)).toMatchObject({ status: 'completed', balanceMethod: 'none' });
    const refunds = await refundsOf(j.code);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: 20_000, source: 'rsa_overpaid', status: 'requested' });
    await expect(
      payableRsaOfUser(t(), { userId: owner.get(j.code)!, code: j.code, purpose: 'rsa_balance' }),
    ).rejects.toMatchObject({ code: 'RSA_NOT_PAYABLE' });
  });

  it('complete a bill equal to the advance with nothing to pay and no refund', async () => {
    const j = await inProgress();
    const billed = await billRsa(t(), {
      ...step(j.code, j.version),
      lines: [{ kind: 'labour', description: 'Jump start', quantity: 1, unitPricePaise: 50_000 }],
    });
    expect(billed).toMatchObject({ balancePaise: 0, overpaidPaise: 0, completed: true });
    expect(await refundsOf(j.code)).toHaveLength(0);
  });

  it('let cash and an online capture settle the balance once: the loser is a refund request or a conflict', async () => {
    const one = await inProgress();
    await billRsa(t(), { ...step(one.code, one.version), lines: LINES });
    const o = await order(one.code, 'rsa_balance');
    const v = (await row(one.code)).version;
    await markRsaBalanceCash(t(), step(one.code, v));
    expect(await row(one.code)).toMatchObject({ status: 'completed', balanceMethod: 'cash' });
    // The customer's online payment arrives after the cash: real money, refunded once.
    const cap = fact(o.providerOrderId, o.amountPaise);
    expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'needs_refund' });
    expect(await applyRazorpayPayment(t(), cap)).toEqual({ outcome: 'unchanged' });
    const refunds = await refundsOf(one.code);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountPaise: 130_000, source: 'duplicate_payment' });
    expect((await row(one.code)).balanceMethod).toBe('cash');

    const two = await inProgress();
    await billRsa(t(), { ...step(two.code, two.version), lines: LINES });
    expect(await pay(two.code, 'rsa_balance')).toEqual({ outcome: 'paid' });
    await expect(
      markRsaBalanceCash(t(), step(two.code, (await row(two.code)).version)),
    ).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });

  it('refuse bill steps out of order and a stale version', async () => {
    const a = await accepted();
    await expect(billRsa(t(), { ...step(a.code, a.version), lines: LINES })).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
    await expect(startRsaWork(t(), step(a.code, a.version))).rejects.toMatchObject({ code: 'WRONG_STEP' });
    await expect(markRsaEnRoute(t(), step(a.code, a.version - 1))).rejects.toMatchObject({
      code: 'STALE_REQUEST',
    });
    await expect(billRsa(t(), { ...step(a.code, a.version), lines: [] })).rejects.toMatchObject({
      code: 'BILL_EMPTY',
    });
  });
});

describe('integrity constraints', () => {
  it('keep the timeline append-only', async () => {
    const [e] = await db.select().from(s.rsaEvents).limit(1);
    await expect(
      db.update(s.rsaEvents).set({ visibleToCustomer: false }).where(eq(s.rsaEvents.id, e!.id)),
    ).rejects.toThrow();
    await expect(db.delete(s.rsaEvents).where(eq(s.rsaEvents.id, e!.id))).rejects.toThrow();
  });

  it('refuse a refund with no target or two targets, and a payment with the wrong purpose target', async () => {
    const id = await idOf((await db.select({ c: s.rsaRequests.code }).from(s.rsaRequests).limit(1))[0]!.c);
    const base = {
      amountPaise: 100,
      idemKey: `sys_chk_${String((payN += 1)).padStart(8, '0')}`,
      source: 'rsa_cancelled',
      reasonCode: 'rsa_cancelled',
      mode: 'bank_upi' as const,
      destinationEnc: null,
    };
    await expect(db.insert(s.refunds).values(base)).rejects.toThrow();
    await expect(
      db
        .insert(s.payments)
        .values({ purpose: 'rsa_advance', providerOrderId: 'order_chk_1', amountPaise: 100 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(s.payments)
        .values({ purpose: 'order', rsaRequestId: id, providerOrderId: 'order_chk_2', amountPaise: 100 }),
    ).rejects.toThrow();
  });

  it('keep the balance maths in the table: a wrong balance cannot be stored', async () => {
    const j = await inProgress();
    const id = await idOf(j.code);
    await expect(
      db
        .update(s.rsaRequests)
        .set({
          status: 'billed',
          totalPaise: 100_000,
          balancePaise: 1,
          overpaidPaise: 0,
          billedAt: new Date(),
        })
        .where(eq(s.rsaRequests.id, id)),
    ).rejects.toThrow();
  });

  it('never leak an arrival code in the stored row', async () => {
    const [c] = await db.select().from(s.rsaArrivalCodes).limit(1);
    expect(c!.codeEnc).toMatch(/^v1\./);
  });
});
