/**
 * Admin people screens over HTTP (design 2026-11-15, specs 08/13): staff and roles (`staff:manage`, all-cities),
 * customer search and view (`customers:read`, all-cities; unmasked only with `customers:read_pii`, audited) and
 * the audit log viewer (`audit:read`). Role-leak matrix on every route: 401 without a token, 403 for roles without
 * the permission and for a city-scoped grant, foreign ids 404, strict bodies, per-user rate limit.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole, startUserSession } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { bearer, buildApp, FakePasswordAuthority, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
const passwordAuth = new FakePasswordAuthority();
let raipur = '';

type Who =
  'super_admin' | 'ops_manager' | 'support_agent' | 'finance' | 'catalogue_manager' | 'city_manager' | null;
async function person(n: string, role: Who, cityId: string | null = null, name = `Person ${n}`) {
  const phone = `+9198444444${n}`;
  const token = ctx.verifier.add(`token-people-00000${n}`, {
    firebaseUid: `pp-${n}`,
    phone,
    email: `pp-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `pp-${n}`,
    phone,
    email: `pp-${n}@example.com`,
    emailVerified: true,
  });
  await ctx.db.update(s.users).set({ name }).where(eq(s.users.id, user.id));
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, phone, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

beforeAll(async () => {
  ctx = await buildApp({ passwordAuth });
  const [existing] = await ctx.db.select({ id: s.cities.id }).from(s.cities).limit(1);
  if (existing) raipur = existing.id;
  else {
    const [state] = await ctx.db
      .insert(s.states)
      .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
      .returning();
    const [city] = await ctx.db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur' })
      .returning();
    raipur = city!.id;
  }
});

const get = (path: string, headers?: Record<string, string>) => ctx.app.request(path, { headers });
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  ctx.app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
const codeOf = async (r: Response) => ((await r.json()) as ErrorJson).error.code;

describe('role-leak matrix', () => {
  it('every route is 401 without a token', async () => {
    for (const path of [
      '/v1/admin/staff',
      '/v1/admin/customers/search?q=ashaverma',
      '/v1/admin/customers/019a8f00-0000-7000-8000-000000000001',
      '/v1/admin/audit',
    ])
      expect((await get(path)).status, path).toBe(401);
    expect((await ctx.app.request('/v1/admin/staff/grants', { method: 'POST' })).status).toBe(401);
  });

  it('staff screen needs staff:manage: only the super admin', async () => {
    const all = {
      ops: await person('01', 'ops_manager'),
      support: await person('02', 'support_agent'),
      finance: await person('03', 'finance'),
      catalogue: await person('04', 'catalogue_manager'),
      customer: await person('05', null),
      city: await person('06', 'city_manager', raipur),
    };
    for (const [name, p] of Object.entries(all)) {
      expect((await get('/v1/admin/staff', p.headers)).status, name).toBe(403);
      expect(
        (
          await post('/v1/admin/staff/grants', p.headers, {
            phone: '9810000000',
            role: 'marketing',
            reason: 'trying it out',
          })
        ).status,
        name,
      ).toBe(403);
      expect(
        (
          await post('/v1/admin/staff/grants/019a8f00-0000-7000-8000-000000000001/revoke', p.headers, {
            reason: 'trying it out',
          })
        ).status,
        name,
      ).toBe(403);
    }
  });

  it('customer search and view need customers:read for all cities; audit needs audit:read', async () => {
    const customer = await person('05', null);
    const catalogue = await person('04', 'catalogue_manager');
    const city = await person('06', 'city_manager', raipur);
    const support = await person('02', 'support_agent');
    for (const p of [customer, catalogue]) {
      expect((await get('/v1/admin/customers/search?q=ashaverma', p.headers)).status).toBe(403);
      expect((await get(`/v1/admin/customers/${customer.id}`, p.headers)).status).toBe(403);
    }
    const scoped = await get('/v1/admin/customers/search?q=ashaverma', city.headers);
    expect(scoped.status).toBe(403);
    expect(await codeOf(scoped)).toBe('SCOPE_REQUIRED');
    for (const p of [customer, catalogue, support, city])
      expect((await get('/v1/admin/audit', p.headers)).status).toBe(403);
    const ops = await person('01', 'ops_manager');
    expect((await get('/v1/admin/audit', ops.headers)).status).toBe(403);
  });

  it('a staff session without the second step gets STAFF_2FA_REQUIRED', async () => {
    const boss = await person('07', 'super_admin');
    ctx.verifier.add('token-people-no2fa00', {
      firebaseUid: 'pp-07',
      phone: boss.phone,
      email: 'pp-07@example.com',
      emailVerified: true,
      staff2fa: false,
    });
    const res = await get('/v1/admin/staff', { ...bearer('token-people-no2fa00') });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('STAFF_2FA_REQUIRED');
  });
});

describe('staff and roles', () => {
  it('lists staff with grants and marks the viewer', async () => {
    const boss = await person('07', 'super_admin');
    const body = (await (await get('/v1/admin/staff', boss.headers)).json()) as {
      staff: { userId: string; isSelf: boolean; grants: { role: string }[]; twoFactor: string }[];
      roles: { key: string }[];
      cities: unknown[];
    };
    expect(body.staff.find((m) => m.userId === boss.id)).toMatchObject({ isSelf: true, twoFactor: 'ready' });
    expect(body.roles.map((r) => r.key)).toContain('city_manager');
    expect(JSON.stringify(body)).not.toContain(boss.phone);
  });

  it('grant: strict body, reason needed, applies to the person at once, audited; revoke ends it and their sessions', async () => {
    const boss = await person('07', 'super_admin');
    const target = await person('08', null);
    // a device-list row of the target: the role removal marks it ended (reason staff_role_removed)
    await startUserSession(ctx.db, {
      userId: target.id,
      device: { deviceKind: 'desktop', browser: 'chrome', os: 'windows' },
      place: null,
    });
    // the target is refused before the grant (and their session is cached)
    expect((await get('/v1/admin/customers/search?q=ashaverma', target.headers)).status).toBe(403);

    const url = '/v1/admin/staff/grants';
    expect(
      (await post(url, boss.headers, { phone: target.phone, role: 'support_agent', reason: 'ok' })).status,
    ).toBe(400);
    expect(
      (
        await post(url, boss.headers, {
          phone: target.phone,
          role: 'support_agent',
          reason: 'joins the desk',
          userId: target.id,
        })
      ).status,
    ).toBe(400);
    const made = await post(url, boss.headers, {
      phone: target.phone,
      role: 'support_agent',
      reason: 'joins the desk',
    });
    expect(made.status).toBe(201);
    const { grantId } = (await made.json()) as { grantId: string };
    expect((await get('/v1/admin/customers/search?q=ashaverma', target.headers)).status).toBe(200);
    expect(
      (
        await post(url, boss.headers, {
          phone: target.phone,
          role: 'support_agent',
          reason: 'joins the desk',
        })
      ).status,
    ).toBe(409);

    const audit = (await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, grantId))).filter(
      (r) => r.action === 'role.granted',
    );
    expect(audit[0]).toMatchObject({ reason: 'joins the desk', actorUserId: boss.id });

    const revoke = `/v1/admin/staff/grants/${grantId}/revoke`;
    expect((await post(revoke, boss.headers, { reason: 'x' })).status).toBe(400);
    expect((await post(revoke, boss.headers, { reason: 'moved to sales' })).status).toBe(200);
    expect(passwordAuth.revoked).toContain('pp-08');
    const ended = await ctx.db.select().from(s.userSessions).where(eq(s.userSessions.userId, target.id));
    expect(ended.map((r) => r.revokedReason)).toEqual(['staff_role_removed']);
    expect((await get('/v1/admin/customers/search?q=ashaverma', target.headers)).status).toBe(403);
    expect((await post(revoke, boss.headers, { reason: 'moved to sales' })).status).toBe(404);
  });

  it('nobody changes their own roles; unknown phone and foreign grant ids are 404; partner roles are not managed here', async () => {
    const boss = await person('07', 'super_admin');
    const self = await post('/v1/admin/staff/grants', boss.headers, {
      phone: boss.phone,
      role: 'marketing',
      reason: 'giving myself more',
    });
    expect(self.status).toBe(403);
    expect(await codeOf(self)).toBe('STAFF_SELF_CHANGE');
    expect(
      (
        await post('/v1/admin/staff/grants', boss.headers, {
          phone: '+919800000000',
          role: 'marketing',
          reason: 'no such account',
        })
      ).status,
    ).toBe(404);
    const bad = await post('/v1/admin/staff/grants', boss.headers, {
      phone: '+919844444408',
      role: 'seller_owner',
      reason: 'wrong screen for this',
    });
    expect(bad.status).toBe(422);
    expect(await codeOf(bad)).toBe('ROLE_NOT_STAFF');
    expect(
      (
        await post('/v1/admin/staff/grants/019a8f00-0000-7000-8000-0000000000ff/revoke', boss.headers, {
          reason: 'no such grant',
        })
      ).status,
    ).toBe(404);
    const [own] = await ctx.db.select().from(s.userRoles).where(eq(s.userRoles.userId, boss.id));
    const mine = await post(`/v1/admin/staff/grants/${own!.id}/revoke`, boss.headers, {
      reason: 'leaving the team',
    });
    expect(mine.status).toBe(403);
  });

  it('a city role needs a city', async () => {
    const boss = await person('07', 'super_admin');
    await person('09', null);
    const url = '/v1/admin/staff/grants';
    const base = { phone: '+919844444409', role: 'city_manager', reason: 'runs the city' };
    expect(await codeOf(await post(url, boss.headers, base))).toBe('ROLE_SCOPE');
    expect((await post(url, boss.headers, { ...base, cityId: raipur })).status).toBe(201);
  });
});

describe('customer search and view', () => {
  it('finds a customer masked; the profile is masked for support and unmasked, audited, for the super admin', async () => {
    const support = await person('02', 'support_agent');
    const boss = await person('07', 'super_admin');
    const asha = await person('10', null, null, 'Asha Verma Searchable');

    const found = (await (
      await get('/v1/admin/customers/search?q=asha%20verma%20search', support.headers)
    ).json()) as {
      kind: string;
      results: { id: string; phoneMasked: string; emailMasked: string }[];
    };
    expect(found.kind).toBe('name');
    expect(found.results.map((r) => r.id)).toEqual([asha.id]);
    expect(found.results[0]).toMatchObject({ phoneMasked: '••••••4410', emailMasked: 'p•••@example.com' });
    expect(JSON.stringify(found)).not.toContain(asha.phone);
    const byPhone = (await (
      await get(`/v1/admin/customers/search?q=${asha.phone.slice(-10)}`, boss.headers)
    ).json()) as {
      results: { id: string }[];
    };
    expect(byPhone.results.map((r) => r.id)).toEqual([asha.id]);

    const masked = (await (await get(`/v1/admin/customers/${asha.id}`, support.headers)).json()) as {
      profile: { masked: boolean; phone: string; email: string };
      coins: unknown;
      tickets: unknown[];
    };
    expect(masked.profile).toMatchObject({ masked: true, phone: '••••••4410' });
    expect(masked.coins).toEqual({ balance: 0, lifetimeEarned: 0 });
    expect(masked.tickets).toEqual([]);

    const before = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'customer.pii_viewed'));
    const open = (await (await get(`/v1/admin/customers/${asha.id}`, boss.headers)).json()) as {
      profile: { masked: boolean; phone: string; email: string };
    };
    expect(open.profile).toMatchObject({ masked: false, phone: asha.phone, email: 'pp-10@example.com' });
    const after = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.action, 'customer.pii_viewed'));
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)).toMatchObject({ actorUserId: boss.id, entityId: asha.id });
  });

  it('refuses weak queries and unknown params, unknown id is 404, a non-uuid id is 400', async () => {
    const support = await person('02', 'support_agent');
    for (const q of ['a', '98765', '']) {
      const r = await get(`/v1/admin/customers/search?q=${q}`, support.headers);
      expect([q, r.status]).toEqual([q, 422]);
    }
    expect((await get('/v1/admin/customers/search?q=ashaverma&x=1', support.headers)).status).toBe(400);
    expect(
      (await get('/v1/admin/customers/019a8f00-0000-7000-8000-0000000000ff', support.headers)).status,
    ).toBe(404);
    expect((await get('/v1/admin/customers/not-a-uuid', support.headers)).status).toBe(400);
  });

  it('is rate limited per staff user', async () => {
    const ops = await person('01', 'ops_manager');
    let last = 200;
    for (let i = 0; i < 40 && last !== 429; i++)
      last = (await get('/v1/admin/customers/search?q=nobodyhere', ops.headers)).status;
    expect(last).toBe(429);
  });
});

describe('audit log viewer', () => {
  it('finance and super admin read it; filters, paging, masked JSON, strict query', async () => {
    const fin = await person('03', 'finance');
    const boss = await person('07', 'super_admin');
    await ctx.db.insert(s.auditLog).values([
      {
        actorUserId: boss.id,
        actorRole: 'staff',
        action: 'profile.updated',
        entity: 'user',
        entityId: 'aud-1',
        before: { phone: '+919876543210' },
        after: { email: 'asha@example.com' },
      },
      {
        actorUserId: boss.id,
        actorRole: 'staff',
        action: 'profile.updated',
        entity: 'user',
        entityId: 'aud-2',
      },
      {
        actorUserId: boss.id,
        actorRole: 'staff',
        action: 'setting.changed',
        entity: 'setting',
        entityId: 'aud-3',
      },
    ]);
    for (const p of [fin, boss]) {
      const r = await get('/v1/admin/audit?entity=user&entityId=aud-1', p.headers);
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        rows: { action: string; before: unknown; after: unknown; actorName: string }[];
        nextCursor: string | null;
      };
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]?.before).toEqual({ phone: '••••••3210' });
      expect(body.rows[0]?.after).toEqual({ email: 'a•••@example.com' });
      expect(body.rows[0]?.actorName).toBe('Person 07');
    }
    const page1 = (await (
      await get(`/v1/admin/audit?action=profile.updated&actor=${boss.id}&limit=1`, fin.headers)
    ).json()) as {
      rows: { id: number }[];
      nextCursor: string;
    };
    expect(page1.rows).toHaveLength(1);
    const page2 = (await (
      await get(
        `/v1/admin/audit?action=profile.updated&actor=${boss.id}&limit=1&cursor=${page1.nextCursor}`,
        fin.headers,
      )
    ).json()) as {
      rows: { id: number }[];
    };
    expect(page2.rows[0]?.id).toBeLessThan(page1.rows[0]?.id ?? 0);
    expect((await get('/v1/admin/audit?cursor=bogus', fin.headers)).status).toBe(422);
    expect((await get('/v1/admin/audit?entity=a;b', fin.headers)).status).toBe(422);
    expect((await get('/v1/admin/audit?actor=nope', fin.headers)).status).toBe(422);
    expect((await get('/v1/admin/audit?from=2026-13-40', fin.headers)).status).toBe(422);
    expect((await get('/v1/admin/audit?limit=500', fin.headers)).status).toBe(400);
    expect((await get('/v1/admin/audit?bogus=1', fin.headers)).status).toBe(400);
  });
});
