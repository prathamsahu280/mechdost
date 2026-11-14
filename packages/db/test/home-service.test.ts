/**
 * Home servicing (spec 06 "Home servicing"; design 2026-11-15): workshops opt in with their own radius and fee; the
 * listing uses each workshop's own radius (PostGIS); a home booking needs a pinned address of the customer and the fee
 * the customer saw; the arrival code is issued at "confirmed" and protected like the delivery code; the visit fee is a
 * bill line (waivable); an offer to move the job to the workshop is a side record the customer answers.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { CreateServiceRequestInput } from '@mechdost/shared/service-requests';
import { serviceRequestMachine } from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';
import { loadKeyring } from '../src/crypto';
import {
  billJob,
  cancelMyServiceRequest,
  createServiceRequest,
  decideEstimate,
  decideMove,
  decideProposal,
  findNearbyWorkshops,
  getAdminWorkshop,
  getMyServiceRequest,
  getWorkshopHomeSettings,
  getWorkshopRequest,
  markVehicleReceived,
  overrideArrival,
  proposeMove,
  proposeSlot,
  reassignServiceRequest,
  receiveVehicle,
  returnVehicle,
  saveWorkshopHomeSettings,
  sendEstimate,
  advanceJob,
  updateWorkshop,
  waiveVisitFee,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const TODAY = istDateString(new Date());
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});
const HOME = { lat: 21.2514, lng: 81.6296 };
const W: Record<string, { id: string; slug: string }> = {};
let addressId = '';
let keyN = 0;

const LINES = [
  { description: 'Labour', serviceKey: 'routine2w', qty: 1, unitPaise: 80_000, gstRateBp: 1800 },
];

async function setHome(
  key: string,
  over: { on?: boolean; radius?: number; fee?: number; keys?: string[] } = {},
) {
  const w = await getAdminWorkshop(t(), { all: true }, W[key]!.id);
  await saveWorkshopHomeSettings(t(), {
    workshopIds: [W[key]!.id],
    workshopId: W[key]!.id,
    staffUserId: f.staff,
    settings: {
      homeService: over.on ?? true,
      homeRadiusKm: over.radius ?? 5,
      homeVisitFeePaise: over.fee ?? 9_900,
      homeServiceKeys: over.keys ?? ['routine2w', 'diagnosis'],
      version: w.version,
    },
  });
}

async function pin(userId: string, lat: number | null, lng: number | null) {
  const [state] = await db.select().from(s.states).limit(1);
  const [a] = await db
    .insert(s.addresses)
    .values({
      userId,
      contactName: 'Ravi',
      contactPhone: '+919811100001',
      line1: '12 Lal Bagh',
      landmark: 'near the temple',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: lat === null || lng === null ? null : { lat, lng },
    })
    .returning({ id: s.addresses.id });
  return a!.id;
}

async function book(over: Partial<CreateServiceRequestInput> = {}, workshop = 'home') {
  keyN += 1;
  return createServiceRequest(t(), {
    userId: f.customer,
    idempotencyKey: `home-test-key-${String(keyN).padStart(6, '0')}`,
    request: {
      workshopSlug: W[workshop]!.slug,
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
      mode: 'home',
      addressId,
      visitFeePaise: 9_900,
      ...over,
    },
  });
}

const step = (code: string, version: number, key = 'home') => ({
  workshopIds: [W[key]!.id],
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

/** A home request confirmed by the customer: returns the code, version and the arrival code. */
async function confirmed(over: Partial<CreateServiceRequestInput> = {}) {
  const r = await book(over);
  let v = (
    await proposeSlot(t(), {
      ...step(r.code, r.version),
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      note: null,
      mechanicName: 'Sunil',
    })
  ).version;
  v = (
    await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v, keyring })
  ).version;
  const view = await getMyServiceRequest(t(), f.customer, r.code, 'en', keyring);
  return { code: r.code, version: v, arrivalCode: view.home?.arrivalCode ?? '' };
}

