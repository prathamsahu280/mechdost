/**
 * Service requests (spec 06 acceptance tests; spec 14 integrity): every move follows serviceRequestMachine as a
 * compare-and-set on (status, version); an estimate revision clears every approval; the bill is the approved lines
 * with GST by registration and the rupee round-off; the odometer never goes back; a workshop sees only its own
 * requests, a customer only theirs, staff only their cities (404 otherwise); the estimate WhatsApp is queued.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { computeServiceBill } from '@mechdost/shared/service-bill';
import type { CreateServiceRequestInput, SendEstimateInput } from '@mechdost/shared/service-requests';
import {
  serviceRequestMachine,
  SERVICE_REQUEST_STATES,
  type ServiceRequestStatus,
} from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';
import {
  advanceJob,
  billJob,
  cancelMyServiceRequest,
  createServiceRequest,
  decideEstimate,
  decideProposal,
  declineRequest,
  getAdminServiceRequest,
  getMyServiceRequest,
  getWorkshopRequest,
  listAdminServiceRequests,
  listMyServiceRequests,
  listWorkshopRequests,
  lockRequest,
  markJobPaid,
  proposeSlot,
  reassignServiceRequest,
  receiveVehicle,
  rejectServiceRequest,
  returnVehicle,
  saveNotificationTemplate,
  sendEstimate,
  setWorkshopStanding,
  getAdminWorkshop,
  transitionRequest,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const W: Record<string, { id: string; slug: string }> = {};
const TODAY = istDateString(new Date());
let keyN = 0;

const LINES: SendEstimateInput['lines'] = [
  { description: 'Engine oil 1 L', serviceKey: null, qty: 1, unitPaise: 45_000, gstRateBp: 1800 },
  { description: 'Labour', serviceKey: 'routine2w', qty: 1, unitPaise: 80_000, gstRateBp: 1800 },
  { description: 'Brake pads', serviceKey: null, qty: 2, unitPaise: 32_050, gstRateBp: 2800 },
];

async function request(over: Partial<CreateServiceRequestInput> = {}, userId = f.customer) {
  keyN += 1;
  return createServiceRequest(t(), {
    userId,
    idempotencyKey: `svc-test-key-${String(keyN).padStart(6, '0')}`,
    request: {
      workshopSlug: W.main!.slug,
      vehicleType: '2W',
      vehicleId: null,
      vehicle: 'Honda Activa 6G',
      serviceKeys: ['routine2w'],
      concern: null,
      pincode: '492001',
      lat: null,
      lng: null,
      preferredDate: TODAY,
      preferredSlot: 'morning',
      pickup: false,
      ...over,
    },
  });
}

const ws = (key = 'main') => [W[key]!.id];
const step = (code: string, version: number, key = 'main') => ({
  workshopIds: ws(key),
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

/** A request taken through to `vehicle_received` with the given odometer. */
async function received(odometerKm = 12_000, over: Partial<CreateServiceRequestInput> = {}) {
  const r = await request(over);
  let v = (
    await proposeSlot(t(), {
      ...step(r.code, r.version),
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      note: null,
    })
  ).version;
  v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
    .version;
  v = (await receiveVehicle(t(), { ...step(r.code, v), odometerKm })).version;
  return { code: r.code, version: v };
}

async function items(code: string) {
  return (await getMyServiceRequest(t(), f.customer, code, 'en')).estimate?.items ?? [];
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.main = await addWorkshop(db, f, { name: 'Main', gstin: '22AAAAA0000A1Z5' });
  W.other = await addWorkshop(db, f, { name: 'Other' });
  W.unregistered = await addWorkshop(db, f, { name: 'Unregistered', gstin: null });
  W.paused = await addWorkshop(db, f, { name: 'Paused' });
  W.bhilai = await addWorkshop(db, f, { name: 'Bhilai', pincode: '490001', lat: 21.21, lng: 81.38 });
  const p = await getAdminWorkshop(t(), { all: true }, W.paused.id);
  await setWorkshopStanding(t(), {
    scope: { all: true },
    staffUserId: f.staff,
    workshopId: W.paused.id,
    status: 'paused',
    reason: 'Paused for checks',
    expectedVersion: p.version,
  });
  for (const locale of ['en', 'hi'] as const)
    await saveNotificationTemplate(t(), {
      key: 'service.estimate_sent',
      channel: 'whatsapp',
      locale,
      body: 'Your estimate for {{1}} is ready.',
      enabled: true,
      expectedVersion: null,
      staffUserId: f.staff,
    });
});

