import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { isRoleKey, ROLES } from '@mechdost/shared/rbac';
import { maskEmail, maskPhone } from '@mechdost/shared/contact-mask';
import { auditLog, cities, roles, userRoles, users } from '../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { insertUserRole, loadGrants } from './rbac';
import type { Tx } from './orders';

/**
 * Staff and roles for the console (design 2026-11-15, specs 08/13). Rules, all enforced here (the API only gates
 * on `staff:manage`): only staff roles scoped global or to one city are managed here; nobody changes their own
 * roles; only a super admin grants or revokes `super_admin` and `finance`; the last super admin cannot be removed
 * (an advisory lock makes two simultaneous revokes safe); every change writes `audit_log` with its reason and a
 * server event, in the same transaction.
 */
const STAFF_ROLE_KEYS = Object.entries(ROLES)
  .filter(([, r]) => r.staff)
  .map(([key]) => key);
const SUPER_ADMIN_ONLY = new Set(['super_admin', 'finance']);
const LIST_CAP = 200;
/** Fixed key of the advisory lock that serialises revokes of `super_admin`. */
const SUPER_ADMIN_LOCK = 7_300_001;

export interface StaffGrantView {
  grantId: string;
  role: string;
  roleName: string;
  cityId: string | null;
  grantedAt: Date;
}
export interface StaffMemberView {
  userId: string;
  name: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  status: string;
  lastSignInAt: Date | null;
  twoFactor: 'ready' | 'phone_missing';
  isSelf: boolean;
  grants: StaffGrantView[];
}
export interface StaffList {
  staff: StaffMemberView[];
  truncated: boolean;
  roles: { key: string; name: string; scope: 'global' | 'city'; superAdminOnly: boolean }[];
  cities: { id: string; code: string; name: string; nameHi: string | null }[];
}

export async function listStaff(db: Tx, input: { viewerId: string }): Promise<StaffList> {
  const idRows = await db
    .selectDistinct({ id: users.id, name: users.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(roles.key, STAFF_ROLE_KEYS), isNull(users.deletedAt)))
    .orderBy(asc(users.name), asc(users.id))
    .limit(LIST_CAP + 1);
  const truncated = idRows.length > LIST_CAP;
  const ids = idRows.slice(0, LIST_CAP).map((r) => r.id);

  const [people, grantRows, signIns, cityRows] = ids.length
    ? await Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            phone: users.phone,
            phoneVerifiedAt: users.phoneVerifiedAt,
            email: users.email,
            status: users.status,
          })
          .from(users)
          .where(inArray(users.id, ids)),
        db
          .select({
            grantId: userRoles.id,
            userId: userRoles.userId,
            role: roles.key,
            roleName: roles.name,
            cityId: userRoles.cityId,
            grantedAt: userRoles.createdAt,
          })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(inArray(userRoles.userId, ids), inArray(roles.key, STAFF_ROLE_KEYS)))
          .orderBy(asc(userRoles.createdAt)),
        db
          .select({ userId: auditLog.entityId, at: sql<Date>`max(${auditLog.createdAt})` })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.entity, 'user'),
              eq(auditLog.action, 'auth.staff_signed_in'),
              inArray(auditLog.entityId, ids),
            ),
          )
          .groupBy(auditLog.entityId),
        db
          .select({ id: cities.id, code: cities.code, name: cities.name, nameHi: cities.nameHi })
          .from(cities)
          .orderBy(asc(cities.name)),
      ])
    : [
        [],
        [],
        [],
        await db
          .select({ id: cities.id, code: cities.code, name: cities.name, nameHi: cities.nameHi })
          .from(cities)
          .orderBy(asc(cities.name)),
      ];

  const person = new Map(people.map((p) => [p.id, p]));
  const lastIn = new Map(signIns.map((r) => [r.userId, new Date(r.at)]));
  const staff: StaffMemberView[] = [];
  for (const { id } of idRows.slice(0, LIST_CAP)) {
    const p = person.get(id);
    if (!p) continue;
    staff.push({
      userId: id,
      name: p.name,
      phoneMasked: maskPhone(p.phone),
      emailMasked: maskEmail(p.email),
      status: p.status,
      lastSignInAt: lastIn.get(id) ?? null,
      twoFactor: p.phone !== null && p.phoneVerifiedAt !== null ? 'ready' : 'phone_missing',
      isSelf: id === input.viewerId,
      grants: grantRows.filter((g) => g.userId === id).map(({ userId: _u, ...g }) => g),
    });
  }
  return {
    staff,
    truncated,
    roles: Object.entries(ROLES)
      .filter(([key]) => STAFF_ROLE_KEYS.includes(key))
      .map(([key, r]) => ({
        key,
        name: r.name,
        scope: r.scope === 'city' ? ('city' as const) : ('global' as const),
        superAdminOnly: SUPER_ADMIN_ONLY.has(key),
      })),
    cities: cityRows,
  };
}

/** `+91…` for a bare 10-digit number; E.164 as typed; anything else is refused. */
function e164(raw: string): string {
  const compact = raw.replace(/[\s()-]/g, '');
  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  throw new ValidationError('Enter the phone number the person signed up with', 'PHONE_INVALID');
}

