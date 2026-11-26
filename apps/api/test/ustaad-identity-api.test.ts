/**
 * Ustaad identity over HTTP (spec 23 § 3 role-leak matrix, § 4a, § 8; plan tasks B1, B2, B4): onboarding and
 * verification routes are invisible to non-members (404), the staff queue needs `ustaad:verify` (403 otherwise, 404
 * for another city), staff final approval through the API with compare-and-set (double approve → 409), the workshop
 * attestation routes need a workshop grant, and the public partner form refuses mechanic bodies with 410.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}
let n = 0;

async function person(opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-idn-${id}`,
    phone: `+9197100${id.padStart(5, '0')}`,
    email: `ustaad-idn-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-idn-000000${id}`, { ...identity, staff2fa: true });
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
    headers: p?.headers ?? { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const JOIN = {
  track: 'ustaad',
  specialities: ['two_wheeler'],
  displayName: 'Suresh Verma',
  garageName: null,
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 6,
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
};

let superAdmin: Person;
let cmRaipur: Person;
let cmOther: Person;
let customer: Person;
let mechanic: Person;

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']) });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur, bhilai] = await ctx.db
    .insert(s.cities)
    .values([
      { stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' },
      { stateId: state.id, code: 'BHI', slug: 'bhilai', name: 'Bhilai', status: 'live' },
    ])
    .returning();
  if (!raipur || !bhilai) throw new Error('city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  superAdmin = await person({ role: 'super_admin' });
  cmRaipur = await person({ role: 'community_manager', cityId: raipur.id });
  cmOther = await person({ role: 'community_manager', cityId: bhilai.id });
  customer = await person();
  mechanic = await person();
  // Open the network.
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  expect(
    (
      await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
        value: 'open',
        version: row?.version ?? null,
      })
    ).status,
  ).toBe(200);
  expect((await call(mechanic, 'POST', '/ustaad/join', JOIN)).status).toBe(201);
});

describe('role leak (§ 3)', () => {
  it('a customer without a membership gets 404 on the onboarding and verification routes', async () => {
    for (const [m, p] of [
      ['GET', '/ustaad/onboarding'],
      ['GET', '/ustaad/tutorial'],
      ['GET', '/ustaad/verification-status'],
      ['POST', '/ustaad/verifications'],
      ['POST', '/ustaad/vouches'],
    ] as const)
      expect((await call(customer, m, p, m === 'POST' ? {} : undefined)).status).toBe(404);
  });

  it('the staff queue: anonymous 401, a customer and a member 403, a community manager 200', async () => {
    expect((await call(null, 'GET', '/admin/ustaad/verifications')).status).toBe(401);
    expect((await call(customer, 'GET', '/admin/ustaad/verifications')).status).toBe(403);
    expect((await call(mechanic, 'GET', '/admin/ustaad/verifications')).status).toBe(403);
    expect((await call(cmRaipur, 'GET', '/admin/ustaad/verifications?status=requested')).status).toBe(200);
  });

  it('the workshop attestation routes need a workshop grant', async () => {
    expect((await call(mechanic, 'GET', '/workshop/ustaad/attestations')).status).toBe(403);
  });
});

describe('member onboarding and verification', () => {
  it('tutorial progress round trip; unknown keys refused', async () => {
    expect(
      (await call(mechanic, 'PUT', '/ustaad/onboarding', { event: 'skipped', card: 2 })).body,
    ).toMatchObject({
      skipped: true,
      lastCard: 2,
    });
    expect(
      (await call(mechanic, 'PUT', '/ustaad/onboarding', { event: 'card', card: 1, extra: 1 })).status,
    ).toBe(400);
    expect((await call(mechanic, 'POST', '/ustaad/onboarding/reset')).body).toMatchObject({ skipped: false });
    // Seeded by migration ustaad_identity_seed: six cards and six coach-marks, in the language asked for.
    const tut = await call(mechanic, 'GET', '/ustaad/tutorial?lang=en');
    expect((tut.body.cards as { title: string }[]).map((c) => c.title)[0]).toBe('Ask by voice');
    expect((tut.body.coachmarks as unknown[]).length).toBe(6);
  });

  it('join with a method opened a request; staff approve once (city scoped), a double approve is 409', async () => {
    const st = await call(mechanic, 'GET', '/ustaad/verification-status');
    const v = st.body.verification as { id: string; version: number; status: string };
    expect(v.status).toBe('requested');
    expect(JSON.stringify(st.body)).not.toContain('+91');
    const queue = await call(cmRaipur, 'GET', '/admin/ustaad/verifications?status=requested');
    expect(JSON.stringify(queue.body)).not.toContain('+91');
    const other = await call(cmOther, 'POST', `/admin/ustaad/verifications/${v.id}/approve`, {
      expectedVersion: v.version,
      grantedLevel: 'naya',
    });
    expect(other.status).toBe(404);
    const ok = await call(cmRaipur, 'POST', `/admin/ustaad/verifications/${v.id}/approve`, {
      expectedVersion: v.version,
      grantedLevel: 'naya',
    });
    expect(ok.status).toBe(200);
    const again = await call(cmRaipur, 'POST', `/admin/ustaad/verifications/${v.id}/approve`, {
      expectedVersion: v.version,
      grantedLevel: 'naya',
    });
    expect(again.status).toBe(409);
    const me = await call(mechanic, 'GET', '/ustaad/me');
    expect((me.body.member as { level: string; verificationState: string }).level).toBe('naya');
  });

  it('reject needs a note for "other"', async () => {
    const r = await call(
      cmRaipur,
      'POST',
      '/admin/ustaad/verifications/01900000-0000-7000-8000-000000000000/reject',
      {
        expectedVersion: 1,
        reasonCode: 'other',
        note: null,
      },
    );
    expect(r.status).toBe(400);
  });
});

describe('Apply as a mechanic moved to the network (§ 4a)', () => {
  it('a mechanic application body gets 410 MOVED_TO_USTAAD', async () => {
    const r = await call(null, 'POST', '/partner-applications', {
      application: { kind: 'mechanic', name: 'Old Form' },
      turnstileToken: 'human-token-123',
    });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('MOVED_TO_USTAAD');
  });
});