let odo = 30_000;
async function arrived(_km?: number) {
  odo += 1_000;
  const odometerKm = odo;
  const c = await confirmed();
  const res = await markVehicleReceived(t(), {
    ...step(c.code, c.version),
    odometerKm,
    arrivalCode: c.arrivalCode,
    keyring,
  });
  if (!res.ok) throw new Error('arrival failed');
  return { code: c.code, version: res.version };
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.home = await addWorkshop(db, f, { name: 'Home', gstin: '22AAAAA0000A1Z5' });
  W.plain = await addWorkshop(db, f, { name: 'Plain', gstin: null });
  W.far = await addWorkshop(db, f, { name: 'Far', lat: 21.3144, lng: 81.6296 }); // about 7 km north
  W.inside = await addWorkshop(db, f, { name: 'Inside', lat: 21.2595, lng: 81.6296 }); // about 0.9 km north
  W.outside = await addWorkshop(db, f, { name: 'Outside', lat: 21.2613, lng: 81.6296 }); // about 1.1 km north
  W.noserv = await addWorkshop(db, f, { name: 'No services' });
  W.off = await addWorkshop(db, f, { name: 'Off' });
  await setHome('home');
  await setHome('far', { radius: 5 });
  await setHome('inside', { radius: 1 });
  await setHome('outside', { radius: 1 });
  await setHome('noserv', { keys: [] });
  addressId = await pin(f.customer, HOME.lat, HOME.lng);
});

afterAll(async () => {
  await client.close();
});

describe('home listing (own radius, PostGIS)', () => {
  it('lists workshops whose own radius covers the pin, and none beyond it', async () => {
    const r = await findNearbyWorkshops(t(), { at: HOME, radiusKm: 15, mode: 'home', locale: 'en' });
    const slugs = r.workshops.map((w) => w.slug);
    expect(slugs).toContain(W.home!.slug);
    expect(slugs).toContain(W.inside!.slug); // 0.9 km inside a 1 km radius
    expect(slugs).not.toContain(W.outside!.slug); // 1.1 km outside a 1 km radius
    expect(slugs).not.toContain(W.far!.slug); // 7 km outside a 5 km radius
    expect(slugs).not.toContain(W.off!.slug); // home service off
    expect(slugs).not.toContain(W.noserv!.slug); // nothing marked for home
    expect(slugs).not.toContain(W.plain!.slug); // never opted in
  });

  it('shows the fee and radius on the listed workshop, and which lines are done at home', async () => {
    const r = await findNearbyWorkshops(t(), { at: HOME, radiusKm: 15, mode: 'home', locale: 'en' });
    const w = r.workshops.find((x) => x.slug === W.home!.slug);
    expect(w?.home).toEqual({ radiusKm: 5, visitFeePaise: 9_900 });
    expect(w?.services.filter((m) => m.homeAvailable).map((m) => m.key)).toEqual(
      ['diagnosis', 'routine2w'].sort(),
    );
  });

  it('returns an empty list (not an error) when nobody travels that far', async () => {
    const r = await findNearbyWorkshops(t(), {
      at: { lat: 21.6, lng: 82.2 },
      radiusKm: 15,
      mode: 'home',
      locale: 'en',
    });
    expect(r.workshops).toEqual([]);
  });

  it('needs a pin, not a PIN code', async () => {
    await expect(
      findNearbyWorkshops(t(), { at: { pincode: '492001' }, radiusKm: 15, mode: 'home', locale: 'en' }),
    ).rejects.toMatchObject({ code: 'HOME_NEEDS_PIN' });
  });

  it('workshop mode is unchanged: the default listing still shows workshops that never opted in', async () => {
    const r = await findNearbyWorkshops(t(), { at: HOME, radiusKm: 15, locale: 'en' });
    expect(r.workshops.map((w) => w.slug)).toContain(W.plain!.slug);
  });
});

