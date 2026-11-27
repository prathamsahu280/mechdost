/**
 * The member's own standing and appeals (QA 2026-11-27, SIM-P19 / SIM-P24 / SIM-P27; spec 23 § 13 "the author is told
 * why … with the appeal route"). Readable by a banned or restricted member (the API lets them through for these two
 * routes only): what was decided on their account and content, the reason code, what is limited and until when, and
 * whether an appeal can be filed. Never the reporter, the staff member or a staff note.
 *
 * An appeal is a support ticket of kind `ustaad_appeal` (the existing support machinery: daily limit, first-reply
 * clock, staff bell, email) linked to the report, which moves `actioned → appealed` with a conditional UPDATE on
 * (id, status, version); staff decide it in Admin → Ustaad → Appeals as before (four-eyes).
 */
import { and, eq, sql } from 'drizzle-orm';
import { ustaadReportMachine, type UstaadReportStatus } from '@mechdost/shared/state';
import { cities, supportTickets, ustaadMembers, ustaadReports } from '../../schema';
import { ConflictError, NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { createSupportTicket } from '../support';
import { recordUstaadEvent } from './events';

export type UstaadStandingAction = 'remove' | 'takedown' | 'warn' | 'restrict' | 'ban';
export type UstaadAppealState = 'can' | 'pending' | 'upheld' | 'overturned';

export interface UstaadStandingItem {
  reportCode: string;
  action: UstaadStandingAction;
  /** A report reason code (`spam`, `job_scam` …); the screen shows its plain label. */
  reasonCode: string;
  days: number | null;
  at: string;
  /** When a restriction or ban from this decision ends; null for removals, warnings and permanent bans. */
  endsAt: string | null;
  appeal: UstaadAppealState;
}

export interface UstaadStandingView {
  status: 'active' | 'restricted' | 'banned';
  restrictedUntil: string | null;
  bannedUntil: string | null;
  /** `none`, or `minor_report` / `review`: limited while staff check, with no end date. */
  restrictedMode: string;
  items: UstaadStandingItem[];
}

const SHOWN_ACTIONS = ['remove', 'takedown', 'warn', 'restrict', 'ban'] as const;
const APPEAL_OF: Partial<Record<string, UstaadAppealState>> = {
  actioned: 'can',
  appealed: 'pending',
  upheld: 'upheld',
  overturned: 'overturned',
};
const ITEMS_MAX = 50;

/** SQL: the report's target is this member or something they wrote (each branch uses the author index). */
const aboutMember = (memberId: string) => sql`(
  (r.target_type = 'member' and r.target_id = ${memberId}::uuid)
  or (r.target_type in ('post', 'story') and r.target_id in (select id from ustaad_posts where author_id = ${memberId}::uuid))
  or (r.target_type = 'comment' and r.target_id in (select id from ustaad_comments where author_id = ${memberId}::uuid))
  or (r.target_type = 'question' and r.target_id in (select id from ustaad_questions where asker_id = ${memberId}::uuid))
  or (r.target_type = 'answer' and r.target_id in (select id from ustaad_answers where author_id = ${memberId}::uuid))
  or (r.target_type = 'job' and r.target_id in (select id from ustaad_jobs where employer_member_id = ${memberId}::uuid))
  or (r.target_type = 'message' and r.target_id in (select id from ustaad_messages where sender_id = ${memberId}::uuid)))`;

async function memberOfUser(tx: Tx, userId: string) {
  const [m] = await tx
    .select({
      id: ustaadMembers.id,
      status: ustaadMembers.status,
      restrictedUntil: ustaadMembers.restrictedUntil,
      bannedUntil: ustaadMembers.bannedUntil,
      restrictedMode: ustaadMembers.restrictedMode,
      cityId: ustaadMembers.cityId,
      cityCode: cities.code,
    })
    .from(ustaadMembers)
    .innerJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(eq(ustaadMembers.userId, userId))
    .limit(1);
  if (!m || m.status === 'left') throw new NotFoundError('Not a member');
  return m;
}

/** The member's standing: their status and the last 50 decisions on them or their content, newest first. */
export async function ustaadMyStanding(db: Tx, actor: { userId: string }): Promise<UstaadStandingView> {
  const m = await memberOfUser(db, actor.userId);
  const rows = rowsOf<{
    code: string;
    status: string;
    action: string;
    reason_code: string;
    days: number | string | null;
    created_at: string | Date;
  }>(
    await db.execute(sql`
      select r.code, r.status, a.action, a.reason_code, a.days, a.created_at
      from ustaad_moderation_actions a
      join ustaad_reports r on r.id = a.report_id
      where a.action in ('remove', 'takedown', 'warn', 'restrict', 'ban') and ${aboutMember(m.id)}
      order by a.created_at desc, a.id desc
      limit ${ITEMS_MAX}`),
  );
  const seen = new Set<string>();
  const items: UstaadStandingItem[] = [];
  for (const r of rows) {
    // One line per decision (a report can carry more than one action row); the newest one speaks for it.
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    const at = new Date(r.created_at);
    const days = r.days === null ? null : Number(r.days);
    const timed = (r.action === 'restrict' || r.action === 'ban') && days !== null;
    items.push({
      reportCode: r.code,
      action: SHOWN_ACTIONS.find((x) => x === r.action) ?? 'warn',
      reasonCode: r.reason_code,
      days,
      at: at.toISOString(),
      endsAt: timed ? new Date(at.getTime() + days * 86_400_000).toISOString() : null,
      appeal: APPEAL_OF[r.status] ?? 'upheld',
    });
  }
  const status = m.status === 'banned' || m.status === 'restricted' ? m.status : 'active';
  return {
    status,
    restrictedUntil: m.restrictedUntil?.toISOString() ?? null,
    bannedUntil: m.bannedUntil?.toISOString() ?? null,
    restrictedMode: m.restrictedMode,
    items,
  };
}

/**
 * The member files the appeal themselves (SIM-P24): one support ticket of kind `ustaad_appeal` with their note,
 * linked to the report, which moves to `appealed`. Someone else's report (or an unknown code) is 404; a report already
 * appealed or decided is 409 `USTAAD_APPEAL_CLOSED`.
 */
export async function fileUstaadAppeal(
  db: Tx,
  actor: { userId: string },
  input: { reportCode: string; note: string },
): Promise<{ ticketCode: string; reportCode: string }> {
  return db.transaction(async (tx) => {
    const m = await memberOfUser(tx, actor.userId);
    const [r] = await tx
      .select()
      .from(ustaadReports)
      .where(eq(ustaadReports.code, input.reportCode))
      .limit(1);
    if (!r) throw new NotFoundError('Not found');
    const mine = rowsOf<{ ok: unknown }>(
      await tx.execute(
        sql`select 1 as ok from ustaad_reports r where r.id = ${r.id}::uuid and ${aboutMember(m.id)}`,
      ),
    );
    if (mine.length === 0) throw new NotFoundError('Not found');
    if (r.status !== 'actioned')
      throw new ConflictError('This decision is already appealed or decided', 'USTAAD_APPEAL_CLOSED');
    const ticket = await createSupportTicket(tx, {
      userId: actor.userId,
      kind: 'ustaad_appeal',
      orderCode: null,
      body: `${r.code}\n${input.note}`,
      defaultCityCode: m.cityCode,
    });
    const [t] = await tx
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(eq(supportTickets.code, ticket.code))
      .limit(1);
    if (!t) throw new Error('appeal ticket not found after insert');
    const from = r.status as UstaadReportStatus;
    ustaadReportMachine.assert(from, 'appealed', 'member');
    const moved = await tx
      .update(ustaadReports)
      .set({ status: 'appealed', appealTicketId: t.id })
      .where(
        and(eq(ustaadReports.id, r.id), eq(ustaadReports.status, from), eq(ustaadReports.version, r.version)),
      )
      .returning({ id: ustaadReports.id });
    if (moved.length === 0) throw new ConflictError('This decision changed meanwhile', 'STALE_REPORT');
    await recordUstaadEvent(
      tx,
      {
        entityType: 'report',
        entityId: r.id,
        kind: 'appealed',
        fromStatus: from,
        toStatus: 'appealed',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: r.cityId,
      },
      { name: 'ustaad_appeal_filed', memberId: m.id, userId: actor.userId, props: { reportId: r.id } },
    );
    return { ticketCode: ticket.code, reportCode: r.code };
  });
}
