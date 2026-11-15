import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { isRoleKey, ROLES } from '@mechdost/shared/rbac';
import { ticketMachine } from '@mechdost/shared/state';
import { auditLog, cannedReplies, roles, supportTickets, userRoles, users } from '../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { loadGrants } from './rbac';
import { supportSla } from './support-sla';
import { ticketScopeFrom, type TicketScope } from './support';

/**
 * Inbox tools for support staff (design 2026-11-15 "Support next tier", items 4 and 5; spec 09): the support hours
 * and first-reply target (admin settings, IST), assignment, canned replies and the worker's auto-close. Every
 * mutation is a compare-and-set on `version`, audited and recorded as a server event in the same transaction.
 */
// ── assignment ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface AssigneeView {
  id: string;
  name: string | null;
}

const REPLY_ROLE_KEYS = Object.entries(ROLES)
  .filter(
    ([key, r]) => r.staff && (r.permissions as readonly string[]).includes('tickets:reply') && isRoleKey(key),
  )
  .map(([key]) => key);

/** Staff a request in `scope` may be assigned to: holders of a role with `tickets:reply`, all-city or in the scope. */
export async function listAssignableAgents(db: Tx, scope: TicketScope): Promise<AssigneeView[]> {
  const cityFilter = scope.all
    ? undefined
    : or(
        isNull(userRoles.cityId),
        scope.cityIds.length ? inArray(userRoles.cityId, [...scope.cityIds]) : undefined,
      );
  return db
    .selectDistinct({ id: users.id, name: users.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        inArray(roles.key, REPLY_ROLE_KEYS),
        isNull(userRoles.shopId),
        isNull(userRoles.workshopId),
        isNull(users.deletedAt),
        eq(users.status, 'active'),
        cityFilter,
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(200);
}

/**
 * Assign a request to a support agent (or clear it). The assignee must hold `tickets:reply` for the request's city
 * (an all-city grant covers any; a request without a city needs an all-city agent). Staff outside the request's
 * scope get "not found". Compare-and-set on `version`; audited.
 */
/**
 * Two scopes (security review 2026-11-15): `reply` decides which requests the staff member can see at all (else
 * "not found"); `assign` (from their `tickets:assign` grants) decides whether they may assign THIS request to anyone.
 * Without it they may only take an unassigned request for themselves or release one they hold (checked on the locked
 * row), never take over or clear someone else's.
 */
export interface AssignScopes {
  reply: TicketScope;
  assign: TicketScope;
}

function covers(scope: TicketScope, cityId: string | null): boolean {
  return scope.all || (cityId !== null && scope.cityIds.includes(cityId));
}

export async function assignTicket(
  db: Tx,
  scopes: AssignScopes,
  input: { staffUserId: string; code: string; assigneeId: string | null; expectedVersion: number },
): Promise<{ version: number; assignee: AssigneeView | null }> {
  const scope = scopes.reply;
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({
        id: supportTickets.id,
        cityId: supportTickets.cityId,
        status: supportTickets.status,
        assigneeId: supportTickets.assigneeId,
      })
      .from(supportTickets)
      .where(
        and(
          eq(supportTickets.code, input.code),
          scope.all
            ? undefined
            : scope.cityIds.length
              ? inArray(supportTickets.cityId, [...scope.cityIds])
              : sql`false`,
        ),
      )
      .limit(1)
      .for('update');
    if (!t) throw new NotFoundError('Request not found');
    if (t.status === 'closed') throw new ConflictError('This request is closed', 'TICKET_CLOSED');
    if (!covers(scopes.assign, t.cityId)) {
      const takes = input.assigneeId === input.staffUserId && t.assigneeId === null;
      const releases = input.assigneeId === null && t.assigneeId === input.staffUserId;
      if (!takes && !releases)
        throw new ForbiddenError(
          'You can only take a free request or release your own',
          'ASSIGN_NOT_ALLOWED',
        );
    }
    let assignee: AssigneeView | null = null;
    if (input.assigneeId) {
      const [person] = await tx
        .select({ id: users.id, name: users.name, status: users.status, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, input.assigneeId))
        .limit(1);
      const reach =
        person && !person.deletedAt && person.status === 'active'
          ? ticketScopeFrom(await loadGrants(tx, person.id), 'tickets:reply')
          : null;
      const covers = reach && (reach.all || (t.cityId !== null && reach.cityIds.includes(t.cityId)));
      if (!person || !covers) throw new ValidationError('Choose a support agent', 'ASSIGNEE_INVALID');
      assignee = { id: person.id, name: person.name };
    }
    const [row] = await tx
      .update(supportTickets)
      .set({ assigneeId: input.assigneeId, assignedAt: input.assigneeId ? new Date() : null })
      .where(and(eq(supportTickets.id, t.id), eq(supportTickets.version, input.expectedVersion)))
      .returning({ version: supportTickets.version });
    if (!row) throw new ConflictError('This request changed; reload and try again', 'STALE_TICKET');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'ticket.assigned',
      entity: 'support_ticket',
      entityId: t.id,
      before: { assigneeId: t.assigneeId },
      after: { assigneeId: input.assigneeId },
    });
    await recordServerEvent(tx, 'support_ticket_assigned', {
      userId: input.staffUserId,
      cityId: t.cityId,
      props: { assigned: input.assigneeId !== null, self: input.assigneeId === input.staffUserId },
    });
    return { version: row.version, assignee };
  });
}

