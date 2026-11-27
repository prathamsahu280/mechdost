/**
 * Ustaad Local over HTTP (spec 23 § 8 "Location" and "Jobs", § 9.6; plan workstream E): role-leak rows (non-members
 * and outsiders get the generic 404), pin limits as 429, verified-only zones with bands, employer check, attestation,
 * held jobs invisible to others, no phone number and no distance number in any response.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from '@mechdost/db/testing';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}
let n = 0;

async function person(opts: { role?: string } = {}): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-local-${id}`,
    phone: `+9196000${id.padStart(5, '0')}`,
    email: `ustaad-local-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-local-00000${id}`, { ...identity, staff2fa: true });
  const user = await ensureUser(ctx.db, identity);
  if (opts.role) await grantRole(ctx.db, { userId: user.id, role: opts.role, cityId: null, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const JOIN = {
  track: 'ustaad',
  specialities: ['two_wheeler'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto Works',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: [],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
};
const PIN = {
  lat: 21.2514,
  lng: 81.6296,
  accuracyM: 12,
  source: 'gps',
  useForVerify: true,
  countInZone: true,
  shareExact: false,
};
const JOB = {
  employer: { kind: 'trade' },
  roleCode: 'helper',
  title: 'Helper for bike garage',
  description: 'Help with servicing and washing at Pandri.',
  areaLabel: 'Pandri',
  payMinPaiseMonth: 1_000_000,
  payMaxPaiseMonth: 1_200_000,
  timing: '9am to 6pm',
  adultAttested: true,
};

let superAdmin: Person;
let customer: Person;
let employer: Person;
let worker: Person;
let workerMemberId = '';

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']) });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({
      stateId: state.id,
      code: 'RPR',
      slug: 'raipur',
      name: 'Raipur',
      status: 'live',
      centroid: { lng: 81.6296, lat: 21.2514 },
      radiusKm: 20,
    })
    .returning();
  if (!raipur) throw new Error('city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  superAdmin = await person({ role: 'super_admin' });
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  const set = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value: 'open',
    version: row?.version ?? null,
  });
  expect(set.status).toBe(200);
  customer = await person();
  employer = await person();
  worker = await person();
  expect((await call(employer, 'POST', '/ustaad/join', JOIN)).status).toBe(201);
  const w = await call(worker, 'POST', '/ustaad/join', { ...JOIN, displayName: 'Suresh Verma' });
  expect(w.status).toBe(201);
  workerMemberId = w.body.id as string;
});

describe('role leak (non-members)', () => {
  it('a signed-in non-member gets 404 on every local route', async () => {
    for (const [m, p, b] of [
      ['GET', '/ustaad/me/location', undefined],
      ['PUT', '/ustaad/me/location', PIN],
      ['GET', '/ustaad/zones', undefined],
      ['GET', '/ustaad/jobs', undefined],
      ['POST', '/ustaad/jobs', JOB],
    ] as const) {
      const r = await call(customer, m, p, b);
      expect(r.status, `${m} ${p}`).toBe(404);
    }
  });
  it('signed out gets 401 while open', async () => {
    expect((await call(null, 'GET', '/ustaad/jobs')).status).toBe(401);
  });
});

describe('garage pin', () => {
  it('saves, refuses a Nagpur point, and answers 429 USTAAD_PIN_LIMIT on the 4th move in 24 h', async () => {
    expect((await call(worker, 'PUT', '/ustaad/me/location', PIN)).status).toBe(200);
    const far = await call(worker, 'PUT', '/ustaad/me/location', { ...PIN, lat: 21.1458, lng: 79.0882 });
    expect(far.body.error.code).toBe('USTAAD_REGION');
    for (let i = 1; i <= 3; i += 1)
      expect(
        (await call(worker, 'PUT', '/ustaad/me/location', { ...PIN, lat: 21.2514 + i * 0.001 })).status,
      ).toBe(200);
    const limited = await call(worker, 'PUT', '/ustaad/me/location', { ...PIN, lat: 21.2564 });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('USTAAD_PIN_LIMIT');
  });
  it('a hand-placed pin needs a landmark; mass assignment is refused', async () => {
    expect((await call(employer, 'PUT', '/ustaad/me/location', { ...PIN, source: 'manual' })).status).toBe(
      400,
    );
    expect((await call(employer, 'PUT', '/ustaad/me/location', { ...PIN, verifiedAt: 'now' })).status).toBe(
      400,
    );
  });
});

describe('zones', () => {
  it('unverified members are refused; verified members get bands, never exact small numbers', async () => {
    expect((await call(worker, 'GET', '/ustaad/zones')).body.error.code).toBe('USTAAD_VERIFIED_ONLY');
    await ctx.db
      .update(s.ustaadMembers)
      .set({ verificationState: 'verified' })
      .where(eq(s.ustaadMembers.id, workerMemberId));
    const r = await call(worker, 'GET', '/ustaad/zones');
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/"members"/);
  });
});

describe('jobs', () => {
  it('no employer account → 403 USTAAD_EMPLOYER_REQUIRED; no attestation → 422', async () => {
    expect((await call(employer, 'POST', '/ustaad/jobs', JOB)).body.error.code).toBe(
      'USTAAD_EMPLOYER_REQUIRED',
    );
    const noAttest = await call(employer, 'POST', '/ustaad/jobs', { ...JOB, adultAttested: false });
    expect(noAttest.status).toBe(422);
    expect(noAttest.body.error.code).toBe('USTAAD_ADULT_ATTESTATION');
  });
  it('a held job is the employer’s alone; an open job lists, applies, and leaks no phone', async () => {
    await ctx.db
      .insert(s.tradeAccounts)
      .values({ userId: employer.id, status: 'verified', businessName: 'Sahu Auto', businessType: 'garage' });
    const held = await call(employer, 'POST', '/ustaad/jobs', {
      ...JOB,
      description: 'Pay registration fee 500 to ramesh@ybl.',
    });
    expect(held.status).toBe(201);
    expect(held.body.underReview).toBe(true);
    expect((await call(worker, 'GET', `/ustaad/jobs/${String(held.body.code)}`)).status).toBe(404);
    const open = await call(employer, 'POST', '/ustaad/jobs', JOB);
    expect(open.body.status).toBe('open');
    const list = await call(worker, 'GET', '/ustaad/jobs');
    expect((list.body.items as { code: string }[]).map((j) => j.code)).toEqual([open.body.code]);
    const applied = await call(worker, 'POST', `/ustaad/jobs/${String(open.body.code)}/apply`, {
      sharePhone: true,
    });
    expect(applied.status).toBe(201);
    // The applicant cannot act as the employer; the employer can.
    const id = String(applied.body.applicationId);
    expect((await call(worker, 'POST', `/ustaad/applications/${id}/hire`)).status).toBe(404);
    expect((await call(employer, 'POST', `/ustaad/applications/${id}/shortlist`)).body.status).toBe(
      'shortlisted',
    );
    for (const text of [list.text, applied.text, held.text, open.text]) expect(text).not.toContain('+91');
  });

  it('SIM-P18: the employer lists the applicants (cursor); the applicant and outsiders get 404', async () => {
    const list = await call(worker, 'GET', '/ustaad/jobs');
    const code = (list.body.items as { code: string }[])[0]?.code ?? '';
    // The tick needs a verified state and a level past the pre-verified ones (same rule as member cards).
    await ctx.db
      .update(s.ustaadMembers)
      .set({ level: 'pakka' })
      .where(eq(s.ustaadMembers.id, workerMemberId));
    const mine = await call(employer, 'GET', `/ustaad/jobs/${code}/applications?limit=1`);
    expect(mine.status).toBe(200);
    const items = mine.body.items as { member: { displayName: string; verified: boolean }; status: string }[];
    expect(items[0]?.member).toMatchObject({ displayName: 'Suresh Verma', verified: true });
    expect(mine.body.next).toBeNull();
    expect(mine.text).not.toContain('+91');
    expect((await call(worker, 'GET', `/ustaad/jobs/${code}/applications`)).status).toBe(404);
    expect((await call(customer, 'GET', `/ustaad/jobs/${code}/applications`)).status).toBe(404);
    expect((await call(employer, 'GET', `/ustaad/jobs/${code}/applications?cursor=bad`)).status).toBe(400);
  });

  it('SIM-P17: the web form sends no employer kind; the server posts as the member’s trade account', async () => {
    const { employer: _omit, ...noKind } = JOB;
    const r = await call(employer, 'POST', '/ustaad/jobs', { ...noKind, title: 'Mechanic for 2W' });
    expect(r.status).toBe(201);
    // Naming a workshop the caller holds no grant on is refused: packages/db ustaad-local.test.ts (SIM-P17); the
    // job-post rate limit is spent by this point of the file.
  });

  it('jobs switched off → 404 on list, detail and apply; withdraw still works', async () => {
    const list = await call(worker, 'GET', '/ustaad/jobs');
    const code = (list.body.items as { code: string }[])[0]?.code ?? '';
    const mine = await ctx.db
      .select({ id: s.ustaadJobApplications.id })
      .from(s.ustaadJobApplications)
      .where(eq(s.ustaadJobApplications.memberId, workerMemberId));
    await ctx.db.insert(s.settings).values({ key: 'ustaad.jobs.enabled', value: false });
    expect((await call(worker, 'GET', '/ustaad/jobs')).status).toBe(404);
    expect((await call(worker, 'GET', `/ustaad/jobs/${code}`)).status).toBe(404);
    expect((await call(worker, 'POST', `/ustaad/jobs/${code}/apply`, {})).status).toBe(404);
    expect((await call(employer, 'POST', '/ustaad/jobs', JOB)).status).toBe(404);
    const w = await call(worker, 'POST', `/ustaad/applications/${mine[0]?.id ?? ''}/withdraw`);
    expect(w.status).toBe(200);
    expect(w.body.status).toBe('withdrawn');
    await ctx.db.delete(s.settings).where(eq(s.settings.key, 'ustaad.jobs.enabled'));
  });
});
