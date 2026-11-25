import { describe, expect, it } from 'vitest';
import { isStaffGrant } from '../src/auth';
import { can, customerGrant, ROLES, type Grant, type Permission } from '../src/rbac';
import { USTAAD_PERMISSIONS } from '../src/ustaad/codes';

const grant = (role: keyof typeof ROLES, extra: Partial<Grant> = {}): Grant => ({
  role,
  permissions: ROLES[role].permissions,
  cityId: null,
  shopId: null,
  workshopId: null,
  ...extra,
});

describe('Ustaad permissions and roles (spec 23 § 3)', () => {
  it('every Ustaad permission exists in the catalogue', () => {
    const all: readonly string[] = ROLES.super_admin.permissions;
    for (const p of USTAAD_PERMISSIONS) expect(all).toContain(p);
  });

  it('a member (mechanic) can use, answer, vouch and post jobs, and nothing staff-like', () => {
    const m: readonly Permission[] = ROLES.mechanic.permissions;
    for (const p of ['ustaad:use', 'ustaad:answer', 'ustaad:vouch', 'ustaad:jobs_post'] as const)
      expect(m).toContain(p);
    for (const p of ['ustaad:read', 'ustaad:moderate', 'ustaad:settings', 'customers:read'] as const)
      expect(m).not.toContain(p);
  });

  it('community_manager is staff, city scoped, moderates and verifies, never reads PII or exports (SR-38)', () => {
    const cm = ROLES.community_manager;
    expect(cm.staff).toBe(true);
    expect(cm.scope).toBe('city');
    const perms: readonly Permission[] = cm.permissions;
    for (const p of [
      'ustaad:read',
      'ustaad:moderate',
      'ustaad:verify',
      'ustaad:location_exact',
      'ustaad:takedown',
    ] as const)
      expect(perms).toContain(p);
    expect(perms).not.toContain('customers:read_pii');
    expect(perms).not.toContain('exports:run');
    expect(perms).not.toContain('ustaad:settings');
    expect(perms).not.toContain('ustaad:use');
  });

  it('a city-A community manager does not cover city B', () => {
    const g = grant('community_manager', { cityId: 'A' });
    expect(can([g], 'ustaad:moderate', { cityId: 'A' })).toBe(true);
    expect(can([g], 'ustaad:moderate', { cityId: 'B' })).toBe(false);
  });

  it('ops reads, marketing runs promotions, only super admin edits settings', () => {
    const ops: readonly Permission[] = ROLES.ops_manager.permissions;
    expect(ops).toContain('ustaad:read');
    expect(ops).not.toContain('ustaad:moderate');
    const mk: readonly Permission[] = ROLES.marketing.permissions;
    expect(mk).toContain('ustaad:promotions');
    expect(mk).not.toContain('ustaad:read');
    for (const role of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
      const perms: readonly Permission[] = ROLES[role].permissions;
      if (role !== 'super_admin') expect(perms).not.toContain('ustaad:settings');
    }
    // city_manager spreads OPS but must not gain Ustaad reads by accident.
    const city: readonly Permission[] = ROLES.city_manager.permissions;
    expect(city).not.toContain('ustaad:read');
  });

  it('customers, shops and workshops hold no Ustaad permission', () => {
    for (const role of [
      'customer',
      'seller_owner',
      'seller_staff',
      'workshop_owner',
      'workshop_staff',
    ] as const) {
      const perms: readonly string[] = ROLES[role].permissions;
      expect(perms.filter((p) => p.startsWith('ustaad:'))).toEqual([]);
    }
  });
});

describe('isStaffGrant with the mechanic grant (Ustaad A, bug found by the advisor)', () => {
  it('a mechanic grant (scope self, no shop or workshop) is not a staff grant', () => {
    expect(isStaffGrant(grant('mechanic'))).toBe(false);
  });
  it('known staff roles still are, and custom roles keep the heuristic', () => {
    expect(isStaffGrant(grant('community_manager', { cityId: 'c1' }))).toBe(true);
    expect(isStaffGrant({ ...grant('ops_manager'), role: 'custom_made_by_admin' })).toBe(true);
    expect(isStaffGrant(customerGrant())).toBe(false);
  });
});