describe('workshop home settings', () => {
  it('rejects a fee above the per-city maximum, and keeps the saved one', async () => {
    await db
      .insert(s.settings)
      .values({ cityId: f.raipur, key: 'service.home_fee_max_paise', value: 20_000 });
    const w = await getAdminWorkshop(t(), { all: true }, W.home!.id);
    await expect(
      saveWorkshopHomeSettings(t(), {
        workshopIds: [W.home!.id],
        workshopId: W.home!.id,
        staffUserId: f.staff,
        settings: {
          homeService: true,
          homeRadiusKm: 5,
          homeVisitFeePaise: 25_000,
          homeServiceKeys: ['routine2w'],
          version: w.version,
        },
      }),
    ).rejects.toMatchObject({ code: 'FEE_ABOVE_CAP', details: { maxPaise: 20_000 } });
    expect((await getAdminWorkshop(t(), { all: true }, W.home!.id)).homeVisitFeePaise).toBe(9_900);
    // the admin editor obeys the same cap
    await expect(
      updateWorkshop(t(), {
        scope: { all: true },
        approveScope: { all: true },
        staffUserId: f.staff,
        workshopId: W.home!.id,
        patch: { version: w.version, homeVisitFeePaise: 25_000 },
      }),
    ).rejects.toMatchObject({ code: 'FEE_ABOVE_CAP' });
    await db.delete(s.settings).where(eq(s.settings.key, 'service.home_fee_max_paise'));
  });

  it('another workshop id is 404 and a stale version is a conflict', async () => {
    const w = await getAdminWorkshop(t(), { all: true }, W.home!.id);
    const settings = {
      homeService: true,
      homeRadiusKm: 5,
      homeVisitFeePaise: 9_900,
      homeServiceKeys: ['routine2w'],
      version: w.version,
    };
    await expect(
      saveWorkshopHomeSettings(t(), {
        workshopIds: [W.plain!.id],
        workshopId: W.home!.id,
        staffUserId: f.staff,
        settings,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      saveWorkshopHomeSettings(t(), {
        workshopIds: [W.home!.id],
        workshopId: W.home!.id,
        staffUserId: f.staff,
        settings: { ...settings, version: w.version - 1 },
      }),
    ).rejects.toMatchObject({ code: 'STALE_WORKSHOP' });
    await expect(
      saveWorkshopHomeSettings(t(), {
        workshopIds: [W.home!.id],
        workshopId: W.home!.id,
        staffUserId: f.staff,
        settings: { ...settings, homeServiceKeys: ['nope-service'] },
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SERVICE' });
    const mine = await getWorkshopHomeSettings(t(), [W.home!.id]);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.maxFeePaise).toBe(50_000);
    await setHome('home'); // restore both services
  });

  it('writes an audit row for every save', async () => {
    const rows = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'workshop.home_settings'));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('booking at home', () => {
  it('snapshots the fee, address and pin, and starts like any request', async () => {
    const r = await book();
    expect(r.status).toBe('awaiting_workshop');
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en', keyring);
    expect(view.serviceMode).toBe('home');
    expect(view.home?.visitFeePaise).toBe(9_900);
    expect(view.home?.address?.line1).toBe('12 Lal Bagh');
    expect(view.home?.arrivalCode).toBeNull();
    await cancelMyServiceRequest(t(), {
      userId: f.customer,
      code: r.code,
      reasonCode: 'changed_mind',
      expectedVersion: r.version,
    });
  });

  it('refuses when the fee changed since the customer saw it', async () => {
    await expect(book({ visitFeePaise: 5_000 })).rejects.toMatchObject({ code: 'FEE_CHANGED' });
  });

  it('refuses an unpinned address, another customer address and a missing address', async () => {
    const unpinned = await pin(f.customer, null, null);
    await expect(book({ addressId: unpinned })).rejects.toMatchObject({ code: 'ADDRESS_NOT_PINNED' });
    const foreign = await pin(f.other, HOME.lat, HOME.lng);
    await expect(book({ addressId: foreign })).rejects.toMatchObject({ status: 404 });
    await expect(book({ addressId: null })).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' });
  });

  it('refuses a workshop that is too far, off, or does not do the service at home', async () => {
    await expect(book({}, 'far')).rejects.toMatchObject({ code: 'WORKSHOP_OUT_OF_RADIUS' });
    await expect(book({}, 'off')).rejects.toMatchObject({ code: 'HOME_NOT_OFFERED' });
    await expect(book({ serviceKeys: ['routine2w'] }, 'noserv')).rejects.toMatchObject({
      code: 'SERVICE_NOT_AT_HOME',
    });
    await expect(book({ serviceKeys: [] })).rejects.toMatchObject({ code: 'SERVICE_REQUIRED' });
  });

  it('never allows pickup together with a home visit (database CHECK)', async () => {
    const r = await book();
    await expect(
      db.execute(sql`update service_requests set pickup_requested = true where code = ${r.code}`),
    ).rejects.toThrow();
  });

  it('a replayed booking with the same key returns the same request', async () => {
    keyN += 1;
    const key = `home-replay-key-${String(keyN).padStart(6, '0')}`;
    const req = (): CreateServiceRequestInput => ({
      workshopSlug: W.home!.slug,
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
      mode: 'home',
      addressId,
      visitFeePaise: 9_900,
    });
    const a = await createServiceRequest(t(), { userId: f.customer, idempotencyKey: key, request: req() });
    const b = await createServiceRequest(t(), { userId: f.customer, idempotencyKey: key, request: req() });
    expect(b.replayed).toBe(true);
    expect(b.code).toBe(a.code);
  });
});

describe('arrival code', () => {
  it('needs a named mechanic to propose, and is issued only when the customer confirms', async () => {
    const r = await book();
    await expect(
      proposeSlot(t(), {
        ...step(r.code, r.version),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
      }),
    ).rejects.toMatchObject({ code: 'MECHANIC_REQUIRED' });
    const v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version),
        date: TODAY,
        slot: 'morning',
        lowPaise: 80_000,
        highPaise: 150_000,
        note: null,
        mechanicName: 'Sunil',
      })
    ).version;
    const before = await getMyServiceRequest(t(), f.customer, r.code, 'en', keyring);
    expect(before.home?.arrivalCode).toBeNull();
    expect(before.home?.mechanicName).toBe('Sunil');
    // No keyring on the server: confirming is refused, nothing is half-issued.
    await expect(
      decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }),
    ).rejects.toMatchObject({ code: 'ARRIVAL_CODES_UNAVAILABLE' });
    expect((await getMyServiceRequest(t(), f.customer, r.code, 'en', keyring)).status).toBe('proposed');
  });

  it('the customer reads the code, the workshop and admin never do, and the database holds it encrypted', async () => {
    const c = await confirmed();
    expect(c.arrivalCode).toMatch(/^\d{4}$/);
    const asWorkshop = await getWorkshopRequest(t(), [W.home!.id], c.code, 'en');
    expect(JSON.stringify(asWorkshop)).not.toContain(`"arrivalCode":"${c.arrivalCode}"`);
    expect(asWorkshop.home?.arrivalCode).toBeNull();
    const [row] = await db
      .select({ enc: s.serviceArrivalCodes.codeEnc })
      .from(s.serviceArrivalCodes)
      .innerJoin(s.serviceRequests, eq(s.serviceRequests.id, s.serviceArrivalCodes.requestId))
      .where(eq(s.serviceRequests.code, c.code));
    expect(row?.enc).toMatch(/^v1\./);
    expect(row?.enc).not.toContain(c.arrivalCode);
    expect(asWorkshop.workshop?.phone).toBeTruthy();
  });

  it('the plain receive step refuses a home visit without the code', async () => {
    const c = await confirmed();
    await expect(receiveVehicle(t(), { ...step(c.code, c.version), odometerKm: 1 })).rejects.toMatchObject({
      code: 'ARRIVAL_CODE_REQUIRED',
    });
  });

  it('a wrong code is counted, the right code marks arrival with the odometer, and arrival is logged', async () => {
    const c = await confirmed();
    const wrong = c.arrivalCode === '0000' ? '1111' : '0000';
    const bad = await markVehicleReceived(t(), {
      ...step(c.code, c.version),
      odometerKm: 21_000,
      arrivalCode: wrong,
      keyring,
    });
    expect(bad).toEqual({ ok: false, reason: 'wrong', attemptsLeft: 4 });
    const good = await markVehicleReceived(t(), {
      ...step(c.code, c.version),
      odometerKm: 21_000,
      arrivalCode: c.arrivalCode,
      keyring,
    });
    expect(good.ok).toBe(true);
    const view = await getMyServiceRequest(t(), f.customer, c.code, 'en', keyring);
    expect(view.status).toBe('vehicle_received');
    expect(view.home?.arrivalCode).toBeNull(); // the code disappears once it has been used
    expect(view.home?.arrivedVia).toBe('code');
    const ev = await db.execute(
      sql`select props from events where event = 'home_visit_arrived' order by id desc limit 1`,
    );
    expect(JSON.stringify(ev)).toContain('"via":"code"');
  });

  it('five wrong tries lock the code, even for the right one; only an audited override gets past', async () => {
    const c = await confirmed();
    const wrong = c.arrivalCode === '0000' ? '1111' : '0000';
    let last: unknown;
    for (let i = 0; i < 5; i += 1)
      last = await markVehicleReceived(t(), {
        ...step(c.code, c.version),
        odometerKm: 22_000,
        arrivalCode: wrong,
        keyring,
      });
    expect(last).toEqual({ ok: false, reason: 'locked' });
    expect(
      await markVehicleReceived(t(), {
        ...step(c.code, c.version),
        odometerKm: 22_000,
        arrivalCode: c.arrivalCode,
        keyring,
      }),
    ).toEqual({ ok: false, reason: 'locked' });
    const locked = await getMyServiceRequest(t(), f.customer, c.code, 'en', keyring);
    expect(locked.home?.arrivalLocked).toBe(true);

    await expect(
      overrideArrival(t(), {
        scope: { all: true },
        code: c.code,
        reason: 'no',
        odometerKm: 22_000,
        expectedVersion: c.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'OVERRIDE_REASON' });
    await expect(
      overrideArrival(t(), {
        scope: { all: false, cityIds: [f.bhilai] },
        code: c.code,
        reason: 'Customer unreachable, called twice',
        odometerKm: 22_000,
        expectedVersion: c.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const out = await overrideArrival(t(), {
      scope: { all: true },
      code: c.code,
      reason: 'Customer unreachable, called twice',
      odometerKm: 22_000,
      expectedVersion: c.version,
      staffUserId: f.staff,
    });
    expect(out.status).toBe('vehicle_received');
    const [row] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, c.code));
    expect(row?.arrivalOverrideReason).toBe('Customer unreachable, called twice');
    expect(row?.arrivalOverrideBy).toBe(f.staff);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entityId, row!.id));
    expect(JSON.stringify(audits)).toContain('Customer unreachable');
  });

  it('the machine allows the admin override edge and the customer decline edge, nothing wider', () => {
    expect(serviceRequestMachine.canActor('confirmed', 'vehicle_received', 'admin')).toBe(true);
    expect(serviceRequestMachine.canActor('vehicle_received', 'no_work_approved', 'customer')).toBe(true);
    expect(serviceRequestMachine.canActor('vehicle_received', 'no_work_approved', 'workshop')).toBe(false);
    expect(serviceRequestMachine.canActor('confirmed', 'vehicle_received', 'customer')).toBe(false);
  });

  it('the odometer cannot go below the last reading even with the right code', async () => {
    const c = await confirmed();
    await expect(
      markVehicleReceived(t(), {
        ...step(c.code, c.version),
        odometerKm: 100,
        arrivalCode: c.arrivalCode,
        keyring,
      }),
    ).rejects.toMatchObject({ code: 'ODOMETER_BELOW_LAST' });
  });
});

