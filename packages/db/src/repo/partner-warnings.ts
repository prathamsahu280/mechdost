import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  PARTNER_WARNING_REASONS,
  WARNING_PARTNER_KINDS,
  type AdminPartnerWarningsDto,
  type PartnerWarningReason,
  type PartnerWarningsViewDto,
  type WarningPartnerKind,
} from '@mechdost/shared/partner-warnings';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { auditLog, partnerWarnings, settings, shops, workshops } from '../schema';
import { ConflictError, mapPgError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { rowsOf } from './sql-rows';

/**
 * Warnings against a shop or workshop (spec 08, design 2026-11-15). Staff issue one with a reason code (a note is
 * required for "other"); it is an append-only row, withdrawing appends another. The number of live warnings inside the
 * rolling window (global settings, default 3 in 30 days; 24-hour days back from now, UTC) only sets `suggestPause`
 * for staff: nothing is paused automatically — pausing is the existing standing flow (`setShopStanding`). The
 * partner reads its own warnings (code, note, date, how many count) and never the threshold. Permission
 * `partners:approve` is checked in the API; `scope` (the caller's cities) makes a partner elsewhere a 404.
 */

async function globalInt(db: Tx, key: 'partners.warning_threshold' | 'partners.warning_window_days') {
  const spec = OPERATIONAL_SETTINGS[key];
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max ? v : spec.default;
}

async function partnerOf(
  db: Tx,
  kind: WarningPartnerKind,
  id: string,
): Promise<{ cityId: string; status: string } | null> {
  const table = kind === 'shop' ? shops : workshops;
  const [row] = await db
    .select({ cityId: table.cityId, status: table.status })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return row ?? null;
}

function checkKind(kind: WarningPartnerKind) {
  if (!WARNING_PARTNER_KINDS.includes(kind))
    throw new ValidationError('Unknown partner kind', 'WARNING_KIND');
}

async function scopedPartner(db: Tx, kind: WarningPartnerKind, id: string, scope: CityScope | null) {
  checkKind(kind);
  const p = await partnerOf(db, kind, id);
  if (!p || (scope && !scope.all && !scope.cityIds.includes(p.cityId)))
    throw new NotFoundError('Partner not found');
  return p;
}

const WARNING_LIST_CAP = 50;

async function viewOf(db: Tx, kind: WarningPartnerKind, id: string, windowDays: number) {
  const col = sql.raw(kind === 'shop' ? 'shop_id' : 'workshop_id');
  const rows = rowsOf<{
    id: string;
    reason_code: PartnerWarningReason;
    note: string | null;
    created_at: string | Date;
    withdrawn: boolean;
  }>(
    await db.execute(sql`
      select w.id, w.reason_code, w.note, w.created_at,
        exists (select 1 from partner_warnings x where x.withdraws_id = w.id) as withdrawn
      from partner_warnings w
      where w.event = 'issued' and w.${col} = ${id}
        and w.created_at > now() - make_interval(days => ${windowDays})
      order by w.created_at desc, w.id desc
      limit ${WARNING_LIST_CAP}`),
  );
  return {
    windowDays,
    counting: rows.filter((r) => !r.withdrawn).length,
    warnings: rows.map((r) => ({
      id: r.id,
      reasonCode: r.reason_code,
      note: r.note,
      createdAt: new Date(r.created_at).toISOString(),
      withdrawn: r.withdrawn,
    })),
  } satisfies PartnerWarningsViewDto;
}

async function adminView(db: Tx, kind: WarningPartnerKind, id: string, status: string) {
  const [threshold, windowDays] = await Promise.all([
    globalInt(db, 'partners.warning_threshold'),
    globalInt(db, 'partners.warning_window_days'),
  ]);
  const base = await viewOf(db, kind, id, windowDays);
  return {
    ...base,
    threshold,
    // A prompt for staff only, and only while the partner can still be paused.
    suggestPause: status === 'approved' && base.counting >= threshold,
  } satisfies AdminPartnerWarningsDto;
}

/** Admin → a partner's page: warnings in the window, the count and the pause prompt. */
export async function listPartnerWarningsForAdmin(
  db: Tx,
  scope: CityScope,
  kind: WarningPartnerKind,
  partnerId: string,
): Promise<AdminPartnerWarningsDto> {
  const p = await scopedPartner(db, kind, partnerId, scope);
  return adminView(db, kind, partnerId, p.status);
}

/** The partner's own portal: `partnerIds` are the partners in the caller's grants (another's id is a 404). */
export async function listPartnerWarningsForPartner(
  db: Tx,
  partnerIds: readonly string[],
  kind: WarningPartnerKind,
  partnerId: string,
): Promise<PartnerWarningsViewDto> {
  checkKind(kind);
  if (!partnerIds.includes(partnerId)) throw new NotFoundError('Partner not found');
  if (!(await partnerOf(db, kind, partnerId))) throw new NotFoundError('Partner not found');
  return viewOf(db, kind, partnerId, await globalInt(db, 'partners.warning_window_days'));
}

export async function issuePartnerWarning(
  db: Tx,
  input: {
    kind: WarningPartnerKind;
    partnerId: string;
    scope: CityScope;
    reasonCode: PartnerWarningReason;
    note?: string | null;
    staffUserId: string;
  },
): Promise<{ id: string; warnings: AdminPartnerWarningsDto }> {
  if (!(PARTNER_WARNING_REASONS as readonly string[]).includes(input.reasonCode))
    throw new ValidationError('Choose a reason', 'WARNING_REASON');
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note !== null && (note.length < 5 || note.length > 300))
    throw new ValidationError('The note is 5 to 300 characters', 'WARNING_NOTE');
  if (input.reasonCode === 'other' && note === null)
    throw new ValidationError('Say what happened', 'WARNING_NOTE');
  return db.transaction(async (tx) => {
    const p = await scopedPartner(tx, input.kind, input.partnerId, input.scope);
    try {
      const [row] = await tx
        .insert(partnerWarnings)
        .values({
          partnerKind: input.kind,
          shopId: input.kind === 'shop' ? input.partnerId : null,
          workshopId: input.kind === 'workshop' ? input.partnerId : null,
          reasonCode: input.reasonCode,
          note,
          createdBy: input.staffUserId,
        })
        .returning({ id: partnerWarnings.id });
      if (!row) throw new Error('warning insert returned no row');
      const warnings = await adminView(tx, input.kind, input.partnerId, p.status);
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'partner.warning_issued',
        entity: input.kind,
        entityId: input.partnerId,
        after: { warningId: row.id, reasonCode: input.reasonCode },
        reason: input.reasonCode,
      });
      await recordServerEvent(tx, 'admin_partner_warning_issued', {
        userId: input.staffUserId,
        cityId: p.cityId,
        props: {
          partnerKind: input.kind,
          partnerId: input.partnerId,
          warningId: row.id,
          reasonCode: input.reasonCode,
          counting: warnings.counting,
          suggestPause: warnings.suggestPause,
        },
      });
      return { id: row.id, warnings };
    } catch (err) {
      mapPgError(err);
    }
  });
}

