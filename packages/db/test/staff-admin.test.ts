/**
 * Staff and roles for the console (design 2026-11-15, spec 13): grant and revoke with a reason, only a super admin
 * grants or revokes `super_admin`/`finance`, nobody changes their own roles, the last super admin cannot be
 * removed (even by two simultaneous revokes), every change is audited with its reason, the list shows the last
 * completed staff sign-in and the phone-code state.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { seedRaipurDemo, type DemoFixture } from '../src/demo-seed';
import {
  grantRole,
  grantStaffRole,
  listStaff,
  loadGrants,
  recordStaffSignIn,
  revokeStaffRole,
  syncRbacCatalogue,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let cityId = '';
let boss = '';
let boss2 = '';
let ops = '';
let person = '';

async function user(uid: string, phone: string | null, verified = true) {
  const [row] = await db
    .insert(s.users)
    .values({
      firebaseUid: uid,
      phone,
      phoneVerifiedAt: verified ? new Date() : null,
      name: uid,
      email: `${uid}@example.com`,
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await seedRaipurDemo(t(), fixture);
  await syncRbacCatalogue(t());
  cityId = (await db.select({ id: s.cities.id }).from(s.cities).limit(1))[0]!.id;
  boss = await user('st-boss', '+919810000001');
  boss2 = await user('st-boss2', '+919810000002');
  ops = await user('st-ops', '+919810000003');
  person = await user('st-person', '+919810000004');
  await grantRole(t(), { userId: boss, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: boss2, role: 'super_admin', grantedBy: null });
  await grantRole(t(), { userId: ops, role: 'ops_manager', grantedBy: boss });
});

afterAll(async () => {
  await client.close();
});

const grant = (over: Partial<Parameters<typeof grantStaffRole>[1]> = {}) =>
  grantStaffRole(t(), {
    actorUserId: boss,
    phone: '+919810000004',
    role: 'support_agent',
    cityId: null,
    reason: 'joins the support desk',
    ...over,
  });

describe('grantStaffRole', () => {
  it('grants a global role by phone (10 digits work too), audits it with the reason, emits an event', async () => {
    const out = await grant({ phone: '9810000004' });
    expect(out.targetUserId).toBe(person);
    const grants = await loadGrants(t(), person);
    expect(grants.map((g) => g.role)).toContain('support_agent');
    const [row] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'role.granted'), eq(s.auditLog.entityId, out.grantId)));
    expect(row?.reason).toBe('joins the support desk');
    expect(row?.actorUserId).toBe(boss);
    const ev = await db.execute(
      `select props from events where event = 'admin_staff_role_changed' and user_id = '${boss}'`,
    );
    expect(JSON.stringify(ev)).toContain(person);
  });

  it('refuses a second identical grant, an unknown phone, a non-staff role and a missing city', async () => {
    await expect(grant()).rejects.toMatchObject({ status: 409, code: 'ROLE_ALREADY_HELD' });
    await expect(grant({ phone: '+919899999999' })).rejects.toMatchObject({ status: 404 });
    await expect(grant({ role: 'seller_owner' })).rejects.toMatchObject({ code: 'ROLE_NOT_STAFF' });
    await expect(grant({ role: 'customer' })).rejects.toMatchObject({ code: 'ROLE_NOT_STAFF' });
    await expect(grant({ role: 'city_manager', cityId: null })).rejects.toMatchObject({ code: 'ROLE_SCOPE' });
    await expect(grant({ phone: '12ab' })).rejects.toMatchObject({ code: 'PHONE_INVALID' });
  });

  it('grants a city role with its city; an unknown city is 404', async () => {
    const out = await grant({ role: 'city_manager', cityId });
    const grants = await loadGrants(t(), person);
    expect(grants.find((g) => g.role === 'city_manager')?.cityId).toBe(cityId);
    expect(out.grantId).toBeTruthy();
    await expect(
      grant({ role: 'city_manager', cityId: '019a8f00-0000-7000-8000-000000000999' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('nobody changes their own roles', async () => {
    await expect(grant({ phone: '+919810000001', role: 'marketing' })).rejects.toMatchObject({
      status: 403,
      code: 'STAFF_SELF_CHANGE',
    });
  });

  it('only a super admin grants super_admin or finance', async () => {
    for (const role of ['super_admin', 'finance'])
      await expect(grant({ actorUserId: ops, role })).rejects.toMatchObject({
        status: 403,
        code: 'ROLE_SUPER_ADMIN_ONLY',
      });
    const out = await grant({ role: 'finance' });
    expect(out.grantId).toBeTruthy();
  });
});

describe('revokeStaffRole', () => {
  it('removes the grant, audits before and reason, and is 404 for an unknown or partner grant', async () => {
    const out = await grant({ role: 'marketing' });
    const done = await revokeStaffRole(t(), {
      actorUserId: boss,
      grantId: out.grantId,
      reason: 'moved to another team',
    });
    expect(done).toMatchObject({ targetUserId: person, role: 'marketing' });
    expect((await loadGrants(t(), person)).map((g) => g.role)).not.toContain('marketing');
    const [row] = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'role.revoked'), eq(s.auditLog.entityId, out.grantId)));
    expect(row?.reason).toBe('moved to another team');
    await expect(
      revokeStaffRole(t(), { actorUserId: boss, grantId: out.grantId, reason: 'again please' }),
    ).rejects.toMatchObject({ status: 404 });

    const [shopRole] = await db.select().from(s.roles).where(eq(s.roles.key, 'seller_owner'));
    const [partner] = await db
      .insert(s.userRoles)
      .values({
        userId: person,
        roleId: shopRole!.id,
        shopId: (await db.select().from(s.shops).limit(1))[0]!.id,
      })
      .returning();
    await expect(
      revokeStaffRole(t(), { actorUserId: boss, grantId: partner!.id, reason: 'not through here' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('nobody revokes their own role; only a super admin revokes super_admin or finance', async () => {
    const [own] = await db.select().from(s.userRoles).where(eq(s.userRoles.userId, ops));
    await expect(
      revokeStaffRole(t(), { actorUserId: ops, grantId: own!.id, reason: 'leaving the team' }),
    ).rejects.toMatchObject({ code: 'STAFF_SELF_CHANGE' });
    const fin = (await loadGrants(t(), person)).length; // person holds finance from the earlier test
    expect(fin).toBeGreaterThan(1);
    const [finGrant] = await db
      .select({ id: s.userRoles.id })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(and(eq(s.userRoles.userId, person), eq(s.roles.key, 'finance')));
    await expect(
      revokeStaffRole(t(), { actorUserId: ops, grantId: finGrant!.id, reason: 'not allowed for ops' }),
    ).rejects.toMatchObject({ code: 'ROLE_SUPER_ADMIN_ONLY' });
  });

  it('keeps the last super admin: two simultaneous revokes leave one', async () => {
    const rows = await db
      .select({ id: s.userRoles.id, userId: s.userRoles.userId })
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(eq(s.roles.key, 'super_admin'));
    const bossGrant = rows.find((r) => r.userId === boss)!;
    const boss2Grant = rows.find((r) => r.userId === boss2)!;
    const results = await Promise.allSettled([
      revokeStaffRole(t(), { actorUserId: boss2, grantId: bossGrant.id, reason: 'swap one' }),
      revokeStaffRole(t(), { actorUserId: boss, grantId: boss2Grant.id, reason: 'swap two' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const left = await db
      .select()
      .from(s.userRoles)
      .innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
      .where(eq(s.roles.key, 'super_admin'));
    expect(left).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected');
    const code = failed!.reason as { code: string };
    expect(['LAST_SUPER_ADMIN', 'ROLE_SUPER_ADMIN_ONLY']).toContain(code.code);
    // restore for the list test
    await grantRole(t(), { userId: boss, role: 'super_admin', grantedBy: null });
    await grantRole(t(), { userId: boss2, role: 'super_admin', grantedBy: null });
  });
});

describe('listStaff', () => {
  it('lists staff with their grants, masked contacts, last sign-in and phone-code state', async () => {
    const noPhone = await user('st-nophone', null, false);
    await grantRole(t(), { userId: noPhone, role: 'marketing', grantedBy: boss });
    await recordStaffSignIn(t(), ops);
    await recordStaffSignIn(t(), ops);
    const list = await listStaff(t(), { viewerId: boss });
    const byId = new Map(list.staff.map((m) => [m.userId, m]));
    expect(byId.get(ops)).toMatchObject({
      twoFactor: 'ready',
      isSelf: false,
      phoneMasked: '••••••0003',
      emailMasked: 's•••@example.com',
    });
    expect(byId.get(ops)?.lastSignInAt).toBeTruthy();
    expect(byId.get(boss)?.isSelf).toBe(true);
    expect(byId.get(noPhone)).toMatchObject({ twoFactor: 'phone_missing', lastSignInAt: null });
    expect(byId.get(ops)?.grants[0]).toMatchObject({ role: 'ops_manager', cityId: null });
    expect(list.roles.map((r) => r.key)).toEqual(
      expect.arrayContaining(['super_admin', 'city_manager', 'support_agent']),
    );
    expect(list.roles.find((r) => r.key === 'city_manager')).toMatchObject({ scope: 'city' });
    expect(list.roles.find((r) => r.key === 'finance')).toMatchObject({ superAdminOnly: true });
    expect(list.roles.map((r) => r.key)).not.toContain('seller_owner');
    expect(list.cities.length).toBeGreaterThan(0);
    expect(list.truncated).toBe(false);
    // customers without staff roles are not listed
    expect(byId.has(await user('st-plain', '+919810000009'))).toBe(false);
  });
});
