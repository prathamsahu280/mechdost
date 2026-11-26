/**
 * Ustaad identity round 3 over HTTP (spec 23 § 8, SR-4, SR-5, SR-6; plan tasks B3, B4): profile/choices routes are
 * invisible to non-members and refuse unknown fields (no mass assignment); reserved names answer 422 NAME_RESERVED;
 * the owner link is issued by staff only, never returned to the member; the public owner page works signed out, one
 * 404 for unknown/used tokens, Turnstile on the submit; the Partners notice count needs `ustaad:verify`.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}
let n = 0;
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});

async function person(opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-b3-${id}`,
    phone: `+9197200${id.padStart(5, '0')}`,
    email: `ustaad-b3-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-b3-0000000${id}`, { ...identity, staff2fa: true });
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
    headers: res.headers,
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
let customer: Person;
let mechanic: Person;

async function setAccess(value: string) {
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  expect(
    (
      await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
        value,
        version: row?.version ?? null,
      })
    ).status,
  ).toBe(200);
}

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']), keyring });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  if (!raipur) throw new Error('city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  superAdmin = await person({ role: 'super_admin' });
  cmRaipur = await person({ role: 'community_manager', cityId: raipur.id });
  customer = await person();
  mechanic = await person();
  await setAccess('open');
  expect((await call(mechanic, 'POST', '/ustaad/join', JOIN)).status).toBe(201);
});

describe('profile and choices (§ 8 Membership, SR-5)', () => {
  it('non-members get 404 on every profile route', async () => {
    for (const [m, p] of [
      ['PATCH', '/ustaad/me'],
      ['PUT', '/ustaad/me/specialities'],
      ['GET', '/ustaad/me/choices'],
      ['PUT', '/ustaad/me/choices'],
      ['POST', '/ustaad/attestations/owner'],
    ] as const)
      expect((await call(customer, m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(404);
  });

  it('edits the profile with the version; unknown fields (official, level) are refused; a reserved name is 422', async () => {
    const me = await call(mechanic, 'GET', '/ustaad/me');
    const version = (me.body.member as { version: number }).version;
    const official = await call(mechanic, 'PATCH', '/ustaad/me', {
      expectedVersion: version,
      official: true,
    });
    expect(official.status).toBe(400);
    const level = await call(mechanic, 'PATCH', '/ustaad/me', { expectedVersion: version, level: 'master' });
    expect(level.status).toBe(400);
    const reserved = await call(mechanic, 'PATCH', '/ustaad/me', {
      expectedVersion: version,
      displayName: 'Mech Døst',
    });
    expect(reserved.status).toBe(422);
    expect(reserved.body.error.code).toBe('NAME_RESERVED');
    const ok = await call(mechanic, 'PATCH', '/ustaad/me', { expectedVersion: version, yearsClaimed: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ yearsClaimed: 7, official: false });
    expect(JSON.stringify(ok.body)).not.toContain('+91');
    const stale = await call(mechanic, 'PATCH', '/ustaad/me', { expectedVersion: version, yearsClaimed: 8 });
    expect(stale.status).toBe(409);
  });

  it('reads and saves choices; specialities keep the list valid', async () => {
    const c = await call(mechanic, 'GET', '/ustaad/me/choices');
    expect(c.status).toBe(200);
    const saved = await call(mechanic, 'PUT', '/ustaad/me/choices', {
      expectedVersion: c.body.version,
      suggestMe: false,
      consents: { ustaad_training: true },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ suggestMe: false, consents: { ustaad_training: true } });
    expect((await call(mechanic, 'PUT', '/ustaad/me/specialities', { codes: ['battery'] })).status).toBe(200);
    expect((await call(mechanic, 'PUT', '/ustaad/me/specialities', { codes: ['spaceship'] })).status).toBe(
      400,
    );
  });
});

describe('garage owner not on MechDost (SR-6)', () => {
  let token = '';

  it('the member asks; the answer never carries a link or the phone; staff issue the link', async () => {
    const ask = await call(mechanic, 'POST', '/ustaad/attestations/owner', {
      ownerPhone: '+919876511111',
      sinceYear: 2018,
    });
    expect(ask.status).toBe(201);
    expect(JSON.stringify(ask.body)).not.toMatch(/9876511111|token|url/i);
    expect((await call(customer, 'GET', '/admin/ustaad/attestations')).status).toBe(403);
    const queue = await call(cmRaipur, 'GET', '/admin/ustaad/attestations');
    expect(queue.status).toBe(200);
    const items = queue.body.items as { id: string }[];
    expect(JSON.stringify(items)).not.toContain('9876511111');
    const link = await call(
      cmRaipur,
      'POST',
      `/admin/ustaad/attestations/${String(items[0]?.id)}/owner-link`,
    );
    expect(link.status).toBe(200);
    expect(link.body.ownerPhone).toBe('+919876511111');
    token = String(link.body.url).split('/ustaad-attest/')[1] ?? '';
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the public page works signed out, says noindex and no-store, and shows no phone', async () => {
    const page = await call(null, 'GET', `/ustaad-attest/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.body).toMatchObject({ memberName: 'Suresh Verma', sinceYear: 2018 });
    expect(JSON.stringify(page.body)).not.toContain('+91');
  });

  it('the submit needs Turnstile; a decline uses the link up; the same 404 follows', async () => {
    const robot = await call(null, 'POST', `/ustaad-attest/${token}`, {
      decision: 'declined',
      turnstileToken: 'robot-token-0000',
    });
    expect(robot.status).toBe(400);
    const ok = await call(null, 'POST', `/ustaad-attest/${token}`, {
      decision: 'declined',
      turnstileToken: 'human-token-123',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ outcome: 'declined' });
    const again = await call(null, 'GET', `/ustaad-attest/${token}`);
    const unknown = await call(null, 'GET', `/ustaad-attest/${'a'.repeat(64)}`);
    expect(again.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(again.body).toEqual(unknown.body);
  });

  it('while the network is off the public page is the generic 404', async () => {
    await setAccess('off');
    expect((await call(null, 'GET', `/ustaad-attest/${'b'.repeat(64)}`)).status).toBe(404);
    await setAccess('open');
  });
});

describe('Partners notice count and reserved names (admin)', () => {
  it('the open-count needs ustaad:verify and says the access mode', async () => {
    expect((await call(customer, 'GET', '/admin/ustaad/verifications/open-count')).status).toBe(403);
    const r = await call(cmRaipur, 'GET', '/admin/ustaad/verifications/open-count');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ access: 'open' });
    expect(Number(r.body.open)).toBeGreaterThanOrEqual(1);
  });

  it('a super admin adds a reserved name; a community manager cannot', async () => {
    expect(
      (await call(cmRaipur, 'POST', '/admin/ustaad/reserved-names', { name: 'Raipur Garage Union' })).status,
    ).toBe(403);
    const added = await call(superAdmin, 'POST', '/admin/ustaad/reserved-names', {
      name: 'Raipur Garage Union',
    });
    expect(added.status).toBe(200);
    const list = await call(cmRaipur, 'GET', '/admin/ustaad/reserved-names');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Raipur Garage Union');
  });
});
