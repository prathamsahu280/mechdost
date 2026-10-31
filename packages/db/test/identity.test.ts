import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES } from '@mechdost/shared/rbac';
import {
  deactivateUser,
  ensureUser,
  grantRole,
  loadGrants,
  syncRbacCatalogue,
  updateProfile,
} from '../src/repo';
import { ConflictError, ValidationError } from '../src/repo/errors';
import { auditLog, permissions, rolePermissions, roles, users } from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;

beforeAll(async () => {
  ({ db } = await createTestDb());
  await syncRbacCatalogue(db);
});

const identity = (uid: string, phone: string, email: string | null = null, emailVerified = false) => ({
  firebaseUid: uid,
  phone,
  email,
  emailVerified,
});

describe('syncRbacCatalogue', () => {
  it('stores every permission and system role from the shared catalogue', async () => {
    expect(await db.$count(permissions)).toBe(Object.keys(PERMISSIONS).length);
    expect(await db.$count(roles)).toBe(Object.keys(ROLES).length);
    const [sa] = await db.select().from(roles).where(eq(roles.key, 'super_admin'));
    expect(await db.$count(rolePermissions, eq(rolePermissions.roleId, sa!.id))).toBe(
      Object.keys(PERMISSIONS).length,
    );
  });

  it('is idempotent and removes permissions a system role no longer has', async () => {
    const [ops] = await db.select().from(roles).where(eq(roles.key, 'ops_manager'));
    await db.insert(rolePermissions).values({ roleId: ops!.id, permissionKey: 'roles:manage' });
    await syncRbacCatalogue(db);
    await syncRbacCatalogue(db);
    const keys = (await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, ops!.id))).map(
      (r) => r.permissionKey,
    );
    expect(keys).not.toContain('roles:manage');
    expect(keys.sort()).toEqual([...ROLES.ops_manager.permissions].sort());
  });
});

describe('ensureUser', () => {
  it('provisions a user on first sign-in with the phone verified and audits it without PII', async () => {
    const u = await ensureUser(db, identity('uid-1', '+919800000001'));
    expect(u.phone).toBe('+919800000001');
    expect(u.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(u.emailVerifiedAt).toBeNull();
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id));
    expect(audit.map((a) => a.action)).toEqual(['user.provisioned']);
    expect(JSON.stringify(audit[0]!.after)).not.toContain('9800000001');
  });

  it('returns the same row on later calls without writing', async () => {
    const a = await ensureUser(db, identity('uid-2', '+919800000002'));
    const b = await ensureUser(db, identity('uid-2', '+919800000002'));
    expect(b.id).toBe(a.id);
    expect(b.version).toBe(a.version);
  });

  it('is safe when two first requests race', async () => {
    const [a, b] = await Promise.all([
      ensureUser(db, identity('uid-3', '+919800000003')),
      ensureUser(db, identity('uid-3', '+919800000003')),
    ]);
    expect(a.id).toBe(b.id);
    expect(await db.$count(users, eq(users.firebaseUid, 'uid-3'))).toBe(1);
  });

  it('records email verification once Firebase reports it', async () => {
    await ensureUser(db, identity('uid-4', '+919800000004', 'a@example.com', false));
    const u = await ensureUser(db, identity('uid-4', '+919800000004', 'A@example.com', true));
    expect(u.emailVerifiedAt).toBeInstanceOf(Date);
    expect(u.version).toBe(2);
  });

  it('resets email verification when the email changes', async () => {
    await ensureUser(db, identity('uid-5', '+919800000005', 'old@example.com', true));
    const u = await ensureUser(db, identity('uid-5', '+919800000005', 'new@example.com', false));
    expect(u.email).toBe('new@example.com');
    expect(u.emailVerifiedAt).toBeNull();
  });

  it('refuses a phone number that belongs to another active account', async () => {
    await ensureUser(db, identity('uid-6', '+919800000006'));
    await expect(ensureUser(db, identity('uid-7', '+919800000006'))).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a malformed phone number', async () => {
    await expect(ensureUser(db, identity('uid-8', '98000'))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('grants', () => {
  it('returns the implicit customer grant plus stored scoped roles', async () => {
    const admin = await ensureUser(db, identity('uid-admin', '+919800000010'));
    const u = await ensureUser(db, identity('uid-seller', '+919800000011'));
    expect((await loadGrants(db, u.id)).map((g) => g.role)).toEqual(['customer']);

    const shopId = '0190f000-0000-7000-8000-000000000001';
    await grantRole(db, { userId: u.id, role: 'seller_owner', shopId, grantedBy: admin.id });
    const grants = await loadGrants(db, u.id);
    const seller = grants.find((g) => g.role === 'seller_owner');
    expect(seller?.shopId).toBe(shopId);
    expect([...(seller?.permissions ?? [])].sort()).toEqual([...ROLES.seller_owner.permissions].sort());
    expect(await db.$count(auditLog, eq(auditLog.action, 'role.granted'))).toBe(1);
  });

  it('refuses a grant whose scope does not match the role', async () => {
    const u = await ensureUser(db, identity('uid-scope', '+919800000012'));
    await expect(
      grantRole(db, { userId: u.id, role: 'seller_owner', grantedBy: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(grantRole(db, { userId: u.id, role: 'customer', grantedBy: null })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('updateProfile', () => {
  it('applies a patch at the expected version and audits the field names', async () => {
    const u = await ensureUser(db, identity('uid-profile', '+919800000020'));
    const updated = await updateProfile(db, {
      userId: u.id,
      expectedVersion: u.version,
      patch: { name: 'Asha Verma', language: 'hi' },
    });
    expect(updated.name).toBe('Asha Verma');
    expect(updated.language).toBe('hi');
    expect(updated.version).toBe(u.version + 1);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, 'user.profile_updated'));
    expect(audit?.after).toEqual({ fields: ['name', 'language'] });
  });

  it('refuses a stale version instead of overwriting', async () => {
    const u = await ensureUser(db, identity('uid-stale', '+919800000021'));
    await updateProfile(db, { userId: u.id, expectedVersion: u.version, patch: { name: 'First tab' } });
    await expect(
      updateProfile(db, { userId: u.id, expectedVersion: u.version, patch: { name: 'Second tab' } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses an empty patch', async () => {
    const u = await ensureUser(db, identity('uid-empty', '+919800000022'));
    await expect(
      updateProfile(db, { userId: u.id, expectedVersion: u.version, patch: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('deactivateUser', () => {
  it('deactivates once and audits the reason', async () => {
    const u = await ensureUser(db, identity('uid-deact', '+919800000030'));
    await deactivateUser(db, { userId: u.id, actorUserId: null, reason: 'fraud report REQ-1' });
    await deactivateUser(db, { userId: u.id, actorUserId: null, reason: 'again' });
    const again = await ensureUser(db, identity('uid-deact', '+919800000030'));
    expect(again.status).toBe('deactivated');
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'user.deactivated'));
    expect(audits.map((a) => a.reason)).toEqual(['fraud report REQ-1']);
  });
});
