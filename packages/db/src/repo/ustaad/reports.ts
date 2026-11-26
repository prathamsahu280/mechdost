/**
 * Member reports (spec 23 § 4 "Report", § 7.6, § 13; plan task F2). `POST /ustaad/reports` (20 a day, API) lands here.
 *
 * - One open report per reporter and target (partial unique index): a repeat returns the open one (idempotent).
 * - The clock comes from the reason's default in the admin table, except `ncii_impersonation` (2 h, and the item is
 *   hidden at once pending review, security review L3).
 * - "Someone under 18" (`minor`): the reported account goes into restricted mode at once only when the reporter is a
 *   verified member with an account ≥ 30 days old and no active `false_report` strike; any other minor report goes
 *   to the top of the queue without restricting anyone (false-report guard, § 13).
 * - A message is reportable only by a member of its thread (404 otherwise); nobody reports their own item.
 * - Staff of the item's city get `staff.ustaad_report` (names, codes and counts only).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { USTAAD_REPORT_OPEN } from '@mechdost/shared/state';
import type { CreateReportBody } from '@mechdost/shared/ustaad/dto/moderation';
import { clockFor, clockMs, MINOR_REPORTER_MIN_ACCOUNT_DAYS } from '@mechdost/shared/ustaad/moderation';
import { ustaadPublicCode } from '@mechdost/shared/ustaad/public-code';
import type { UstaadReportClock } from '@mechdost/shared/ustaad/codes';
import { cities, ustaadMembers, ustaadReportReasons, ustaadReports } from '../../schema';
import { NotFoundError, ValidationError } from '../errors';
import { staffRecipients } from '../notices';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { notifyUstaad } from './notify';
import { readUstaadSettingValues } from './settings';
import { hasFalseReportStrike } from './strikes';
import { loadUstaadTarget, moveUstaadTarget, type UstaadTarget } from './targets';

export interface UstaadReporter {
  userId: string;
  memberId: string;
}

const CLOCK_KEYS = [
  'ustaad.mod.clock_intimate_h',
  'ustaad.mod.clock_legal_h',
  'ustaad.mod.clock_removal_h',
  'ustaad.mod.clock_standard_h',
  'ustaad.mod.clock_grievance_days',
] as const;

/** The clock settings as numbers (registry defaults when unset). */
export async function readUstaadClockSettings(tx: Tx) {
  const s = await readUstaadSettingValues(tx, CLOCK_KEYS);
  return {
    'ustaad.mod.clock_intimate_h': Number(s['ustaad.mod.clock_intimate_h']),
    'ustaad.mod.clock_legal_h': Number(s['ustaad.mod.clock_legal_h']),
    'ustaad.mod.clock_removal_h': Number(s['ustaad.mod.clock_removal_h']),
    'ustaad.mod.clock_standard_h': Number(s['ustaad.mod.clock_standard_h']),
    'ustaad.mod.clock_grievance_days': Number(s['ustaad.mod.clock_grievance_days']),
  };
}

async function cityCodeOf(tx: Tx, cityId: string): Promise<string> {
  const [c] = await tx.select({ code: cities.code }).from(cities).where(eq(cities.id, cityId)).limit(1);
  if (!c) throw new NotFoundError('City not found');
  return c.code;
}

/**
 * Insert a report row with a fresh `UR-` code (retries on a code collision). Shared by member reports, automatic
 * holds, the classifier and staff intake. Returns null when the one-open-per-reporter index already holds one.
 */
