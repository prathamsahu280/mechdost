import { and, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import { redactAuditJson, searchKind } from '@mechdost/shared/contact-mask';
import { istStartOfDay } from '@mechdost/shared/time';
import { auditLog, orderGroups, orders, serviceRequests, supportTickets, users } from '../schema';
import { pageSize } from './cursor';
import { ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * Audit log viewer (design 2026-11-15, spec 13), read-only. Newest first by the identity `id` (time and id agree),
 * keyset paging on `id`, every filter on an index: (entity, id), (action, id), (actor_user_id, id), (created_at),
 * and (entity, entity_id, created_at) for an entity id. The `before`/`after` JSON is redacted here, for everyone:
 * contact details are masked and address and bank fields hidden (the audited customer view is the one place that
 * shows them).
 */
export interface AuditFilters {
  entity?: string;
  entityId?: string;
  /** An order, checkout, request or ticket code; resolved to the entity id it names. */
  code?: string;
  actorUserId?: string;
  action?: string;
  /** IST calendar days, YYYY-MM-DD, both inclusive. */
  fromDay?: string;
  toDay?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AuditRow {
  id: number;
  at: Date;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
  before: unknown;
  after: unknown;
}

const TEXT_FILTER = /^[A-Za-z0-9_.:-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!TEXT_FILTER.test(value)) throw new ValidationError(`Invalid ${name}`, 'AUDIT_FILTER');
  return value;
}

/** The start of the IST day `day`; `plusDays` 1 gives the exclusive upper bound of an inclusive end day. */
function istDay(day: string, plusDays: number): Date {
  const parsed = new Date(`${day}T00:00:00Z`);
  const real = DAY.test(day) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
  if (!real) throw new ValidationError('Invalid date', 'AUDIT_DATE');
  return new Date(istStartOfDay(day).getTime() + plusDays * 86_400_000);
}

function decodeId(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    if (/^\d{1,18}$/.test(raw)) return Number(raw);
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor', 'INVALID_CURSOR');
}

async function resolveCode(db: Tx, raw: string): Promise<{ entity: string; ids: string[] }> {
  const parsed = searchKind(raw);
  if (parsed?.kind !== 'code')
    throw new ValidationError('Enter an order, request or ticket code', 'AUDIT_CODE');
  const code = parsed.value;
  const prefix = code.split('-')[0];
  if (prefix === 'SR') {
    const rows = await db
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(eq(serviceRequests.code, code));
    return { entity: 'service_request', ids: rows.map((r) => r.id) };
  }
  if (prefix === 'REQ') {
    const rows = await db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.code, code));
    return { entity: 'support_ticket', ids: rows.map((r) => r.id) };
  }
  if (/-\d{1,2}$/.test(code) && code.split('-').length === 5) {
    const rows = await db.select({ id: orders.id }).from(orders).where(eq(orders.code, code));
    return { entity: 'order', ids: rows.map((r) => r.id) };
  }
  const rows = await db.select({ id: orderGroups.id }).from(orderGroups).where(eq(orderGroups.code, code));
  return { entity: 'order_group', ids: rows.map((r) => r.id) };
}

export async function listAudit(
  db: Tx,
  f: AuditFilters,
): Promise<{ rows: AuditRow[]; nextCursor: string | null }> {
  const limit = pageSize(f.limit, 50, 100);
  const conds: (SQL | undefined)[] = [];
  const entity = text(f.entity, 'entity');
  const action = text(f.action, 'action');
  let entityId = text(f.entityId, 'entity id');
  if (f.actorUserId !== undefined && f.actorUserId !== '') {
    if (!UUID.test(f.actorUserId)) throw new ValidationError('Invalid actor', 'AUDIT_FILTER');
    conds.push(eq(auditLog.actorUserId, f.actorUserId));
  }
  if (f.code !== undefined && f.code !== '') {
    const { entity: codeEntity, ids } = await resolveCode(db, f.code);
    if (ids.length === 0) return { rows: [], nextCursor: null };
    conds.push(eq(auditLog.entity, codeEntity), inArray(auditLog.entityId, ids));
    entityId = undefined;
  }
  if (entity) conds.push(eq(auditLog.entity, entity));
  if (entityId) conds.push(eq(auditLog.entityId, entityId));
  if (action) conds.push(eq(auditLog.action, action));
  if (f.fromDay) conds.push(gte(auditLog.createdAt, istDay(f.fromDay, 0)));
  if (f.toDay) conds.push(lt(auditLog.createdAt, istDay(f.toDay, 1)));
  if (f.cursor) conds.push(lt(auditLog.id, decodeId(f.cursor)));

  const found = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      actorUserId: auditLog.actorUserId,
      actorName: users.name,
      actorRole: auditLog.actorRole,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      reason: auditLog.reason,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(...conds))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const page = found.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((r) => ({
      ...r,
      before: redactAuditJson(r.before),
      after: redactAuditJson(r.after),
    })),
    nextCursor: found.length > limit && last ? Buffer.from(String(last.id)).toString('base64url') : null,
  };
}
