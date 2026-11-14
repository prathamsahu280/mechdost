import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  customerGrant,
  isPermission,
  isRoleKey,
  PERMISSIONS,
  ROLES,
  type Grant,
  type Permission,
  type RoleScope,
} from '@mechdost/shared/rbac';
import { auditLog, permissions, rolePermissions, roles, userRoles } from '../schema';
import { NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Make the database match the shared catalogue (packages/shared/src/rbac.ts). Idempotent; run by the seed and
 * on deploy. System roles are reset to exactly their catalogue permissions; admin-created custom roles keep
 * theirs (minus permissions that no longer exist, removed by the FK cascade).
 */
export async function syncRbacCatalogue(db: Tx): Promise<void> {
  const keys = Object.keys(PERMISSIONS) as Permission[];
  await db.transaction(async (tx) => {
    await tx
      .insert(permissions)
      .values(keys.map((key) => ({ key, description: PERMISSIONS[key] })))
      .onConflictDoUpdate({ target: permissions.key, set: { description: sql`excluded.description` } });
    await tx.delete(permissions).where(notInArray(permissions.key, keys));

    for (const [key, role] of Object.entries(ROLES)) {
      const [row] = await tx
        .insert(roles)
        .values({ key, name: role.name, description: role.description, isSystem: true })
        .onConflictDoUpdate({
          target: roles.key,
          set: { name: role.name, description: role.description, isSystem: true },
        })
        .returning({ id: roles.id });
      if (!row) throw new NotFoundError(`Role ${key} could not be stored`);
      const wanted = [...role.permissions];
      await tx
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, row.id), notInArray(rolePermissions.permissionKey, wanted)));
      await tx
        .insert(rolePermissions)
        .values(wanted.map((permissionKey) => ({ roleId: row.id, permissionKey })))
        .onConflictDoNothing();
    }
  });
}

/**
 * All grants a user holds: the implicit customer grant plus stored roles with their permissions.
 * One indexed query (user_roles.user_id via the scope unique index, role_permissions PK).
 */
export async function loadGrants(db: Tx, userId: string): Promise<Grant[]> {
  const rows = await db
    .select({
      grantId: userRoles.id,
      role: roles.key,
      cityId: userRoles.cityId,
      shopId: userRoles.shopId,
      workshopId: userRoles.workshopId,
      permission: rolePermissions.permissionKey,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const byGrant = new Map<string, Grant & { permissions: Permission[] }>();
  for (const r of rows) {
    let g = byGrant.get(r.grantId);
    if (!g) {
      g = { role: r.role, cityId: r.cityId, shopId: r.shopId, workshopId: r.workshopId, permissions: [] };
      byGrant.set(r.grantId, g);
    }
    if (r.permission !== null && isPermission(r.permission)) g.permissions.push(r.permission);
  }
  return [customerGrant(), ...byGrant.values()];
}

export interface GrantRoleInput {
  userId: string;
  role: string;
  cityId?: string | null;
  shopId?: string | null;
  workshopId?: string | null;
  grantedBy: string | null;
  reason?: string;
}

function assertScope(scope: RoleScope | 'custom', input: GrantRoleInput) {
  const has = {
    city: Boolean(input.cityId),
    shop: Boolean(input.shopId),
    workshop: Boolean(input.workshopId),
  };
  const ok =
    scope === 'global' || scope === 'self'
      ? !has.city && !has.shop && !has.workshop
      : scope === 'city'
        ? has.city && !has.shop && !has.workshop
        : scope === 'shop'
          ? has.shop && !has.workshop
          : scope === 'workshop'
            ? has.workshop && !has.shop
            : !has.shop && !has.workshop; // custom staff roles: global or city-scoped
  if (!ok) throw new ValidationError(`Role ${input.role} needs ${scope} scope`, 'ROLE_SCOPE');
}

/**
 * Insert one `user_roles` row after the scope check, in the caller's transaction; null when the user already holds
 * the role with this scope. Shared by `grantRole` and the console's `grantStaffRole`.
 */
export async function insertUserRole(tx: Tx, input: GrantRoleInput): Promise<string | null> {
  if (input.role === 'customer') {
    throw new ValidationError('Every signed-in user is already a customer', 'ROLE_IMPLICIT');
  }
  assertScope(isRoleKey(input.role) ? ROLES[input.role].scope : 'custom', input);
  const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, input.role)).limit(1);
  if (!role) throw new NotFoundError(`Unknown role ${input.role}`);
  const inserted = await tx
    .insert(userRoles)
    .values({
      userId: input.userId,
      roleId: role.id,
      cityId: input.cityId ?? null,
      shopId: input.shopId ?? null,
      workshopId: input.workshopId ?? null,
      grantedBy: input.grantedBy,
    })
    .onConflictDoNothing()
    .returning({ id: userRoles.id });
  return inserted[0]?.id ?? null;
}

/** Grant a role (idempotent) and audit it. Customer is implicit and can never be granted. */
export async function grantRole(db: Tx, input: GrantRoleInput): Promise<void> {
  if (input.role === 'customer') {
    throw new ValidationError('Every signed-in user is already a customer', 'ROLE_IMPLICIT');
  }
  await db.transaction(async (tx) => {
    const id = await insertUserRole(tx, input);
    const row = id === null ? undefined : { id };
    if (!row) return; // already held with this scope
    await tx.insert(auditLog).values({
      actorUserId: input.grantedBy,
      actorRole: input.grantedBy === null ? 'system' : 'admin',
      action: 'role.granted',
      entity: 'user_role',
      entityId: row.id,
      after: {
        userId: input.userId,
        role: input.role,
        cityId: input.cityId ?? null,
        shopId: input.shopId ?? null,
        workshopId: input.workshopId ?? null,
      },
      reason: input.reason ?? null,
    });
  });
}

/** Users holding any of the given roles (used to find staff for notifications and 2FA enforcement). */
export async function countUsersWithRoles(db: Tx, roleKeys: string[]): Promise<number> {
  const rows = await db
    .selectDistinct({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(roles.key, roleKeys));
  return rows.length;
}