export async function insertUstaadReport(
  tx: Tx,
  input: {
    target: UstaadTarget;
    reporterId: string | null;
    source: (typeof ustaadReports.$inferInsert)['source'];
    reasonCode: (typeof ustaadReports.$inferInsert)['reasonCode'];
    clock: UstaadReportClock;
    note?: string | null;
    now?: Date;
  },
): Promise<typeof ustaadReports.$inferSelect | null> {
  const now = input.now ?? new Date();
  const clocks = await readUstaadClockSettings(tx);
  const cityId = input.target.cityId;
  // Every reportable item belongs to a city (its own, its question's, or its author's); never a default city.
  if (!cityId) throw new NotFoundError('Not found');
  const cityCode = await cityCodeOf(tx, cityId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await tx
      .insert(ustaadReports)
      .values({
        code: ustaadPublicCode('UR', cityCode, now),
        targetType: input.target.type,
        targetId: input.target.id,
        reporterId: input.reporterId,
        cityId,
        source: input.source,
        reasonCode: input.reasonCode,
        note: input.note ?? null,
        clock: input.clock,
        dueAt: new Date(now.getTime() + clockMs(input.clock, clocks)),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0];
    // Either the open-report index (same reporter, same target) or a code collision: tell them apart.
    if (input.reporterId) {
      const [open] = await tx
        .select({ id: ustaadReports.id })
        .from(ustaadReports)
        .where(
          and(
            eq(ustaadReports.targetType, input.target.type),
            eq(ustaadReports.targetId, input.target.id),
            eq(ustaadReports.reporterId, input.reporterId),
            inArray(ustaadReports.status, [...USTAAD_REPORT_OPEN]),
          ),
        )
        .limit(1);
      if (open) return null;
    }
  }
  throw new Error('Could not create a report code');
}

/** Everyone holding `ustaad:moderate` for the city gets the staff notice (one row each, deduped by version). */
export async function notifyUstaadModerators(
  tx: Tx,
  kind: 'staff.ustaad_report' | 'staff.ustaad_report_overdue',
  report: { id: string; code: string; cityId: string | null },
  version: string,
): Promise<number> {
  let n = 0;
  for (const userId of await staffRecipients(tx, 'ustaad:moderate', report.cityId))
    if (
      await notifyUstaad(tx, kind, {
        userId,
        entityId: report.id,
        version,
        params: { reportCode: report.code },
      })
    )
      n += 1;
  return n;
}

export async function createUstaadReport(
  db: Tx,
  actor: UstaadReporter,
  body: CreateReportBody,
  now = new Date(),
): Promise<{ code: string; status: string }> {
  return db.transaction(async (tx) => {
    const [me] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, actor.memberId)).limit(1);
    if (!me || me.userId !== actor.userId) throw new NotFoundError('Not found');
    const target = await loadUstaadTarget(tx, body.targetType, body.targetId);
    if (!target) throw new NotFoundError('Not found');
    // A message is visible only to its two members: anyone else gets the same 404 as a missing id.
    if (target.type === 'message' && !target.participants?.includes(me.id))
      throw new NotFoundError('Not found');
    if (target.authorMemberId === me.id)
      throw new ValidationError('You cannot report your own post', 'USTAAD_REPORT_SELF');
    const [reason] = await tx
      .select()
      .from(ustaadReportReasons)
      .where(eq(ustaadReportReasons.code, body.reasonCode))
      .limit(1);
    if (!reason?.active) throw new ValidationError('Pick another reason', 'USTAAD_REASON_OFF');
    const clock = clockFor({
      source: 'member',
      reason: body.reasonCode,
      reasonDefault: reason.defaultClock as UstaadReportClock,
    });
    const row = await insertUstaadReport(tx, {
      target,
      reporterId: me.id,
      source: 'member',
      reasonCode: body.reasonCode,
      clock,
      note: body.note ?? null,
      now,
    });
    if (!row) {
      const [open] = await tx
        .select({ code: ustaadReports.code, status: ustaadReports.status })
        .from(ustaadReports)
        .where(
          and(
            eq(ustaadReports.targetType, target.type),
            eq(ustaadReports.targetId, target.id),
            eq(ustaadReports.reporterId, me.id),
            inArray(ustaadReports.status, [...USTAAD_REPORT_OPEN]),
          ),
        )
        .limit(1);
      if (!open) throw new Error('open report vanished');
      return open;
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'report',
        entityId: row.id,
        kind: 'reported',
        toStatus: 'open',
        reasonCode: body.reasonCode,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: row.cityId,
        props: { target: target.type, clock },
      },
      {
        name: 'ustaad_report_created',
        memberId: me.id,
        userId: actor.userId,
        props: { reportCode: row.code, reason: body.reasonCode, target: target.type },
      },
    );

    // L3: an intimate-image or impersonation complaint hides the item at once, pending review.
    if (body.reasonCode === 'ncii_impersonation' && target.status === 'visible' && target.type !== 'member') {
      if (['post', 'story', 'comment', 'answer'].includes(target.type)) {
        await moveUstaadTarget(tx, target, 'held');
        await recordUstaadEvent(tx, {
          entityType: target.type === 'story' ? 'post' : (target.type as 'post' | 'comment' | 'answer'),
          entityId: target.id,
          kind: 'held',
          fromStatus: 'visible',
          toStatus: 'held',
          reasonCode: 'ncii_impersonation',
          actorId: null,
          actorRole: 'system',
          cityId: row.cityId,
        });
      }
    }

    if (body.reasonCode === 'minor') await maybeRestrictForMinorReport(tx, me, target, row.cityId, now);
    await notifyUstaadModerators(tx, 'staff.ustaad_report', row, 'new');
    return { code: row.code, status: row.status };
  });
}

/** Restricted mode for the reported account, only from a qualified reporter (§ 13 false-report guard). */
async function maybeRestrictForMinorReport(
  tx: Tx,
  reporter: typeof ustaadMembers.$inferSelect,
  target: UstaadTarget,
  cityId: string | null,
  now: Date,
): Promise<void> {
  const ageDays = (now.getTime() - reporter.joinedAt.getTime()) / 86_400_000;
  const qualified =
    reporter.verificationState === 'verified' &&
    ageDays >= MINOR_REPORTER_MIN_ACCOUNT_DAYS &&
    !(await hasFalseReportStrike(tx, reporter.id));
  if (!qualified) return;
  const rows = await tx
    .update(ustaadMembers)
    .set({ restrictedMode: 'minor_report' })
    .where(and(eq(ustaadMembers.id, target.authorMemberId), eq(ustaadMembers.restrictedMode, 'none')))
    .returning({ id: ustaadMembers.id });
  if (rows.length === 0) return;
  // Analytics first (the member is now restricted, so later events about them are suppressed by design).
  await recordUstaadEvent(
    tx,
    {
      entityType: 'member',
      entityId: target.authorMemberId,
      kind: 'restricted_mode',
      fromStatus: 'none',
      toStatus: 'minor_report',
      reasonCode: 'minor',
      actorId: null,
      actorRole: 'system',
      cityId,
    },
    {
      name: 'ustaad_restricted_mode',
      memberId: null,
      userId: null,
      props: { memberId: target.authorMemberId, reason: 'minor_report' },
    },
  );
}