afterAll(async () => {
  await client.close();
});

describe('service request lifecycle', () => {
  it('request → proposal → confirmed → received → estimate → per-line approval → work → bill → paid', async () => {
    const r = await request();
    expect(r).toMatchObject({ status: 'awaiting_workshop', replayed: false });
    expect(r.code).toMatch(/^SR-RPR-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
    let v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version),
        date: TODAY,
        slot: 'evening',
        lowPaise: 80_000,
        highPaise: 150_000,
        note: 'Bring the RC',
      })
    ).version;
    const proposed = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(proposed.proposal).toMatchObject({ slot: 'evening', status: 'pending', note: 'Bring the RC' });
    expect(proposed.workshop?.phone).toBeNull(); // shared only once confirmed
    v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
      .version;
    const confirmed = await getWorkshopRequest(t(), ws(), r.code, 'en');
    expect(confirmed.customer).toEqual({ name: 'Ravi', phone: '+919811100001' });
    v = (await receiveVehicle(t(), { ...step(r.code, v), odometerKm: 1_000 })).version;
    const sent = await sendEstimate(t(), { ...step(r.code, v), lines: LINES });
    expect(sent).toMatchObject({ status: 'estimate_sent', revision: 1 });
    const outbox = await db.select().from(s.notificationOutbox);
    expect(outbox).toEqual([
      expect.objectContaining({
        templateKey: 'service.estimate_sent',
        recipient: '+919811100001',
        locale: 'hi',
        payload: { requestCode: r.code },
      }),
    ]);
    const lines = await items(r.code);
    expect(lines.map((l) => l.decision)).toEqual(['pending', 'pending', 'pending']);
    v = (
      await decideEstimate(t(), {
        userId: f.customer,
        code: r.code,
        decision: {
          revision: 1,
          version: sent.version,
          consent: true,
          decisions: [
            { itemId: lines[0]!.id, decision: 'approved' },
            { itemId: lines[1]!.id, decision: 'approved' },
            { itemId: lines[2]!.id, decision: 'declined' },
          ],
        },
      })
    ).version;
    v = (await advanceJob(t(), { ...step(r.code, v), to: 'in_progress' })).version;
    v = (await advanceJob(t(), { ...step(r.code, v), to: 'ready' })).version;
    const billed = await billJob(t(), step(r.code, v));
    const expected = computeServiceBill(
      LINES.map((l, i) => ({ ...l, id: String(i), decision: i < 2 ? 'approved' : 'declined' })),
      { gstRegistered: true },
    );
    expect(billed.totalPaise).toBe(expected.totalPaise);
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(view.bill).toMatchObject({
      taxablePaise: 125_000,
      cgstPaise: expected.cgstPaise,
      sgstPaise: expected.sgstPaise,
      roundOffPaise: expected.roundOffPaise,
      totalPaise: expected.totalPaise,
      paidAt: null,
    });
    expect(view.bill?.lines.map((l) => l.description)).toEqual(['Engine oil 1 L', 'Labour']);
    const done = await markJobPaid(t(), { ...step(r.code, billed.version), method: 'upi' });
    expect(done.status).toBe('completed');
    const final = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(final.bill).toMatchObject({ method: 'upi' });
    expect(final.timeline.map((e) => e.to)).toEqual([
      'requested',
      'awaiting_workshop',
      'proposed',
      'confirmed',
      'vehicle_received',
      'estimate_sent',
      'approved',
      'in_progress',
      'ready',
      'billed',
      'paid',
      'completed',
    ]);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'service_request'));
    expect(audit.length).toBeGreaterThanOrEqual(12);
    // Paying twice is refused: the request moved on.
    await expect(markJobPaid(t(), { ...step(r.code, done.version), method: 'cash' })).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
  });

  it('a new estimate revision supersedes the old one and clears every approval; a stale revision is refused', async () => {
    const r = await received();
    const v1 = await sendEstimate(t(), { ...step(r.code, r.version), lines: LINES });
    // Not while the customer is deciding (machine: estimate_sent → estimate_sent is not a move).
    await expect(sendEstimate(t(), { ...step(r.code, v1.version), lines: LINES })).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
    const first = await items(r.code);
    const approved = await decideEstimate(t(), {
      userId: f.customer,
      code: r.code,
      decision: {
        revision: 1,
        version: v1.version,
        consent: true,
        decisions: first.map((l) => ({ itemId: l.id, decision: 'approved' as const })),
      },
    });
    const v2 = await sendEstimate(t(), { ...step(r.code, approved.version), lines: LINES.slice(0, 2) });
    expect(v2.revision).toBe(2);
    const second = await items(r.code);
    expect(second.map((l) => l.decision)).toEqual(['pending', 'pending']);
    const old = await db.select().from(s.estimates).where(eq(s.estimates.revision, 1));
    expect(old.some((e) => e.status === 'superseded')).toBe(true);
    await expect(
      decideEstimate(t(), {
        userId: f.customer,
        code: r.code,
        decision: {
          revision: 1,
          version: v2.version,
          consent: true,
          decisions: second.map((l) => ({ itemId: l.id, decision: 'approved' as const })),
        },
      }),
    ).rejects.toMatchObject({ code: 'STALE_ESTIMATE' });
    await expect(
      decideEstimate(t(), {
        userId: f.customer,
        code: r.code,
        decision: {
          revision: 2,
          version: v2.version,
          consent: true,
          decisions: [{ itemId: second[0]!.id, decision: 'approved' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'DECISION_INCOMPLETE' });
    // Work cannot start or be billed before the new revision is decided.
    await expect(advanceJob(t(), { ...step(r.code, v2.version), to: 'in_progress' })).rejects.toMatchObject({
      code: 'WRONG_STEP',
    });
    await expect(billJob(t(), step(r.code, v2.version))).rejects.toMatchObject({ code: 'WRONG_STEP' });
  });

  it('all lines declined → no work approved → a new estimate or the vehicle goes back', async () => {
    const r = await received();
    const sent = await sendEstimate(t(), { ...step(r.code, r.version), lines: LINES });
    const lines = await items(r.code);
    const none = await decideEstimate(t(), {
      userId: f.customer,
      code: r.code,
      decision: {
        revision: 1,
        version: sent.version,
        consent: true,
        decisions: lines.map((l) => ({ itemId: l.id, decision: 'declined' as const })),
      },
    });
    expect(none.status).toBe('no_work_approved');
    const back = await returnVehicle(t(), step(r.code, none.version));
    expect(back.status).toBe('completed');

    const again = await received(15_000, { vehicle: 'Bajaj Pulsar 150' });
    const s1 = await sendEstimate(t(), { ...step(again.code, again.version), lines: LINES.slice(0, 1) });
    const [only] = await items(again.code);
    const nw = await decideEstimate(t(), {
      userId: f.customer,
      code: again.code,
      decision: {
        revision: 1,
        version: s1.version,
        consent: true,
        decisions: [{ itemId: only!.id, decision: 'declined' }],
      },
    });
    const s2 = await sendEstimate(t(), { ...step(again.code, nw.version), lines: LINES.slice(1, 2) });
    expect(s2).toMatchObject({ status: 'estimate_sent', revision: 2 });
  });

  it('an unregistered workshop bills without GST', async () => {
    const r = await request({ workshopSlug: W.unregistered!.slug, vehicle: 'TVS Jupiter' });
    let v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version, 'unregistered'),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      })
    ).version;
    v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
      .version;
    v = (await receiveVehicle(t(), { ...step(r.code, v, 'unregistered'), odometerKm: 10 })).version;
    v = (await sendEstimate(t(), { ...step(r.code, v, 'unregistered'), lines: LINES })).version;
    const lines = await items(r.code);
    v = (
      await decideEstimate(t(), {
        userId: f.customer,
        code: r.code,
        decision: {
          revision: 1,
          version: v,
          consent: true,
          decisions: lines.map((l) => ({ itemId: l.id, decision: 'approved' as const })),
        },
      })
    ).version;
    v = (await advanceJob(t(), { ...step(r.code, v, 'unregistered'), to: 'in_progress' })).version;
    v = (await advanceJob(t(), { ...step(r.code, v, 'unregistered'), to: 'ready' })).version;
    await billJob(t(), step(r.code, v, 'unregistered'));
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(view.bill).toMatchObject({
      gstRegistered: false,
      cgstPaise: 0,
      sgstPaise: 0,
      taxablePaise: 189_100,
      totalPaise: 189_100,
    });
  });
});

