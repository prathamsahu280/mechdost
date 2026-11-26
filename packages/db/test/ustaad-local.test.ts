/**
 * Ustaad Local repositories (spec 23 § 9.6, § 6.6, § 7.7; plan workstream E): garage pin with region and pin-change
 * limits (AT-LOC-1, AT-REGION-1), hidden location (AT-LOC-3), zone counts and bands (AT-LOC-2), jobs with employer
 * check, attestation and scam hold (AT-JOB-1), applications and job closing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Join } from '@mechdost/shared/ustaad/dto/members';
import {
  applyToUstaadJob,
  buildUstaadZoneCounts,
  expireUstaadJobs,
  getUstaadJob,
  joinUstaad,
  listUstaadJobs,
  moveUstaadApplication,
  moveUstaadJob,
  postUstaadJob,
  saveUstaadLocation,
  syncRbacCatalogue,
  ustaadDistanceBands,
  ustaadPairNoise,
  ustaadZonesBanded,
  ustaadZonesExact,
  type PostUstaadJobInput,
  type Tx,
  type UstaadLocationInput,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
let a: { memberId: string; userId: string };
let b: { memberId: string; userId: string };

const join = (over: Partial<Join> = {}): Join => ({
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto Works',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: [],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: true, ustaad_offers: false },
  turnstileToken: 'human-token-123',
  ...over,
});

const pin = (over: Partial<UstaadLocationInput> = {}): UstaadLocationInput => ({
  lat: 21.2514,
  lng: 81.6296,
  accuracyM: 15,
  source: 'gps',
  landmark: null,
  mockSuspected: false,
  useForVerify: true,
  countInZone: true,
  shareExact: false,
  exactAudience: 'connections',
  hidden: false,
  ...over,
});

const job = (over: Partial<PostUstaadJobInput> = {}): PostUstaadJobInput => ({
  employer: { kind: 'trade' },
  roleCode: 'mechanic_2w',
  title: 'Two-wheeler mechanic',
  description: 'Bike servicing and repair at our Pandri garage.',
  areaLabel: 'Pandri',
  areaLabelHi: 'पंडरी',
  payMinPaiseMonth: 1_500_000,
  payMaxPaiseMonth: 2_000_000,
  timing: '10am to 7pm',
  experienceMinYears: 1,
  segmentCodes: [],
  adultAttested: true,
  idemKey: null,
  ...over,
});

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values([{ cityId: f.raipur }, { cityId: f.bhilai, enabled: false }]);
  const ma = await joinUstaad(t(), { userId: f.customer }, join(), { via: 'ustaad' });
  const mb = await joinUstaad(t(), { userId: f.other }, join({ displayName: 'Suresh Verma' }), {
    via: 'ustaad',
  });
  a = { memberId: ma.id, userId: f.customer };
  b = { memberId: mb.id, userId: f.other };
  await db
    .update(s.ustaadMembers)
    .set({ verificationState: 'verified' })
    .where(sql`id in (${a.memberId}::uuid, ${b.memberId}::uuid)`);
});

afterAll(async () => {
  await client.close();
});

describe('garage pin (SR-30, AT-LOC-1, AT-REGION-1)', () => {
  it('a Nagpur point is refused with USTAAD_REGION', async () => {
    await expectCode(saveUstaadLocation(t(), a, pin({ lat: 21.1458, lng: 79.0882 })), 'USTAAD_REGION');
  });

  it('weak GPS is not a pin', async () => {
    expect(await saveUstaadLocation(t(), a, pin({ accuracyM: 300 }))).toEqual({
      ok: false,
      code: 'USTAAD_PIN_GPS_WEAK',
    });
  });

  it('first pin saves; the circle centre is never the garage; 4th move in 24 h → USTAAD_PIN_LIMIT', async () => {
    const now = new Date('2026-11-26T05:00:00Z');
    const first = await saveUstaadLocation(t(), a, pin(), now);
    expect(first.ok).toBe(true);
    const [row] = await db
      .select({ zone: s.ustaadLocations.zoneCell })
      .from(s.ustaadLocations)
      .where(eq(s.ustaadLocations.memberId, a.memberId));
    expect(row?.zone).toMatch(/^hx:/);
    for (let i = 1; i <= 3; i += 1) {
      const r = await saveUstaadLocation(t(), a, pin({ lat: 21.2514 + i * 0.001 }), now);
      expect(r.ok).toBe(true);
    }
    expect(await saveUstaadLocation(t(), a, pin({ lat: 21.2564 }), now)).toEqual({
      ok: false,
      code: 'USTAAD_PIN_LIMIT',
    });
    // Choices only (no move) still save.
    const same = await saveUstaadLocation(t(), a, pin({ lat: 21.2544, countInZone: true }), now);
    expect(same.ok).toBe(true);
  });

  it('a move over 1 km without a precise fix is refused', async () => {
    const later = new Date('2026-11-28T05:00:00Z');
    expect(await saveUstaadLocation(t(), a, pin({ lat: 21.27, accuracyM: 80 }), later)).toEqual({
      ok: false,
      code: 'USTAAD_PIN_FIX_REQUIRED',
    });
  });
});

describe('distance bands (SR-29, AT-LOC-3)', () => {
  it('same pair → same band, never a number; hidden → no band', async () => {
    await saveUstaadLocation(t(), b, pin({ lat: 21.262, lng: 81.66 }));
    const one = await ustaadDistanceBands(t(), a.memberId, [b.memberId], 'test-secret-0123456789');
    const two = await ustaadDistanceBands(t(), a.memberId, [b.memberId], 'test-secret-0123456789');
    expect(one.get(b.memberId)).toBeDefined();
    expect(one.get(b.memberId)).toBe(two.get(b.memberId));
    expect(['lt2', '2to5', '5to10', '10plus']).toContain(one.get(b.memberId));
    expect(ustaadPairNoise('k', a.memberId, b.memberId)).toBe(ustaadPairNoise('k', b.memberId, a.memberId));
    await saveUstaadLocation(t(), b, pin({ lat: 21.262, lng: 81.66, hidden: true }));
    const hidden = await ustaadDistanceBands(t(), a.memberId, [b.memberId], 'test-secret-0123456789');
    expect(hidden.size).toBe(0);
    await saveUstaadLocation(t(), b, pin({ lat: 21.262, lng: 81.66 }));
  });
});

describe('zone counts (SR-31, AT-LOC-2)', () => {
  it('two counted members → members see "few"; staff see the exact number; a disabled city shows none', async () => {
    const r = await buildUstaadZoneCounts(t());
    expect(r.ran).toBe(true);
    const exact = await ustaadZonesExact(t(), f.raipur);
    expect(exact.reduce((n, z) => n + z.members, 0)).toBe(2);
    const banded = await ustaadZonesBanded(t(), f.raipur);
    for (const z of banded) {
      expect(z.total).toEqual({ kind: 'few' });
      for (const seg of Object.values(z.segments)) expect(seg).toEqual({ kind: 'few' });
    }
    expect(JSON.stringify(banded)).not.toMatch(/"members"/);
    expect(await ustaadZonesBanded(t(), f.bhilai)).toEqual([]);
  });
});

describe('jobs (AT-JOB-1)', () => {
  it('without a workshop grant or verified trade account → USTAAD_EMPLOYER_REQUIRED', async () => {
    await expectCode(postUstaadJob(t(), a, job()), 'USTAAD_EMPLOYER_REQUIRED');
  });

  it('missing attestation → USTAAD_ADULT_ATTESTATION', async () => {
    await expectCode(postUstaadJob(t(), a, job({ adultAttested: false })), 'USTAAD_ADULT_ATTESTATION');
  });

  it('a clean job opens; a fee phrase or UPI id is held for review and hidden from others', async () => {
    await db
      .insert(s.tradeAccounts)
      .values({ userId: a.userId, status: 'verified', businessName: 'Sahu Auto', businessType: 'garage' });
    const open = await postUstaadJob(t(), a, job());
    expect(open.status).toBe('open');
    expect(open.code).toMatch(/^UJ-RPR-\d{4}-[A-Z2-7]{6}$/);
    const held = await postUstaadJob(
      t(),
      a,
      job({ description: 'Registration fee 500, pay to ramesh@okaxis' }),
    );
    expect(held.status).toBe('pending_review');
    expect(held.underReview).toBe(true);
    await expectCode(getUstaadJob(t(), b.memberId, held.code), 'NOT_FOUND');
    const list = await listUstaadJobs(t(), b.memberId, {});
    expect(list.items.map((j) => j.code)).toEqual([open.code]);
    expect(JSON.stringify(list)).not.toContain('+91');
  });

  it('apply (idempotent), employer moves, outsiders get 404, closing the job closes applications', async () => {
    const list = await listUstaadJobs(t(), b.memberId, {});
    const code = list.items[0]?.code ?? '';
    const app = await applyToUstaadJob(t(), b, code, { sharePhone: false, voiceIntroMediaId: null });
    const again = await applyToUstaadJob(t(), b, code, { sharePhone: false, voiceIntroMediaId: null });
    expect(again.applicationId).toBe(app.applicationId);
    await expectCode(moveUstaadApplication(t(), b, app.applicationId, 'hired'), 'NOT_FOUND');
    expect(await moveUstaadApplication(t(), a, app.applicationId, 'seen')).toEqual({ status: 'seen' });
    await expectCode(moveUstaadApplication(t(), a, app.applicationId, 'hired'), 'INVALID_TRANSITION');
    await expectCode(moveUstaadJob(t(), b, code, 'closed'), 'NOT_FOUND');
    expect(await moveUstaadJob(t(), a, code, 'closed')).toEqual({ status: 'closed' });
    const [row] = await db
      .select({ status: s.ustaadJobApplications.status, reason: s.ustaadJobApplications.closedReasonCode })
      .from(s.ustaadJobApplications)
      .where(eq(s.ustaadJobApplications.id, app.applicationId));
    expect(row).toEqual({ status: 'closed', reason: 'job_closed' });
    await expectCode(
      applyToUstaadJob(t(), b, code, { sharePhone: true, voiceIntroMediaId: null }),
      'USTAAD_JOB_CLOSED',
    );
  });

  it('a scam phrase in the area label is held too', async () => {
    const held = await postUstaadJob(t(), a, job({ areaLabel: 'Pay at paytm karo first' }));
    expect(held.status).toBe('pending_review');
  });

  it('a restricted or no-longer-verified employer cannot resume a job or hire; jobs off refuses moves', async () => {
    const j = await postUstaadJob(t(), a, job({ title: 'Electrician needed' }));
    expect(await moveUstaadJob(t(), a, j.code, 'paused')).toEqual({ status: 'paused' });
    await db
      .update(s.tradeAccounts)
      .set({ status: 'revoked', reasonCode: 'misuse' })
      .where(eq(s.tradeAccounts.userId, a.userId));
    await expectCode(moveUstaadJob(t(), a, j.code, 'open'), 'USTAAD_EMPLOYER_REQUIRED');
    await db
      .update(s.tradeAccounts)
      .set({ status: 'verified', reasonCode: null })
      .where(eq(s.tradeAccounts.userId, a.userId));
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, a.memberId));
    await expectCode(moveUstaadJob(t(), a, j.code, 'open'), 'USTAAD_RESTRICTED');
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'none' })
      .where(eq(s.ustaadMembers.id, a.memberId));
    expect(await moveUstaadJob(t(), a, j.code, 'open')).toEqual({ status: 'open' });
    const app = await applyToUstaadJob(t(), b, j.code, { sharePhone: false, voiceIntroMediaId: null });
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, a.memberId));
    await expectCode(moveUstaadApplication(t(), a, app.applicationId, 'shortlisted'), 'USTAAD_RESTRICTED');
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'none' })
      .where(eq(s.ustaadMembers.id, a.memberId));
    await db.insert(s.settings).values({ key: 'ustaad.jobs.enabled', value: false });
    await expectCode(moveUstaadApplication(t(), a, app.applicationId, 'shortlisted'), 'NOT_FOUND');
    // The applicant can always withdraw.
    expect(await moveUstaadApplication(t(), b, app.applicationId, 'withdrawn')).toEqual({
      status: 'withdrawn',
    });
    await db.delete(s.settings).where(eq(s.settings.key, 'ustaad.jobs.enabled'));
  });

  it('restricted members cannot apply; expired jobs move to expired', async () => {
    const fresh = await postUstaadJob(t(), a, job({ title: 'Helper wanted' }));
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, b.memberId));
    await expectCode(
      applyToUstaadJob(t(), b, fresh.code, { sharePhone: false, voiceIntroMediaId: null }),
      'USTAAD_RESTRICTED',
    );
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'none' })
      .where(eq(s.ustaadMembers.id, b.memberId));
    const n = await expireUstaadJobs(t(), new Date(Date.now() + 400 * 86_400_000));
    expect(n).toBeGreaterThanOrEqual(1);
    await expectCode(
      applyToUstaadJob(t(), b, fresh.code, { sharePhone: false, voiceIntroMediaId: null }),
      'USTAAD_JOB_CLOSED',
    );
  });
});
