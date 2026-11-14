/**
 * Before/after job photos (spec 06 "Job photos", design 2026-11-15): the status windows, the per-stage limit under
 * parallel uploads, the gates on `vehicle_received` and `ready` (home jobs included, before the arrival code is
 * compared), soft delete with an audit row, who may list what, the public gallery rules and the settings.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { istDateString } from '@mechdost/shared/time';
import { loadKeyring } from '../src/crypto';
import {
  advanceJob,
  createServiceRequest,
  decideEstimate,
  decideProposal,
  getMyServiceRequest,
  listPhotosForCustomer,
  listPhotosForStaff,
  listPhotosForWorkshop,
  listWorkshopGallery,
  markVehicleReceived,
  overrideArrival,
  photoSettings,
  prepareServicePhoto,
  proposeSlot,
  receiveVehicle,
  removeServicePhoto,
  saveServicePhoto,
  sendEstimate,
  billJob,
  markJobPaid,
  findMediaForServing,
  saveWorkshopHomeSettings,
  getAdminWorkshop,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { rowsOf } from '../src/repo/sql-rows';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const TODAY = istDateString(new Date());
const W: Record<string, { id: string; slug: string }> = {};
let keyN = 0;
// Each job needs a higher reading than the last one recorded for the same vehicle.
let odoN = 0;
const odo = () => (odoN += 1000);
const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

const setting = async (key: string, value: boolean | number) => {
  await db
    .insert(s.settings)
    .values({ cityId: null, key, value })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value } });
};
const ws = (key = 'main') => [W[key]!.id];
const step = (code: string, version: number, key = 'main') => ({
  workshopIds: ws(key),
  code,
  expectedVersion: version,
  staffUserId: f.staff,
});

/** A request created and confirmed (the customer accepted the proposal). */
async function confirmed(over: { workshop?: string } = {}) {
  keyN += 1;
  const key = over.workshop ?? 'main';
  const r = await createServiceRequest(t(), {
    userId: f.customer,
    idempotencyKey: `photo-test-key-${String(keyN).padStart(6, '0')}`,
    request: {
      workshopSlug: W[key]!.slug,
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
    },
  });
  let v = (
    await proposeSlot(t(), {
      ...step(r.code, r.version, key),
      date: TODAY,
      slot: 'morning',
      lowPaise: 80_000,
      highPaise: 150_000,
      note: null,
    })
  ).version;
  v = (await decideProposal(t(), { userId: f.customer, code: r.code, accept: true, expectedVersion: v }))
    .version;
  return { code: r.code, version: v, key };
}

const image = () => {
  const mediaId = randomUUID();
  const request = randomUUID();
  return {
    mediaId,
    bucket: 'service-photos',
    path: `job/${request}/${mediaId}.webp`,
    thumbPath: `job/${request}/${mediaId}-thumb.webp`,
    width: 1200,
    height: 800,
    bytes: 90_000,
    thumbBytes: 12_000,
    sha256: randomBytes(32).toString('hex'),
  };
};

async function addPhoto(code: string, stage: 'before' | 'after', key = 'main') {
  await prepareServicePhoto(t(), { workshopIds: ws(key), code, stage });
  return saveServicePhoto(t(), {
    workshopIds: ws(key),
    code,
    stage,
    staffUserId: f.staff,
    image: image(),
  });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  f = await seedServiceFixture(db);
  W.main = await addWorkshop(db, f, { name: 'Main', gstin: '22AAAAA0000A1Z5' });
  W.other = await addWorkshop(db, f, { name: 'Other' });
  await setting('service.photos_required', true);
  await setting('service.photos_max_per_stage', 3);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('settings', () => {
  it('reads the three settings with the registry defaults when nothing valid is stored', async () => {
    await setting('service.photos_max_per_stage', 99); // out of range: reads as the default (6)
    expect((await photoSettings(t())).maxPerStage).toBe(6);
    await setting('service.photos_max_per_stage', 3);
    expect(await photoSettings(t())).toEqual({ required: true, public: false, maxPerStage: 3 });
  });
});

describe('the vehicle_received gate', () => {
  it('refuses with PHOTOS_REQUIRED without a before photo, then passes with one (409, one transaction)', async () => {
    const r = await confirmed();
    await expect(
      receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PHOTOS_REQUIRED',
    });
    const [still] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, r.code));
    expect(still?.status).toBe('confirmed');
    await addPhoto(r.code, 'before');
    const out = await receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() });
    expect(out.status).toBe('vehicle_received');
  });

  it('does not gate when the admin made photos optional', async () => {
    await setting('service.photos_required', false);
    const r = await confirmed();
    const out = await receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() });
    expect(out.status).toBe('vehicle_received');
    await setting('service.photos_required', true);
  });

  it('a removed before photo no longer counts', async () => {
    const r = await confirmed();
    const p = await addPhoto(r.code, 'before');
    await removeServicePhoto(t(), {
      workshopIds: ws(),
      code: r.code,
      photoId: p.id,
      staffUserId: f.staff,
    });
    await expect(
      receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() }),
    ).rejects.toMatchObject({
      code: 'PHOTOS_REQUIRED',
    });
  });
});