async function actorIsSuperAdmin(tx: Tx, actorUserId: string): Promise<boolean> {
  const grants = await loadGrants(tx, actorUserId);
  return grants.some((g) => g.role === 'super_admin' && g.cityId === null);
}

function assertManageable(role: string): void {
  if (!isRoleKey(role) || !STAFF_ROLE_KEYS.includes(role))
    throw new ValidationError('This role is not managed here', 'ROLE_NOT_STAFF');
}

export async function grantStaffRole(
  db: Tx,
  input: { actorUserId: string; phone: string; role: string; cityId: string | null; reason: string },
): Promise<{ grantId: string; targetUserId: string; targetFirebaseUid: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError('A reason is needed', 'REASON_REQUIRED');
  assertManageable(input.role);
  const phone = e164(input.phone);
  return db.transaction(async (tx) => {
    if (SUPER_ADMIN_ONLY.has(input.role) && !(await actorIsSuperAdmin(tx, input.actorUserId)))
      throw new ForbiddenError('Only a super admin can give this role', 'ROLE_SUPER_ADMIN_ONLY');
    const [target] = await tx
      .select({ id: users.id, firebaseUid: users.firebaseUid })
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deletedAt), eq(users.status, 'active')));
    if (!target) throw new NotFoundError('No account uses this phone number; the person signs up first');
    if (target.id === input.actorUserId)
      throw new ForbiddenError('You cannot change your own roles', 'STAFF_SELF_CHANGE');
    if (input.cityId) {
      const [city] = await tx.select({ id: cities.id }).from(cities).where(eq(cities.id, input.cityId));
      if (!city) throw new NotFoundError('City not found');
    }
    const grantId = await insertUserRole(tx, {
      userId: target.id,
      role: input.role,
      cityId: input.cityId,
      grantedBy: input.actorUserId,
    });
    if (grantId === null) throw new ConflictError('This person already has this role', 'ROLE_ALREADY_HELD');
    await tx.insert(auditLog).values({
      actorUserId: input.actorUserId,
      actorRole: 'staff',
      action: 'role.granted',
      entity: 'user_role',
      entityId: grantId,
      after: { userId: target.id, role: input.role, cityId: input.cityId },
      reason,
    });
    await recordServerEvent(tx, 'admin_staff_role_changed', {
      userId: input.actorUserId,
      props: {
        action: 'granted',
        targetUserId: target.id,
        role: input.role,
        cityScoped: input.cityId !== null,
      },
    });
    return { grantId, targetUserId: target.id, targetFirebaseUid: target.firebaseUid };
  });
}

export async function revokeStaffRole(
  db: Tx,
  input: { actorUserId: string; grantId: string; reason: string },
): Promise<{ targetUserId: string; targetFirebaseUid: string; role: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError('A reason is needed', 'REASON_REQUIRED');
  return db.transaction(async (tx) => {
    const [grant] = await tx
      .select({
        id: userRoles.id,
        userId: userRoles.userId,
        role: roles.key,
        cityId: userRoles.cityId,
        firebaseUid: users.firebaseUid,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.id, input.grantId), inArray(roles.key, STAFF_ROLE_KEYS)));
    if (!grant) throw new NotFoundError('Role not found');
    if (grant.userId === input.actorUserId)
      throw new ForbiddenError('You cannot change your own roles', 'STAFF_SELF_CHANGE');
    if (SUPER_ADMIN_ONLY.has(grant.role) && !(await actorIsSuperAdmin(tx, input.actorUserId)))
      throw new ForbiddenError('Only a super admin can remove this role', 'ROLE_SUPER_ADMIN_ONLY');
    if (grant.role === 'super_admin') {
      // Two admins removing each other at once would leave none: serialise, then count who remains.
      await tx.execute(sql`select pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`);
      const others = await tx
        .selectDistinct({ id: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(
            eq(roles.key, 'super_admin'),
            isNull(userRoles.cityId),
            eq(users.status, 'active'),
            ne(userRoles.id, grant.id),
          ),
        );
      if (others.length === 0) throw new ConflictError('This is the last super admin', 'LAST_SUPER_ADMIN');
    }
    const removed = await tx
      .delete(userRoles)
      .where(eq(userRoles.id, grant.id))
      .returning({ id: userRoles.id });
    if (removed.length === 0) throw new NotFoundError('Role not found');
    await tx.insert(auditLog).values({
      actorUserId: input.actorUserId,
      actorRole: 'staff',
      action: 'role.revoked',
      entity: 'user_role',
      entityId: grant.id,
      before: { userId: grant.userId, role: grant.role, cityId: grant.cityId },
      reason,
    });
    await recordServerEvent(tx, 'admin_staff_role_changed', {
      userId: input.actorUserId,
      props: {
        action: 'revoked',
        targetUserId: grant.userId,
        role: grant.role,
        cityScoped: grant.cityId !== null,
      },
    });
    return { targetUserId: grant.userId, targetFirebaseUid: grant.firebaseUid, role: grant.role };
  });
}
