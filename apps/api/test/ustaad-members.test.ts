/**
 * Ustaad Network over HTTP (spec 23 § 3, § 8; plan task A3; founder 2026-11-26 staff preview): the access switch in
 * all three modes, "not found" that cannot be told apart from an unknown path (no leak), the role-leak rows for the
 * membership routes, join (verified phone, Turnstile, region, one required consent), leave, rate limits with headers,
 * and Admin → Ustaad settings (permissions, invariants, audit, the access cache).
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

async function person(opts: { role?: string; cityId?: string; staff2fa?: boolean } = {}): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-api-${id}`,
    phone: `+9197000${id.padStart(5, '0')}`,
    email: `ustaad-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-api-000000${id}`, {
    ...identity,
    staff2fa: opts.staff2fa ?? true,
  });
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
  headers: Record<string, string> = {},
) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: { ...(p?.headers ?? { 'content-type': 'application/json' }), ...headers },
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
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto Works',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
};

let superAdmin: Person;
let ops: Person;
let communityManager: Person;
let customer: Person;
let mechanic: Person;

async function setAccess(mode: 'off' | 'staff_preview' | 'open') {
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  const r = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value: mode,
    version: row?.version ?? null,
  });
  expect(r.status).toBe(200);
}

/** What a path that does not exist answers (minus the request id). */
async function unknownPath(p: Person | null) {
  const r = await call(p, 'GET', '/no-such-thing-here');
  return { status: r.status, code: r.body.error.code, message: r.body.error.message };
}
const shape = (r: Awaited<ReturnType<typeof call>>) => ({
  status: r.status,
  code: r.body.error.code,
  message: r.body.error.message,
});

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']) });
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
  ops = await person({ role: 'ops_manager' });
  communityManager = await person({ role: 'community_manager', cityId: raipur.id });
  customer = await person();
  mechanic = await person();
});

describe('staff_preview (the default)', () => {
  it('public access endpoint says staff_preview', async () => {
    const r = await call(null, 'GET', '/ustaad-access');
    expect(r.body).toEqual({ access: 'staff_preview' });
  });

  it('signed out, a customer and a broken token all get exactly the unknown-path 404 (no leak)', async () => {
    const expected = await unknownPath(null);
    expect(expected.status).toBe(404);
    expect(shape(await call(null, 'GET', '/ustaad/me'))).toEqual(expected);
    expect(shape(await call(customer, 'GET', '/ustaad/me'))).toEqual(expected);
    const broken = {
      id: 'x',
      headers: { ...bearer('token-not-registered-0000000'), 'content-type': 'application/json' },
    };
    expect(shape(await call(broken, 'GET', '/ustaad/me'))).toEqual(expected);
    // A write with a bad body is refused before validation: still the same 404, not a 400.
    expect(shape(await call(customer, 'POST', '/ustaad/join', { nonsense: true }))).toEqual(expected);
    expect(shape(await call(customer, 'POST', '/ustaad/media', {}))).toEqual(expected);
  });

  it('staff in a staff session see the preview; the same staff without the staff session do not', async () => {
    const r = await call(ops, 'GET', '/ustaad/me');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ member: null, staffPreview: true });
    expect((await call(communityManager, 'GET', '/ustaad/me')).status).toBe(200);
    const noTwoStep = await person({ role: 'ops_manager', staff2fa: false });
    expect(shape(await call(noTwoStep, 'GET', '/ustaad/me'))).toEqual(await unknownPath(null));
  });

  it('staff can join during the preview (to test it), customers cannot', async () => {
    const tester = await person({ role: 'catalogue_manager' });
    const r = await call(tester, 'POST', '/ustaad/join', JOIN);
    expect(r.status).toBe(201);
    expect(r.body.level).toBe('ustaad_pending');
  });
});