// ── canned replies ──────────────────────────────────────────────────────────────────────────────────────────────

export interface CannedReplyView {
  id: string;
  key: string;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  active: boolean;
  sortOrder: number;
  version: number;
}

const cannedColumns = {
  id: cannedReplies.id,
  key: cannedReplies.key,
  titleEn: cannedReplies.titleEn,
  titleHi: cannedReplies.titleHi,
  bodyEn: cannedReplies.bodyEn,
  bodyHi: cannedReplies.bodyHi,
  active: cannedReplies.active,
  sortOrder: cannedReplies.sortOrder,
  version: cannedReplies.version,
};

export async function listCannedReplies(
  db: Tx,
  opts: { includeInactive: boolean },
): Promise<CannedReplyView[]> {
  return db
    .select(cannedColumns)
    .from(cannedReplies)
    .where(opts.includeInactive ? undefined : eq(cannedReplies.active, true))
    .orderBy(asc(cannedReplies.sortOrder), asc(cannedReplies.key))
    .limit(200);
}

export interface CannedReplyInput {
  staffUserId: string;
  /** Present when editing; `expectedVersion` is then required. */
  id?: string;
  expectedVersion?: number;
  key: string;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  active: boolean;
  sortOrder: number;
}

/** Create or edit a canned reply: both languages are required (hard rule 10); edits are compare-and-set. */
export async function saveCannedReply(db: Tx, input: CannedReplyInput): Promise<CannedReplyView> {
  const clean = {
    key: input.key.trim(),
    titleEn: input.titleEn.trim(),
    titleHi: input.titleHi.trim(),
    bodyEn: input.bodyEn.trim(),
    bodyHi: input.bodyHi.trim(),
  };
  const lengthOk =
    clean.titleEn.length > 0 &&
    clean.titleHi.length > 0 &&
    clean.titleEn.length <= 80 &&
    clean.titleHi.length <= 80 &&
    clean.bodyEn.length > 0 &&
    clean.bodyHi.length > 0 &&
    clean.bodyEn.length <= 2000 &&
    clean.bodyHi.length <= 2000;
  if (!lengthOk || !/^[a-z][a-z0-9_]{2,39}$/.test(clean.key))
    throw new ValidationError('Fill in the title and text in English and Hindi', 'CANNED_REPLY_INVALID');
  return db.transaction(async (tx) => {
    const taken = await tx
      .select({ id: cannedReplies.id })
      .from(cannedReplies)
      .where(eq(cannedReplies.key, clean.key))
      .limit(1);
    if (taken[0] && taken[0].id !== input.id)
      throw new ConflictError('That key is already used', 'CANNED_REPLY_KEY_TAKEN');
    const values = { ...clean, active: input.active, sortOrder: input.sortOrder };
    let row: CannedReplyView | undefined;
    if (input.id) {
      [row] = await tx
        .update(cannedReplies)
        .set(values)
        .where(and(eq(cannedReplies.id, input.id), eq(cannedReplies.version, input.expectedVersion ?? -1)))
        .returning(cannedColumns);
      if (!row) {
        const exists = await tx
          .select({ id: cannedReplies.id })
          .from(cannedReplies)
          .where(eq(cannedReplies.id, input.id))
          .limit(1);
        if (!exists[0]) throw new NotFoundError('Reply not found');
        throw new ConflictError('This reply changed; reload and try again', 'STALE_CANNED_REPLY');
      }
    } else {
      [row] = await tx
        .insert(cannedReplies)
        .values({ ...values, createdBy: input.staffUserId })
        .returning(cannedColumns);
    }
    if (!row) throw new Error('canned reply save returned nothing');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: input.id ? 'canned_reply.updated' : 'canned_reply.created',
      entity: 'canned_reply',
      entityId: row.id,
      after: { key: row.key, active: row.active },
    });
    await recordServerEvent(tx, 'support_canned_reply_saved', {
      userId: input.staffUserId,
      props: { created: !input.id, active: row.active },
    });
    return row;
  });
}