/** Revoke a warning given by mistake: a new `withdrawn` row; the original stays in the history. */
export async function withdrawPartnerWarning(
  db: Tx,
  input: {
    kind: WarningPartnerKind;
    partnerId: string;
    warningId: string;
    scope: CityScope;
    note: string;
    staffUserId: string;
  },
): Promise<AdminPartnerWarningsDto> {
  const note = input.note.trim();
  if (note.length < 5 || note.length > 300)
    throw new ValidationError('Say why, in 5 to 300 characters', 'WARNING_NOTE');
  return db.transaction(async (tx) => {
    const p = await scopedPartner(tx, input.kind, input.partnerId, input.scope);
    const [w] = await tx
      .select({ id: partnerWarnings.id, reasonCode: partnerWarnings.reasonCode })
      .from(partnerWarnings)
      .where(
        and(
          eq(partnerWarnings.id, input.warningId),
          eq(partnerWarnings.event, 'issued'),
          eq(input.kind === 'shop' ? partnerWarnings.shopId : partnerWarnings.workshopId, input.partnerId),
        ),
      )
      .for('update');
    if (!w) throw new NotFoundError('Warning not found');
    const [done] = await tx
      .select({ id: partnerWarnings.id })
      .from(partnerWarnings)
      .where(eq(partnerWarnings.withdrawsId, w.id))
      .limit(1);
    if (done) throw new ConflictError('This warning was already withdrawn', 'WARNING_WITHDRAWN');
    try {
      await tx.insert(partnerWarnings).values({
        event: 'withdrawn',
        partnerKind: input.kind,
        shopId: input.kind === 'shop' ? input.partnerId : null,
        workshopId: input.kind === 'workshop' ? input.partnerId : null,
        reasonCode: w.reasonCode,
        note,
        withdrawsId: w.id,
        createdBy: input.staffUserId,
      });
    } catch (err) {
      mapPgError(err);
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'partner.warning_withdrawn',
      entity: input.kind,
      entityId: input.partnerId,
      after: { warningId: w.id },
      reason: note,
    });
    await recordServerEvent(tx, 'admin_partner_warning_withdrawn', {
      userId: input.staffUserId,
      cityId: p.cityId,
      props: { partnerKind: input.kind, partnerId: input.partnerId, warningId: w.id },
    });
    return adminView(tx, input.kind, input.partnerId, p.status);
  });
}
