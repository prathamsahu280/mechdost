import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  can,
  customerGrant,
  isPermission,
  permissionsOf,
  type Grant,
  type Permission,
} from '../src/rbac';

const allPermissions = Object.keys(PERMISSIONS) as Permission[];

describe('permission catalogue', () => {
  it('uses resource:action keys that the database CHECK accepts', () => {
    for (const key of allPermissions) expect(key).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it('describes every permission', () => {
    for (const key of allPermissions) expect(PERMISSIONS[key].length).toBeGreaterThan(5);
  });

  it('only grants permissions that exist, without duplicates', () => {
    for (const role of Object.values(ROLES)) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('gives super_admin every permission', () => {
    expect([...ROLES.super_admin.permissions].sort()).toEqual([...allPermissions].sort());
  });

  it('keeps partner roles away from staff-only powers (least privilege)', () => {
    const staffOnly: Permission[] = ['orders:route', 'refunds:approve', 'roles:manage', 'settings:write'];
    for (const key of [
      'seller_owner',
      'seller_staff',
      'workshop_owner',
      'workshop_staff',
      'customer',
    ] as const) {
      for (const p of staffOnly) expect(ROLES[key].permissions).not.toContain(p);
    }
  });

  it('lets support see customers but not their unmasked PII', () => {
    expect(ROLES.support_agent.permissions).toContain('customers:read');
    expect(ROLES.support_agent.permissions).not.toContain('customers:read_pii');
  });

  it('declares the scope each partner/city role must carry', () => {
    expect(ROLES.city_manager.scope).toBe('city');
    expect(ROLES.seller_owner.scope).toBe('shop');
    expect(ROLES.workshop_staff.scope).toBe('workshop');
    expect(ROLES.ops_manager.scope).toBe('global');
  });
});

describe('can()', () => {
  const customer = customerGrant();
  const grant = (role: keyof typeof ROLES, scope: Partial<Grant> = {}): Grant => ({
    role,
    permissions: ROLES[role].permissions,
    cityId: null,
    shopId: null,
    workshopId: null,
    ...scope,
  });

  it('allows customer actions for every signed-in user', () => {
    expect(can([customer], 'orders:place')).toBe(true);
    expect(can([customer], 'orders:route')).toBe(false);
  });

  it('applies a global grant everywhere', () => {
    const ops = grant('ops_manager');
    expect(can([ops], 'orders:route', { cityId: 'raipur' })).toBe(true);
  });

  it('restricts a city-scoped grant to its city', () => {
    const cm = grant('city_manager', { cityId: 'raipur' });
    expect(can([cm], 'orders:route', { cityId: 'raipur' })).toBe(true);
    expect(can([cm], 'orders:route', { cityId: 'bhilai' })).toBe(false);
    // Without a target city the caller must filter by the grant's scope itself; the check still passes.
    expect(can([cm], 'orders:route')).toBe(true);
  });

  it('restricts a shop grant to its shop', () => {
    const seller = grant('seller_staff', { shopId: 'shop-a' });
    expect(can([seller], 'assignments:respond', { shopId: 'shop-a' })).toBe(true);
    expect(can([seller], 'assignments:respond', { shopId: 'shop-b' })).toBe(false);
    expect(can([seller], 'assignments:respond', { workshopId: 'ws-1' })).toBe(false);
  });

  it('honours custom roles defined in the database', () => {
    const custom: Grant = {
      role: 'night_desk',
      permissions: ['tickets:reply'],
      cityId: null,
      shopId: null,
      workshopId: null,
    };
    expect(can([custom], 'tickets:reply')).toBe(true);
    expect(can([custom], 'tickets:assign')).toBe(false);
  });

  it('unions permissions across grants', () => {
    const grants = [customer, grant('seller_owner', { shopId: 'shop-a' })];
    expect(permissionsOf(grants).has('inventory:write')).toBe(true);
    expect(permissionsOf(grants).has('orders:place')).toBe(true);
  });
});

describe('price approval (design 2026-11-13)', () => {
  it('operations staff approve seller prices; marketing and shops do not', () => {
    expect(isPermission('prices:approve')).toBe(true);
    expect((ROLES.ops_manager.permissions as readonly string[]).includes('prices:approve')).toBe(true);
    expect((ROLES.city_manager.permissions as readonly string[]).includes('prices:approve')).toBe(true);
    expect((ROLES.marketing.permissions as readonly string[]).includes('prices:approve')).toBe(false);
    expect((ROLES.seller_owner.permissions as readonly string[]).includes('prices:approve')).toBe(false);
  });
});