// ── auto-close (worker) ─────────────────────────────────────────────────────────────────────────────────────────

const AUTO_CLOSE_BATCH = 200;

/**
 * Close requests that were "resolved" at least `support.auto_close_days` ago with no customer reply (a reply moves
 * them back to review and clears `resolved_at`, so they never qualify). One conditional UPDATE per request on its
 * `version`, so a request someone touched meanwhile is skipped and picked up by the next sweep; running it twice is
 * harmless. System actor: the audit row has no user. `hooks.onCandidate` is a test seam for the race.
 */
export async function autoCloseResolvedTickets(
  db: Tx,
  now: Date,
  hooks: { beforeUpdate?: () => Promise<void> } = {},
): Promise<{ closed: number; skipped: number }> {
  const { autoCloseDays } = await supportSla(db);
  const cutoff = new Date(now.getTime() - autoCloseDays * 86_400_000);
  const due = await db
    .select({
      id: supportTickets.id,
      version: supportTickets.version,
      cityId: supportTickets.cityId,
      kind: supportTickets.kind,
    })
    .from(supportTickets)
    .where(and(eq(supportTickets.status, 'resolved'), lte(supportTickets.resolvedAt, cutoff)))
    .orderBy(asc(supportTickets.resolvedAt))
    .limit(AUTO_CLOSE_BATCH);
  let closed = 0;
  let skipped = 0;
  for (const t of due) {
    await hooks.beforeUpdate?.();
    ticketMachine.assert('resolved', 'closed', 'system');
    const ok = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(supportTickets)
        .set({ status: 'closed', closedAt: now, closeReason: 'auto' })
        .where(
          and(
            eq(supportTickets.id, t.id),
            eq(supportTickets.version, t.version),
            eq(supportTickets.status, 'resolved'),
            lte(supportTickets.resolvedAt, cutoff),
          ),
        )
        .returning({ id: supportTickets.id });
      if (!row) return false;
      await tx.insert(auditLog).values({
        actorUserId: null,
        actorRole: 'system',
        action: 'ticket.auto_closed',
        entity: 'support_ticket',
        entityId: t.id,
        before: { status: 'resolved' },
        after: { status: 'closed', days: autoCloseDays },
      });
      await recordServerEvent(tx, 'support_ticket_closed', {
        cityId: t.cityId,
        props: { reason: 'auto', kind: t.kind },
      });
      return true;
    });
    if (ok) closed += 1;
    else skipped += 1;
  }
  return { closed, skipped };
}
