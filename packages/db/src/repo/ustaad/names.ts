/**
 * Reserved and confusable names (spec 23 § 14a SR-4, AT-NAME-1; plan task B3). A display name (and its Hindi form)
 * is refused with 422 `NAME_RESERVED` when it, or any run of its words, has the skeleton of an active
 * `ustaad_reserved_names` row (brand, operator and staff role words, seeded by migration 0099, admin-editable), or
 * when the whole name reads the same as a MechDost staff member's name (staff impersonation). Contact details in a
 * name are refused with `NAME_CONTACT`, names without letters or with hidden characters with `NAME_FORMAT`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { ROLES } from '@mechdost/shared/rbac';
import { displayNameRefusal, isReservedName, nameSkeleton } from '@mechdost/shared/ustaad/names';
import { auditLog, roles, userRoles, users, ustaadReservedNames } from '../../schema';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { recordServerEvent } from '../events';
import type { Tx } from '../orders';

const STAFF_ROLE_KEYS = Object.entries(ROLES)
  .filter(([, r]) => 'staff' in r && r.staff)
  .map(([k]) => k);

async function reservedSkeletons(tx: Tx): Promise<Set<string>> {
  const rows = await tx
    .select({ skeleton: ustaadReservedNames.skeleton })
    .from(ustaadReservedNames)
    .where(eq(ustaadReservedNames.active, true));
  return new Set(rows.map((r) => r.skeleton));
}

/** Skeletons of staff members' own names (whole-name match only: a common first name alone is never refused). */
async function staffNameSkeletons(tx: Tx, exceptUserId: string | null): Promise<Set<string>> {
  const rows = await tx
    .selectDistinct({ userId: users.id, name: users.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(roles.key, STAFF_ROLE_KEYS), isNotNull(users.name)));
  return new Set(
    rows
      .filter((r) => r.userId !== exceptUserId && r.name !== null && r.name.trim().length >= 3)
      .map((r) => nameSkeleton(r.name ?? '')),
  );
}

/**
 * Throws `ValidationError` (`NAME_FORMAT`, `NAME_CONTACT`, `NAME_RESERVED`) for a name a member may not use. Called by
 * the join and by `PATCH /ustaad/me` for the display name and its Hindi form. `userId` = the member themselves (a
 * staff member who is also a member may use their own name).
 */
export async function assertUstaadNameAllowed(
  tx: Tx,
  displayName: string,
  opts: { userId?: string | null } = {},
): Promise<void> {
  const shape = displayNameRefusal(displayName);
  if (shape) throw new ValidationError('This name cannot be used', shape);
  if (isReservedName(displayName, await reservedSkeletons(tx)))
    throw new ValidationError('This name is reserved', 'NAME_RESERVED');
  const staff = await staffNameSkeletons(tx, opts.userId ?? null);
  if (staff.has(nameSkeleton(displayName)))
    throw new ValidationError('This name is reserved', 'NAME_RESERVED');
}

// ── Admin list (spec 15 "admin control"; `ustaad:settings`) ───────────────────────────────────────────────────

/** Every admin change: an `audit_log` row and the `admin_ustaad_table_saved` event (never the name itself). */
async function audited(
  tx: Tx,
  staffUserId: string | null,
  id: string,
  action: 'create' | 'update',
  before: unknown,
  after: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: staffUserId,
    actorRole: 'staff',
    action: `ustaad.reserved_name.${action === 'create' ? 'created' : 'updated'}`,
    entity: 'ustaad_reserved_name',
    entityId: id,
    before: before ?? null,
    after: after ?? null,
  });
  await recordServerEvent(tx, 'admin_ustaad_table_saved', {
    userId: staffUserId,
    props: { table: 'reserved_names', action },
  });
}

export interface ReservedNameView {
  id: string;
  name: string;
  active: boolean;
  version: number;
}

export async function listUstaadReservedNames(tx: Tx): Promise<ReservedNameView[]> {
  const rows = await tx
    .select({
      id: ustaadReservedNames.id,
      name: ustaadReservedNames.name,
      active: ustaadReservedNames.active,
      version: ustaadReservedNames.version,
    })
    .from(ustaadReservedNames)
    .orderBy(ustaadReservedNames.name)
    .limit(1000);
  return rows;
}

/** Add a reserved name (its skeleton is computed here; a look-alike of an existing one is a 409). */
export async function addUstaadReservedName(
  tx: Tx,
  actor: { userId: string },
  name: string,
): Promise<ReservedNameView> {
  const skeleton = nameSkeleton(name);
  if (skeleton.length < 2) throw new ValidationError('Use at least two letters', 'NAME_FORMAT');
  const [row] = await tx
    .insert(ustaadReservedNames)
    .values({ name: name.trim(), skeleton, createdBy: actor.userId })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ConflictError('This name (or a look-alike) is already reserved', 'NAME_EXISTS');
  await audited(tx, actor.userId, row.id, 'create', null, { active: true });
  return { id: row.id, name: row.name, active: row.active, version: row.version };
}

/** Switch a reserved name on or off (conditional on its version). */
export async function setUstaadReservedNameActive(
  tx: Tx,
  input: { id: string; active: boolean; expectedVersion: number; staffUserId?: string | null },
): Promise<ReservedNameView> {
  const [row] = await tx
    .update(ustaadReservedNames)
    .set({ active: input.active })
    .where(and(eq(ustaadReservedNames.id, input.id), eq(ustaadReservedNames.version, input.expectedVersion)))
    .returning();
  if (!row) {
    const [exists] = await tx
      .select({ id: ustaadReservedNames.id })
      .from(ustaadReservedNames)
      .where(eq(ustaadReservedNames.id, input.id));
    if (!exists) throw new NotFoundError('Not found');
    throw new ConflictError('This name changed meanwhile', 'STALE_RESERVED_NAME');
  }
  await audited(tx, input.staffUserId ?? null, row.id, 'update', null, { active: row.active });
  return { id: row.id, name: row.name, active: row.active, version: row.version };
}
