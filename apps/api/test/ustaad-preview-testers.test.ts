/**
 * Ustaad preview testers over HTTP (founder 2026-11-27; spec 23 § 3): during `staff_preview` a named non-staff account
 * on the list passes the access gate (and only the gate: it is no staff member, gets no staff preview shortcut and no
 * admin power); an account not on the list gets exactly the unknown-path 404 (role leak); `off` hides the network from
 * testers too; add/remove are super admin only (community manager, ops: 403), audited, and apply at once (cache).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from '@mechdost/db/testing';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  phone: string;
  headers: Record<string, string>;
}
let n = 0;

async function person(opts: { role?: string; cityId?: string } = {}): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-tester-${id}`,
    phone: `+9196000${id.padStart(5, '0')}`,
    email: `ustaad-tester-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-tester-00000${id}`, { ...identity, staff2fa: true });
  const user = await ensureUser(ctx.db, identity);
  if (opts.role)
    await grantRole(ctx.db, {
      userId: user.id,
      role: opts.role,
      cityId: opts.cityId ?? null,
      grantedBy: null,
    });
  return {
    id: user.id,
    phone: identity.phone,
    headers: { ...bearer(token), 'content-type': 'application/json' },
  };
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
const shape = (r: Awaited<ReturnType<typeof call>>) => ({
  status: r.status,
  code: r.body.error.code,
  message: r.body.error.message,
});
async function unknownPath() {
  return shape(await call(null, 'GET', '/no-such-thing-here'));
}

const JOIN = {
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Raju Verma',
  garageName: 'Verma Motors',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 3,
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
};

let superAdmin: Person;
let ops: Person;
let communityManager: Person;
let tester: Person;
let outsider: Person;

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
  tester = await person();
  outsider = await person();
});

describe('admin: preview testers (super admin only)', () => {
  it('community manager and ops get 403 on list, add and remove', async () => {
    for (const p of [communityManager, ops]) {
      expect((await call(p, 'GET', '/admin/ustaad/preview-testers')).status).toBe(403);
      expect(
        (
          await call(p, 'POST', '/admin/ustaad/preview-testers', {
            identifier: tester.phone,
            reasonCode: 'qa_run',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(p, 'POST', '/admin/ustaad/preview-testers/0190a000-0000-7000-8000-000000000000/remove', {
            reasonCode: 'run_finished',
            version: 1,
          })
        ).status,
      ).toBe(403);
    }
  });

  it('a non-staff account cannot reach the admin routes', async () => {
    const r = await call(outsider, 'GET', '/admin/ustaad/preview-testers');
    expect([403, 404]).toContain(r.status);
  });

  it('refuses unknown body fields (no user id from the client) and unknown accounts', async () => {
    const extra = await call(superAdmin, 'POST', '/admin/ustaad/preview-testers', {
      identifier: tester.phone,
      reasonCode: 'qa_run',
      userId: outsider.id,
    });
    expect(extra.status).toBe(400);
    const unknown = await call(superAdmin, 'POST', '/admin/ustaad/preview-testers', {
      identifier: '+919999999990',
      reasonCode: 'qa_run',
    });
    expect(unknown.status).toBe(404);
  });
});

describe('staff_preview with a tester on the list', () => {
  let rowId = '';
  let rowVersion = 0;

  it('before being added, the account gets exactly the unknown-path 404', async () => {
    const expected = await unknownPath();
    expect(shape(await call(tester, 'GET', '/ustaad/me'))).toEqual(expected);
    expect(shape(await call(tester, 'POST', '/ustaad/join', JOIN))).toEqual(expected);
  });

  it('the super admin adds it by phone; the answer shows the masked phone only; one audit row', async () => {
    const r = await call(superAdmin, 'POST', '/admin/ustaad/preview-testers', {
      identifier: tester.phone,
      reasonCode: 'qa_run',
      note: 'QA simulation',
    });
    expect(r.status).toBe(200);
    expect(r.body.maskedPhone).toBe(`••••••${tester.phone.slice(-4)}`);
    expect(JSON.stringify(r.body)).not.toContain(tester.phone);
    rowId = r.body.id as string;
    rowVersion = r.body.version as number;
    const list = await call(superAdmin, 'GET', '/admin/ustaad/preview-testers');
    expect((list.body.testers as { id: string }[]).map((t) => t.id)).toEqual([rowId]);
    const audit = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, rowId));
    expect(audit.filter((a) => a.action === 'ustaad.preview_tester.added')).toHaveLength(1);
  });

  it('the tester passes the gate at once (not a member yet → USTAAD_NOT_MEMBER, never the staff preview)', async () => {
    const r = await call(tester, 'GET', '/ustaad/me');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USTAAD_NOT_MEMBER');
  });

  it('an account not on the list still gets the unknown-path 404 (role leak)', async () => {
    expect(shape(await call(outsider, 'GET', '/ustaad/me'))).toEqual(await unknownPath());
  });

  it('the tester can join, then reads its membership; it has no admin power', async () => {
    const j = await call(tester, 'POST', '/ustaad/join', JOIN);
    expect(j.status).toBe(201);
    const me = await call(tester, 'GET', '/ustaad/me');
    expect(me.status).toBe(200);
    expect(me.body.staffPreview).toBe(false);
    expect((await call(tester, 'GET', '/admin/ustaad/settings')).status).toBe(403);
    expect((await call(tester, 'GET', '/admin/ustaad/preview-testers')).status).toBe(403);
  });

  it('access off hides the network from testers too', async () => {
    await setAccess('off');
    expect(shape(await call(tester, 'GET', '/ustaad/me'))).toEqual(await unknownPath());
    await setAccess('staff_preview');
    expect((await call(tester, 'GET', '/ustaad/me')).status).toBe(200);
  });

  it('removing (with a reason, version-checked) shuts the door at once; one audit row', async () => {
    const stale = await call(superAdmin, 'POST', `/admin/ustaad/preview-testers/${rowId}/remove`, {
      reasonCode: 'run_finished',
      version: rowVersion + 3,
    });
    expect(stale.status).toBe(409);
    const r = await call(superAdmin, 'POST', `/admin/ustaad/preview-testers/${rowId}/remove`, {
      reasonCode: 'run_finished',
      version: rowVersion,
    });
    expect(r.status).toBe(200);
    expect(shape(await call(tester, 'GET', '/ustaad/me'))).toEqual(await unknownPath());
    const audit = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, rowId));
    expect(audit.filter((a) => a.action === 'ustaad.preview_tester.removed')).toHaveLength(1);
  });
});