describe('rules', () => {
  it('the odometer never goes back for the same vehicle (an equal reading is fine)', async () => {
    await received(50_000, { vehicle: 'Hero Splendor Plus' });
    const r = await request({ vehicle: '  hero   splendor plus ' });
    let v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      })
    ).version;
    v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
      .version;
    await expect(receiveVehicle(t(), { ...step(r.code, v), odometerKm: 49_999 })).rejects.toMatchObject({
      code: 'ODOMETER_BELOW_LAST',
      details: { lastKm: 50_000 },
    });
    expect((await receiveVehicle(t(), { ...step(r.code, v), odometerKm: 50_000 })).status).toBe(
      'vehicle_received',
    );
  });

  it('a stale version is a conflict; the same idempotency key returns the same request', async () => {
    const key = 'svc-same-key-000000001';
    const body: CreateServiceRequestInput = {
      workshopSlug: W.main!.slug,
      vehicleType: '2W',
      vehicle: 'Ola S1',
      serviceKeys: [],
      concern: 'Strange noise from the motor',
      pincode: '492004',
      preferredDate: TODAY,
      preferredSlot: 'afternoon',
      pickup: true,
    };
    const a = await createServiceRequest(t(), { userId: f.customer, idempotencyKey: key, request: body });
    const b = await createServiceRequest(t(), { userId: f.customer, idempotencyKey: key, request: body });
    expect(b).toEqual({ ...a, replayed: true });
    await expect(
      proposeSlot(t(), {
        ...step(a.code, a.version - 1),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
  });

  it('refuses unknown services, a vehicle type the workshop does not serve, a paused workshop and past dates', async () => {
    await expect(request({ serviceKeys: ['nope'] })).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' });
    await expect(
      request({ vehicleType: '3W', serviceKeys: [], concern: 'Auto check' }),
    ).rejects.toMatchObject({
      code: 'VEHICLE_NOT_SERVED',
    });
    await expect(request({ vehicleType: '4W' })).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' });
    await expect(request({ workshopSlug: W.paused!.slug })).rejects.toMatchObject({ status: 404 });
    await expect(request({ workshopSlug: W.bhilai!.slug })).rejects.toMatchObject({
      code: 'WORKSHOP_OUT_OF_AREA',
    });
    await expect(request({ preferredDate: '2020-01-01' })).rejects.toMatchObject({
      code: 'DATE_OUT_OF_RANGE',
    });
    await expect(request({ workshopSlug: null, serviceKeys: [] })).rejects.toMatchObject({
      code: 'CONCERN_REQUIRED',
    });
    await expect(request({ vehicleId: '00000000-0000-7000-8000-000000000000' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('the customer cancels only before the vehicle is received, with a reason code', async () => {
    const r = await request();
    let v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      })
    ).version;
    const declined = await decideProposal(t(), {
      userId: f.customer,
      code: r.code,
      accept: false,
      expectedVersion: v,
    });
    expect(declined.status).toBe('awaiting_workshop');
    v = (
      await proposeSlot(t(), {
        ...step(r.code, declined.version),
        date: TODAY,
        slot: 'evening',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      })
    ).version;
    v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
      .version;
    const cancelled = await cancelMyServiceRequest(t(), {
      userId: f.customer,
      code: r.code,
      reasonCode: 'slot_not_suitable',
      expectedVersion: v,
    });
    expect(cancelled.status).toBe('cancelled');
    const late = await received();
    await expect(
      cancelMyServiceRequest(t(), {
        userId: f.customer,
        code: late.code,
        reasonCode: 'changed_mind',
        expectedVersion: late.version,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_STEP' });
  });

  it('one pending proposal per request (partial unique index)', async () => {
    const r = await request();
    await proposeSlot(t(), {
      ...step(r.code, r.version),
      date: TODAY,
      slot: 'morning',
      lowPaise: 1,
      highPaise: 2,
      note: null,
    });
    const [row] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, r.code));
    await expect(
      db.insert(s.serviceProposals).values({
        requestId: row!.id,
        workshopId: W.main!.id,
        proposedDate: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
      }),
    ).rejects.toThrow();
  });

  it('service_events is append-only', async () => {
    await expect(db.execute(sql`update service_events set to_status = 'completed'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from service_events`)).rejects.toThrow();
  });
});

describe('scope', () => {
  it('another workshop, another customer and staff of another city get 404', async () => {
    const r = await request();
    await expect(getWorkshopRequest(t(), ws('other'), r.code, 'en')).rejects.toMatchObject({ status: 404 });
    await expect(
      proposeSlot(t(), {
        ...step(r.code, r.version, 'other'),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getMyServiceRequest(t(), f.other, r.code, 'en')).rejects.toMatchObject({ status: 404 });
    await expect(
      cancelMyServiceRequest(t(), {
        userId: f.other,
        code: r.code,
        reasonCode: 'other',
        expectedVersion: r.version,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const bhilai = { all: false as const, cityIds: [f.bhilai] };
    await expect(getAdminServiceRequest(t(), bhilai, r.code, 'en')).rejects.toMatchObject({ status: 404 });
    expect((await listMyServiceRequests(t(), f.other, {}, 'en')).items).toEqual([]);
    expect((await listWorkshopRequests(t(), [], 'new', {}, 'en')).items).toEqual([]);
    const mine = await listMyServiceRequests(t(), f.customer, { limit: 2 }, 'en');
    expect(mine.items).toHaveLength(2);
    expect(mine.nextCursor).not.toBeNull();
    const more = await listMyServiceRequests(t(), f.customer, { limit: 2, cursor: mine.nextCursor }, 'en');
    expect(more.items[0]!.code).not.toBe(mine.items[1]!.code);
  });
});

describe('routing', () => {
  it('decline → needs routing (the workshop no longer sees it) → reassign to an eligible workshop only', async () => {
    const r = await request();
    const back = await declineRequest(t(), { ...step(r.code, r.version), reasonCode: 'fully_booked' });
    expect(back.status).toBe('needs_routing');
    await expect(getWorkshopRequest(t(), ws(), r.code, 'en')).rejects.toMatchObject({ status: 404 });
    const queue = await listAdminServiceRequests(t(), { all: true }, 'needs_routing', {}, 'en');
    expect(queue.items.map((i) => i.code)).toContain(r.code);
    const scope = { all: true as const };
    for (const [key, code] of [
      ['paused', 'WORKSHOP_NOT_ELIGIBLE'],
      ['bhilai', 'WORKSHOP_OUT_OF_AREA'],
    ] as const)
      await expect(
        reassignServiceRequest(t(), {
          scope,
          code: r.code,
          workshopId: W[key]!.id,
          expectedVersion: back.version,
          staffUserId: f.staff,
        }),
      ).rejects.toMatchObject({ code });
    const moved = await reassignServiceRequest(t(), {
      scope,
      code: r.code,
      workshopId: W.other!.id,
      expectedVersion: back.version,
      staffUserId: f.staff,
    });
    expect(moved.status).toBe('awaiting_workshop');
    expect((await getWorkshopRequest(t(), ws('other'), r.code, 'en')).status).toBe('awaiting_workshop');
    // Moved again before the workshop answered: same status, new workshop, new version.
    const again = await reassignServiceRequest(t(), {
      scope,
      code: r.code,
      workshopId: W.main!.id,
      expectedVersion: moved.version,
      staffUserId: f.staff,
    });
    expect(again).toEqual({ status: 'awaiting_workshop', version: moved.version + 1 });
    await expect(getWorkshopRequest(t(), ws('other'), r.code, 'en')).rejects.toMatchObject({ status: 404 });
    // From proposed: the open proposal is withdrawn.
    const p = await proposeSlot(t(), {
      ...step(r.code, again.version),
      date: TODAY,
      slot: 'morning',
      lowPaise: 1,
      highPaise: 2,
      note: null,
    });
    const third = await reassignServiceRequest(t(), {
      scope,
      code: r.code,
      workshopId: W.other!.id,
      expectedVersion: p.version,
      staffUserId: f.staff,
    });
    expect(third.status).toBe('awaiting_workshop');
    expect((await getMyServiceRequest(t(), f.customer, r.code, 'en')).proposal).toBeNull();
  });

  it('"Let MechDost choose" waits for routing; staff reject it with a reason and a message', async () => {
    const r = await request({
      workshopSlug: null,
      serviceKeys: [],
      concern: 'Car will not start in the morning',
    });
    expect(r.status).toBe('needs_routing');
    const rejected = await rejectServiceRequest(t(), {
      scope: { all: true },
      code: r.code,
      reasonCode: 'no_workshop_nearby',
      message: 'Sorry, no workshop near you can take this yet.',
      expectedVersion: r.version,
      staffUserId: f.staff,
    });
    expect(rejected.status).toBe('rejected');
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(view.reasonCode).toBe('no_workshop_nearby');
    expect(view.customerMessage).toContain('Sorry');
  });
});

describe('state machine enforcement (every pair of states)', () => {
  it('transitionRequest applies exactly the moves serviceRequestMachine allows, for the allowed actors only', async () => {
    const r = await received(900_000, { vehicle: 'Machine probe' });
    const [row] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, r.code));
    const id = row!.id;
    const actors = ['customer', 'workshop', 'admin', 'system'] as const;
    const reasonFor = (st: ServiceRequestStatus) =>
      st === 'cancelled' ? 'other' : st === 'rejected' ? 'other' : null;
    let checked = 0;
    for (const from of SERVICE_REQUEST_STATES) {
      for (const to of SERVICE_REQUEST_STATES) {
        await db.execute(sql`update service_requests set status = ${from}, status_reason_code = ${reasonFor(from)},
          customer_message = ${from === 'rejected' ? 'Rejected for the probe' : null}, workshop_id = ${W.main!.id}
          where id = ${id}`);
        const allowedActor = actors.find((a) => serviceRequestMachine.canActor(from, to, a));
        const deniedActor = actors.find((a) => !serviceRequestMachine.canActor(from, to, a));
        const attempt = async (actor: (typeof actors)[number]) =>
          db.transaction(async (tx) => {
            const req = await lockRequest(tx, eq(s.serviceRequests.id, id));
            return transitionRequest(tx, {
              request: req,
              to,
              expectedVersion: req.version,
              actor: { type: actor, userId: null },
              patch: {
                statusReasonCode: reasonFor(to),
                customerMessage: to === 'rejected' ? 'Rejected for the probe' : null,
              },
            });
          });
        if (allowedActor) {
          expect((await attempt(allowedActor)).status, `${from} → ${to}`).toBe(to);
        } else {
          await expect(attempt('admin'), `${from} → ${to}`).rejects.toMatchObject({
            code: 'ILLEGAL_TRANSITION',
          });
        }
        if (allowedActor && deniedActor) {
          await db.execute(sql`update service_requests set status = ${from}, status_reason_code = ${reasonFor(from)},
            customer_message = ${from === 'rejected' ? 'Rejected for the probe' : null} where id = ${id}`);
          await expect(attempt(deniedActor), `${deniedActor}: ${from} → ${to}`).rejects.toMatchObject({
            code: 'ACTOR_NOT_ALLOWED',
          });
        }
        checked += 1;
      }
    }
    expect(checked).toBe(SERVICE_REQUEST_STATES.length ** 2);
  });
});