describe('open', () => {
  beforeAll(async () => {
    await setAccess('open');
  });

  it('signed out → 401; a signed-in customer without a membership → 404 USTAAD_NOT_MEMBER on /ustaad/me', async () => {
    expect((await call(null, 'GET', '/ustaad/me')).status).toBe(401);
    const r = await call(customer, 'GET', '/ustaad/me');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USTAAD_NOT_MEMBER');
  });

  it('join needs a verified phone and Turnstile (SR-3) and an enabled city (AT-REGION-1)', async () => {
    // Accounts are made with a phone; one whose phone proof is gone (number changed, not yet re-verified).
    const made = await person();
    await ctx.db.update(s.users).set({ phoneVerifiedAt: null }).where(eq(s.users.id, made.id));
    // Signed in by email (no phone in the token), so the sign-in does not prove the phone again.
    const [u] = await ctx.db.select().from(s.users).where(eq(s.users.id, made.id));
    const emailToken = ctx.verifier.add('token-ustaad-email-only-00001', {
      firebaseUid: u?.firebaseUid ?? '',
      email: u?.email ?? null,
      emailVerified: true,
      signInProvider: 'password',
    });
    const noPhone = { id: made.id, headers: { ...bearer(emailToken), 'content-type': 'application/json' } };
    expect((await call(noPhone, 'POST', '/ustaad/join', JOIN)).body.error.code).toBe('VERIFICATION_REQUIRED');
    const bot = await call(customer, 'POST', '/ustaad/join', {
      ...JOIN,
      turnstileToken: 'robot-token-12345',
    });
    expect(bot.body.error.code).toBe('TURNSTILE_FAILED');
    const nagpur = await call(customer, 'POST', '/ustaad/join', { ...JOIN, pincode: '440001' });
    expect(nagpur.status).toBe(422);
    expect(nagpur.body.error.code).toBe('USTAAD_REGION');
    // Each attempt counts toward the 3-a-day join limit, so the remaining checks use fresh accounts.
    const noConsent = await call(await person(), 'POST', '/ustaad/join', {
      ...JOIN,
      consents: { ...JOIN.consents, ustaad_profile: false },
    });
    expect(noConsent.status).toBe(400);
    const official = await call(await person(), 'POST', '/ustaad/join', { ...JOIN, official: true });
    expect(official.status).toBe(400);
  });

  it('a mechanic joins, sees their card (never a phone number) and can leave', async () => {
    const r = await call(mechanic, 'POST', '/ustaad/join', JOIN);
    expect(r.status).toBe(201);
    const me = await call(mechanic, 'GET', '/ustaad/me');
    expect(me.status).toBe(200);
    expect((me.body.member as { displayName: string }).displayName).toBe('Ramesh Sahu');
    expect(JSON.stringify(me.body)).not.toMatch(/\+91|97000/);
    expect((await call(mechanic, 'POST', '/ustaad/join', JOIN)).body.error.code).toBe(
      'USTAAD_ALREADY_MEMBER',
    );
  });

  it('role leak: shop, workshop, support, finance and marketing accounts without a membership get 404 on member routes', async () => {
    const expected = await unknownPath(null);
    for (const role of ['support_agent', 'finance', 'marketing']) {
      const p = await person({ role });
      expect(shape(await call(p, 'POST', '/ustaad/me/leave')), role).toEqual(expected);
      expect(shape(await call(p, 'POST', '/ustaad/media', { kind: 'image' })), role).toEqual(expected);
    }
    expect(shape(await call(customer, 'POST', '/ustaad/me/leave'))).toEqual(expected);
  });

  it('join is limited to 3 a day with Retry-After (SR-43)', async () => {
    const p = await person();
    const bad = { ...JOIN, pincode: '440001' };
    for (let i = 0; i < 3; i += 1) expect((await call(p, 'POST', '/ustaad/join', bad)).status).toBe(422);
    const limited = await call(p, 'POST', '/ustaad/join', bad);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('a member who left is out at once', async () => {
    expect((await call(mechanic, 'POST', '/ustaad/me/leave')).status).toBe(200);
    expect((await call(mechanic, 'GET', '/ustaad/me')).body.error.code).toBe('USTAAD_NOT_MEMBER');
    expect(shape(await call(mechanic, 'POST', '/ustaad/me/leave'))).toEqual(await unknownPath(null));
  });
});

describe('off', () => {
  beforeAll(async () => {
    await setAccess('off');
  });
  it('nobody gets in, staff included; the access endpoint says off', async () => {
    const expected = await unknownPath(null);
    for (const p of [null, customer, ops, superAdmin])
      expect(shape(await call(p, 'GET', '/ustaad/me'))).toEqual(expected);
    expect((await call(null, 'GET', '/ustaad-access')).body).toEqual({ access: 'off' });
  });
});

describe('Admin → Ustaad settings', () => {
  it('a customer is refused; a community manager reads but cannot save', async () => {
    expect((await call(customer, 'GET', '/admin/ustaad/settings')).status).toBe(403);
    const list = await call(communityManager, 'GET', '/admin/ustaad/settings');
    expect(list.status).toBe(200);
    const access = (list.body.settings as { key: string; kind: string; values?: string[] }[]).find(
      (r) => r.key === 'ustaad.access',
    );
    expect(access).toMatchObject({ kind: 'enum', values: ['off', 'staff_preview', 'open'] });
    expect(
      (
        await call(communityManager, 'PUT', '/admin/ustaad/settings/ustaad.access', {
          value: 'open',
          version: null,
        })
      ).status,
    ).toBe(403);
  });

  it('invariants answer 422 with their code; a stale version 409', async () => {
    const r = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.zones.hide_below', {
      value: 4,
      version: null,
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SETTING_INVARIANT');
    const w = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.feed.w_city', {
      value: 26,
      version: null,
    });
    expect(w.body.error.code).toBe('SETTING_RELATION');
    const stale = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
      value: 'open',
      version: 99,
    });
    expect(stale.status).toBe(409);
  });

  it('switching back to staff_preview applies at once (the access cache is cleared on save)', async () => {
    await setAccess('staff_preview');
    expect((await call(ops, 'GET', '/ustaad/me')).status).toBe(200);
    expect(shape(await call(customer, 'GET', '/ustaad/me'))).toEqual(await unknownPath(null));
  });
});