/** A request taken to in_progress (before photo, estimate approved, work started). */
async function inProgress() {
  const r = await confirmed();
  await addPhoto(r.code, 'before');
  let v = (await receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() })).version;
  const sent = await sendEstimate(t(), {
    ...step(r.code, v),
    lines: [{ description: 'Labour', serviceKey: 'routine2w', qty: 1, unitPaise: 80_000, gstRateBp: 1800 }],
  });
  v = sent.version;
  const view = await getMyServiceRequest(t(), f.customer, r.code, 'en');
  const decisions = (view.estimate?.items ?? []).map((i) => ({
    itemId: i.id,
    decision: 'approved' as const,
  }));
  v = (
    await decideEstimate(t(), {
      userId: f.customer,
      code: r.code,
      decision: { revision: sent.revision, version: v, consent: true, decisions },
    })
  ).version;
  v = (await advanceJob(t(), { ...step(r.code, v), to: 'in_progress' })).version;
  return { code: r.code, version: v };
}

describe('the ready gate and the stage windows', () => {
  it('after photos only while in progress; ready needs one', async () => {
    const r = await confirmed();
    await expect(
      prepareServicePhoto(t(), { workshopIds: ws(), code: r.code, stage: 'after' }),
    ).rejects.toMatchObject({
      code: 'PHOTO_STAGE_CLOSED',
    });
    const j = await inProgress();
    await expect(advanceJob(t(), { ...step(j.code, j.version), to: 'ready' })).rejects.toMatchObject({
      status: 409,
      code: 'PHOTOS_REQUIRED',
    });
    await addPhoto(j.code, 'after');
    const out = await advanceJob(t(), { ...step(j.code, j.version), to: 'ready' });
    expect(out.status).toBe('ready');
  });

  it('removing is possible at ready but not after the bill; adding is closed at ready', async () => {
    const j = await inProgress();
    const a = await addPhoto(j.code, 'after');
    const ready = await advanceJob(t(), { ...step(j.code, j.version), to: 'ready' });
    await expect(
      prepareServicePhoto(t(), { workshopIds: ws(), code: j.code, stage: 'before' }),
    ).rejects.toMatchObject({
      code: 'PHOTO_STAGE_CLOSED',
    });
    const billed = await billJob(t(), step(j.code, ready.version));
    expect(billed.status).toBe('billed');
    await expect(
      removeServicePhoto(t(), { workshopIds: ws(), code: j.code, photoId: a.id, staffUserId: f.staff }),
    ).rejects.toMatchObject({ code: 'PHOTO_STAGE_CLOSED' });
  });
});

describe('limits', () => {
  it('stops at the per-stage limit, even for parallel uploads (counted under the request lock)', async () => {
    const r = await confirmed();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        saveServicePhoto(t(), {
          workshopIds: ws(),
          code: r.code,
          stage: 'before',
          staffUserId: f.staff,
          image: image(),
        }),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(rejected.every((x) => (x.reason as { code?: string }).code === 'PHOTO_LIMIT')).toBe(true);
    await expect(
      prepareServicePhoto(t(), { workshopIds: ws(), code: r.code, stage: 'before' }),
    ).rejects.toMatchObject({
      code: 'PHOTO_LIMIT',
    });
  });
});