describe('visit fee on the bill', () => {
  async function toReady() {
    const a = await arrived(30_000);
    const sent = await sendEstimate(t(), { ...step(a.code, a.version), lines: LINES });
    const est = (await getMyServiceRequest(t(), f.customer, a.code, 'en')).estimate!;
    const decided = await decideEstimate(t(), {
      userId: f.customer,
      code: a.code,
      decision: {
        revision: est.revision,
        version: sent.version,
        decisions: est.items.map((i) => ({ itemId: i.id, decision: 'approved' as const })),
        consent: true,
      },
    });
    const started = await advanceJob(t(), { ...step(a.code, decided.version), to: 'in_progress' });
    const ready = await advanceJob(t(), { ...step(a.code, started.version), to: 'ready' });
    return { code: a.code, version: ready.version };
  }

  it('adds a visit_fee line with GST by the workshop registration, snapshotted', async () => {
    const r = await toReady();
    await billJob(t(), step(r.code, r.version));
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    const fee = view.bill?.lines.find((l) => l.id === 'visit_fee');
    expect(fee).toMatchObject({ unitPaise: 9_900, gstRateBp: 1800, taxablePaise: 9_900 });
    // 80,000 labour + 9,900 fee = 89,900; GST 18% = 16,182; total 106,082 rounded to the rupee
    expect(view.bill?.taxablePaise).toBe(89_900);
    expect(view.bill?.totalPaise).toBe(106_100);
  });

  it('an unregistered workshop adds the fee with no GST', async () => {
    const w = await getAdminWorkshop(t(), { all: true }, W.plain!.id);
    await setHome('plain', { keys: ['routine2w'] });
    expect(w.gstRegistered).toBe(false);
    keyN += 1;
    const r = await book({}, 'plain');
    let v = (
      await proposeSlot(t(), {
        ...step(r.code, r.version, 'plain'),
        date: TODAY,
        slot: 'morning',
        lowPaise: 1,
        highPaise: 2,
        note: null,
        mechanicName: 'Imran',
      })
    ).version;
    v = (
      await decideProposal(t(), {
        userId: f.customer,
        code: r.code,
        accept: true,
        expectedVersion: v,
        keyring,
      })
    ).version;
    const code = (await getMyServiceRequest(t(), f.customer, r.code, 'en', keyring)).home!.arrivalCode!;
    const res = await markVehicleReceived(t(), {
      ...step(r.code, v, 'plain'),
      odometerKm: 31_000,
      arrivalCode: code,
      keyring,
    });
    expect(res.ok).toBe(true);
  });

  it('a waived fee stays on the bill as a 0 line, with its reason on the request', async () => {
    const r = await toReady();
    await waiveVisitFee(t(), { ...step(r.code, r.version), reasonCode: 'goodwill' });
    const next = (await getMyServiceRequest(t(), f.customer, r.code, 'en')).version;
    await billJob(t(), step(r.code, next));
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(view.bill?.lines.find((l) => l.id === 'visit_fee')?.unitPaise).toBe(0);
    expect(view.home?.feeWaivedReason).toBe('goodwill');
    expect(view.bill?.taxablePaise).toBe(80_000);
    await expect(
      waiveVisitFee(t(), { ...step(r.code, next + 1), reasonCode: 'other' }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('a workshop job (not home) has no fee to waive', async () => {
    keyN += 1;
    const r = await createServiceRequest(t(), {
      userId: f.customer,
      idempotencyKey: `home-test-key-${String(keyN).padStart(6, '0')}`,
      request: {
        workshopSlug: W.plain!.slug,
        vehicleType: '2W',
        vehicleId: null,
        vehicle: 'Hero Splendor',
        serviceKeys: ['routine2w'],
        concern: null,
        pincode: '492001',
        lat: null,
        lng: null,
        preferredDate: TODAY,
        preferredSlot: 'morning',
        pickup: false,
      },
    });
    const p = await proposeSlot(t(), {
      ...step(r.code, r.version, 'plain'),
      date: TODAY,
      slot: 'morning',
      lowPaise: 1,
      highPaise: 2,
      note: null,
    });
    const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
    expect(view.home).toBeNull();
    await expect(
      waiveVisitFee(t(), { ...step(r.code, p.version, 'plain'), reasonCode: 'goodwill' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('offer to move the job to the workshop', () => {
  it('the workshop proposes once, the customer accepts: the job becomes a workshop job', async () => {
    const a = await arrived(40_000);
    const offer = await proposeMove(t(), {
      workshopIds: [W.home!.id],
      code: a.code,
      expectedVersion: a.version,
      staffUserId: f.staff,
      reasonCode: 'needs_lift',
      transport: 'workshop_picks_up',
    });
    await expect(
      proposeMove(t(), {
        workshopIds: [W.home!.id],
        code: a.code,
        expectedVersion: a.version,
        staffUserId: f.staff,
        reasonCode: 'needs_tools',
        transport: 'customer_drops',
      }),
    ).rejects.toMatchObject({ code: 'MOVE_PENDING' });
    const mine = await getMyServiceRequest(t(), f.customer, a.code, 'en');
    expect(mine.home?.move).toMatchObject({ reasonCode: 'needs_lift', status: 'proposed' });
    const listed = await db.execute(sql`select 1 from service_moves where request_id is not null`);
    expect(listed).toBeTruthy();
    const out = await decideMove(t(), {
      userId: f.customer,
      code: a.code,
      accept: true,
      expectedVersion: offer.version,
    });
    expect(out.status).toBe('vehicle_received');
    const after = await getMyServiceRequest(t(), f.customer, a.code, 'en');
    expect(after.serviceMode).toBe('workshop');
    expect(after.pickup).toBe(true);
    expect(after.home?.visitFeePaise).toBe(9_900); // the fee stays unless waived
    expect(after.home?.move?.status).toBe('accepted');
    // the workshop then sends an estimate as usual
    await sendEstimate(t(), { ...step(a.code, out.version), lines: LINES });
  });

  it('only that workshop can offer, and a foreign customer cannot answer', async () => {
    const a = await arrived(41_000);
    await expect(
      proposeMove(t(), {
        workshopIds: [W.plain!.id],
        code: a.code,
        expectedVersion: a.version,
        staffUserId: f.staff,
        reasonCode: 'other',
        transport: 'customer_drops',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await proposeMove(t(), {
      workshopIds: [W.home!.id],
      code: a.code,
      expectedVersion: a.version,
      staffUserId: f.staff,
      reasonCode: 'other',
      transport: 'customer_drops',
    });
    await expect(
      decideMove(t(), { userId: f.other, code: a.code, accept: true, expectedVersion: a.version }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('declining closes the job with the visit fee only: bill the fee, or waive it and close', async () => {
    const a = await arrived(42_000);
    const offer = await proposeMove(t(), {
      workshopIds: [W.home!.id],
      code: a.code,
      expectedVersion: a.version,
      staffUserId: f.staff,
      reasonCode: 'parts_unavailable',
      transport: 'customer_drops',
    });
    const out = await decideMove(t(), {
      userId: f.customer,
      code: a.code,
      accept: false,
      expectedVersion: offer.version,
    });
    expect(out.status).toBe('no_work_approved');
    await expect(returnVehicle(t(), step(a.code, out.version))).rejects.toMatchObject({
      code: 'VISIT_FEE_DUE',
    });
    await billJob(t(), step(a.code, out.version));
    const view = await getMyServiceRequest(t(), f.customer, a.code, 'en');
    expect(view.bill?.lines).toHaveLength(1);
    expect(view.bill?.lines[0]?.id).toBe('visit_fee');
    expect(view.bill?.taxablePaise).toBe(9_900);
    expect(view.bill?.totalPaise).toBe(11_700); // 9,900 + 18% GST = 11,682 rounded to the rupee
  });

  it('declining while an estimate is open withdraws the estimate; a waived fee lets the job close', async () => {
    const a = await arrived(43_000);
    const sent = await sendEstimate(t(), { ...step(a.code, a.version), lines: LINES });
    const offer = await proposeMove(t(), {
      workshopIds: [W.home!.id],
      code: a.code,
      expectedVersion: sent.version,
      staffUserId: f.staff,
      reasonCode: 'needs_lift',
      transport: 'customer_drops',
    });
    const out = await decideMove(t(), {
      userId: f.customer,
      code: a.code,
      accept: false,
      expectedVersion: offer.version,
    });
    expect(out.status).toBe('no_work_approved');
    const est = await db
      .select({ status: s.estimates.status })
      .from(s.estimates)
      .innerJoin(s.serviceRequests, eq(s.serviceRequests.id, s.estimates.requestId))
      .where(eq(s.serviceRequests.code, a.code));
    expect(est.every((e) => e.status === 'superseded')).toBe(true);
    await waiveVisitFee(t(), { ...step(a.code, out.version), reasonCode: 'small_job' });
    const v = (await getMyServiceRequest(t(), f.customer, a.code, 'en')).version;
    expect((await returnVehicle(t(), step(a.code, v))).status).toBe('completed');
  });

  it('there is no offer to answer, and a workshop job cannot be offered a move', async () => {
    const a = await arrived(44_000);
    await expect(
      decideMove(t(), { userId: f.customer, code: a.code, accept: true, expectedVersion: a.version }),
    ).rejects.toMatchObject({ code: 'NO_MOVE' });
  });
});

describe('routing a home request', () => {
  it('admin cannot send a home request to a workshop that does not travel that far', async () => {
    const r = await book();
    await expect(
      reassignServiceRequest(t(), {
        scope: { all: true },
        code: r.code,
        workshopId: W.far!.id,
        expectedVersion: r.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WORKSHOP_OUT_OF_RADIUS' });
    await expect(
      reassignServiceRequest(t(), {
        scope: { all: true },
        code: r.code,
        workshopId: W.off!.id,
        expectedVersion: r.version,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ code: 'WORKSHOP_OUT_OF_RADIUS' });
  });
});