describe('who may use and see photos', () => {
  it("another workshop's code is 404 for add, remove and list; a foreign customer and out-of-scope staff too", async () => {
    const r = await confirmed();
    const p = await addPhoto(r.code, 'before');
    await expect(
      prepareServicePhoto(t(), { workshopIds: ws('other'), code: r.code, stage: 'before' }),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      removeServicePhoto(t(), {
        workshopIds: ws('other'),
        code: r.code,
        photoId: p.id,
        staffUserId: f.staff,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(listPhotosForWorkshop(t(), ws('other'), r.code)).rejects.toMatchObject({ status: 404 });
    await expect(listPhotosForCustomer(t(), f.other, r.code)).rejects.toMatchObject({ status: 404 });
    await expect(listPhotosForStaff(t(), { all: false, cityIds: [f.bhilai] }, r.code)).rejects.toMatchObject({
      status: 404,
    });
    expect((await listPhotosForCustomer(t(), f.customer, r.code)).photos).toHaveLength(1);
    expect((await listPhotosForStaff(t(), { all: true }, r.code)).photos).toHaveLength(1);
    expect((await listPhotosForStaff(t(), { all: false, cityIds: [f.raipur] }, r.code)).photos).toHaveLength(
      1,
    );
  });

  it('a photo id of another request is 404 for remove (no cross-request delete)', async () => {
    const a = await confirmed();
    const b = await confirmed();
    const p = await addPhoto(a.code, 'before');
    await expect(
      removeServicePhoto(t(), { workshopIds: ws(), code: b.code, photoId: p.id, staffUserId: f.staff }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('removing soft-deletes the photo and its media, writes an audit row and a server event, and hides it', async () => {
    const r = await confirmed();
    const p = await addPhoto(r.code, 'before');
    await removeServicePhoto(t(), { workshopIds: ws(), code: r.code, photoId: p.id, staffUserId: f.staff });
    expect((await listPhotosForCustomer(t(), f.customer, r.code)).photos).toHaveLength(0);
    expect(await findMediaForServing(t(), p.mediaId)).toBeNull();
    const [media] = await db.select().from(s.mediaObjects).where(eq(s.mediaObjects.id, p.mediaId));
    expect(media?.deletedAt).not.toBeNull();
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(
        and(eq(s.auditLog.action, 'service_photo.remove'), sql`${s.auditLog.before}->>'photoId' = ${p.id}`),
      );
    expect(audit).toHaveLength(1);
    const ev = rowsOf<{ props: { stage: string } }>(
      await db.execute(
        sql`select props from events where event = 'service_photo_removed' order by id desc limit 1`,
      ),
    );
    expect(ev[0]?.props.stage).toBe('before');
    expect(JSON.stringify(ev[0]?.props)).not.toContain('path');
  });
});

describe('the public gallery', () => {
  async function completedJob() {
    const j = await inProgress();
    await addPhoto(j.code, 'after');
    const ready = await advanceJob(t(), { ...step(j.code, j.version), to: 'ready' });
    const billed = await billJob(t(), step(j.code, ready.version));
    await markJobPaid(t(), { ...step(j.code, billed.version), method: 'cash' });
    return j.code;
  }

  it('is off by default: nothing is listed and a photo is not public', async () => {
    const code = await completedJob();
    expect(await listWorkshopGallery(t(), W.main!.slug)).toEqual({ enabled: false, photos: [] });
    const { photos } = await listPhotosForStaff(t(), { all: true }, code);
    expect((await findMediaForServing(t(), photos[0]!.mediaId))?.publicNow).toBe(false);
  });

  it('when on: completed jobs only, after photos first, at most 12, never another job in progress', async () => {
    await setting('service.photos_public', true);
    await setting('service.photos_max_per_stage', 12);
    const code = await completedJob();
    const open = await inProgress();
    await addPhoto(open.code, 'after'); // an unfinished job's photo
    const g = await listWorkshopGallery(t(), W.main!.slug);
    expect(g.enabled).toBe(true);
    expect(g.photos.length).toBeGreaterThan(0);
    expect(g.photos.length).toBeLessThanOrEqual(12);
    const mine = await listPhotosForStaff(t(), { all: true }, code);
    const ids = new Set(mine.photos.map((p) => p.id));
    const fromJob = g.photos.filter((p) => ids.has(p.id));
    expect(fromJob[0]?.stage).toBe('after');
    const openIds = new Set(
      (await listPhotosForStaff(t(), { all: true }, open.code)).photos.map((p) => p.id),
    );
    expect(g.photos.some((p) => openIds.has(p.id))).toBe(false);
    expect((await findMediaForServing(t(), mine.photos[0]!.mediaId))?.publicNow).toBe(true);
    expect((await listWorkshopGallery(t(), 'no-such-workshop')).photos).toEqual([]);
    await setting('service.photos_public', false);
  });
});

/** A confirmed home visit and the customer's arrival code (the workshop enables home servicing first). */
async function homeJob() {
  const w = await getAdminWorkshop(t(), { all: true }, W.main!.id);
  if (!w.homeService)
    await saveWorkshopHomeSettings(t(), {
      workshopIds: ws(),
      workshopId: W.main!.id,
      staffUserId: f.staff,
      settings: {
        homeService: true,
        homeRadiusKm: 5,
        homeVisitFeePaise: 9_900,
        homeServiceKeys: ['routine2w'],
        version: w.version,
      },
    });
  const [state] = await db.select().from(s.states).limit(1);
  const [addr] = await db
    .insert(s.addresses)
    .values({
      userId: f.customer,
      contactName: 'Ravi',
      contactPhone: '+919811100001',
      line1: '12 Lal Bagh',
      pincode: '492001',
      cityId: f.raipur,
      stateId: state!.id,
      location: { lat: 21.2514, lng: 81.6296 },
    })
    .returning({ id: s.addresses.id });
  keyN += 1;
  const r = await createServiceRequest(t(), {
    userId: f.customer,
    idempotencyKey: `photo-home-key-${String(keyN).padStart(6, '0')}`,
    request: {
      workshopSlug: W.main!.slug,
      vehicleType: '2W',
      vehicleId: null,
      vehicle: 'Honda Activa 6G',
      serviceKeys: ['routine2w'],
      concern: null,
      pincode: '492001',
      lat: 21.2514,
      lng: 81.6296,
      preferredDate: TODAY,
      preferredSlot: 'morning',
      pickup: false,
      mode: 'home',
      addressId: addr!.id,
      visitFeePaise: 9_900,
    },
  });
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

describe('home jobs', () => {
  it('need a before photo before the arrival code is compared, and a refused gate does not burn a try', async () => {
    const j = await homeJob();
    expect(j.arrivalCode).toMatch(/^[0-9]{4}$/);
    const input = { ...step(j.code, j.version), odometerKm: odo(), keyring };
    const wrong = j.arrivalCode === '0000' ? '1111' : '0000';
    await expect(markVehicleReceived(t(), { ...input, arrivalCode: wrong })).rejects.toMatchObject({
      code: 'PHOTOS_REQUIRED',
    });
    const [row] = await db.select().from(s.serviceRequests).where(eq(s.serviceRequests.code, j.code));
    const [after] = await db
      .select()
      .from(s.serviceArrivalCodes)
      .where(eq(s.serviceArrivalCodes.requestId, row!.id));
    expect(after?.attempts).toBe(0);

    await addPhoto(j.code, 'before');
    const ok = await markVehicleReceived(t(), { ...input, arrivalCode: j.arrivalCode });
    expect(ok).toMatchObject({ ok: true, status: 'vehicle_received' });
  });

  it('the audited admin arrival override is not blocked by missing photos', async () => {
    const j = await homeJob();
    const out = await overrideArrival(t(), {
      scope: { all: true },
      code: j.code,
      reason: 'Customer unreachable, workshop confirmed by phone',
      odometerKm: odo(),
      expectedVersion: j.version,
      staffUserId: f.staff,
    });
    expect(out.status).toBe('vehicle_received');
  });
});

describe('proof cannot be deleted after the gate passed (security review 2026-11-15)', () => {
  const rm = (code: string, photoId: string) =>
    removeServicePhoto(t(), { workshopIds: ws(), code, photoId, staffUserId: f.staff });

  it('the only before photo cannot go once the vehicle is received; with two, one can', async () => {
    const r = await confirmed();
    const a = await addPhoto(r.code, 'before');
    await receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() });
    await expect(rm(r.code, a.id)).rejects.toMatchObject({ status: 409, code: 'PHOTO_REQUIRED_KEEP' });
    const b = await addPhoto(r.code, 'before');
    await rm(r.code, a.id);
    await expect(rm(r.code, b.id)).rejects.toMatchObject({ code: 'PHOTO_REQUIRED_KEEP' });
    expect((await listPhotosForCustomer(t(), f.customer, r.code)).photos).toHaveLength(1);
  });

  it('the only after photo cannot go at ready; billed refuses every removal', async () => {
    const j = await inProgress();
    const a = await addPhoto(j.code, 'after');
    await rm(j.code, (await addPhoto(j.code, 'after')).id); // in progress the gate has not passed: free to remove
    const ready = await advanceJob(t(), { ...step(j.code, j.version), to: 'ready' });
    await expect(rm(j.code, a.id)).rejects.toMatchObject({ status: 409, code: 'PHOTO_REQUIRED_KEEP' });
    const before = (await listPhotosForCustomer(t(), f.customer, j.code)).photos.find(
      (p) => p.stage === 'before',
    );
    await expect(rm(j.code, before!.id)).rejects.toMatchObject({ code: 'PHOTO_REQUIRED_KEEP' });
    await billJob(t(), step(j.code, ready.version));
    await expect(rm(j.code, a.id)).rejects.toMatchObject({ status: 409 });
    await expect(rm(j.code, before!.id)).rejects.toMatchObject({ status: 409 });
  });

  it('with photos not required, removal stays allowed', async () => {
    await setting('service.photos_required', false);
    const r = await confirmed();
    const a = await addPhoto(r.code, 'before');
    await receiveVehicle(t(), { ...step(r.code, r.version), odometerKm: odo() });
    await rm(r.code, a.id);
    await setting('service.photos_required', true);
    expect((await listPhotosForCustomer(t(), f.customer, r.code)).photos).toHaveLength(0);
  });
});
