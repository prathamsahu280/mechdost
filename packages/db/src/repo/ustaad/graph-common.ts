/**
 * Shared reads for the D2 graph, messages, Discover and promotions repositories (spec 23 § 6.2, SR-34, SR-35): the
 * acting member, the other member as the actor may see them (blocked either way = 404, never 403), member cards with
 * no phone, garage or location, and the per-member daily counters with an admin cap.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { MemberCard } from '@mechdost/shared/ustaad/dto/social';
import type { USTAAD_DAILY_COUNTER_KINDS } from '@mechdost/shared/ustaad/codes';
import { ustaadBlocks, ustaadMembers } from '../../schema';
import { rowsOf } from '../sql-rows';
import { NotFoundError } from '../errors';
import type { Tx } from '../orders';

export type UstaadMemberRow = typeof ustaadMembers.$inferSelect;

/** The acting member's row (404 when they left or are banned; the API guard read it moments ago). */
export async function ustaadActingMember(tx: Tx, memberId: string): Promise<UstaadMemberRow> {
  const [row] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, memberId)).limit(1);
  if (!row || row.status === 'left' || row.status === 'banned') throw new NotFoundError('Member not found');
  return row;
}

/** True when either member blocked the other (SR-35). */
export async function ustaadBlockedEitherWay(tx: Tx, a: string, b: string): Promise<boolean> {
  const [row] = await tx
    .select({ x: sql`1` })
    .from(ustaadBlocks)
    .where(
      or(
        and(eq(ustaadBlocks.memberId, a), eq(ustaadBlocks.targetId, b)),
        and(eq(ustaadBlocks.memberId, b), eq(ustaadBlocks.targetId, a)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Another member as `viewerId` may see them: 404 when missing, left, banned or blocked either way. */
export async function ustaadVisibleMember(
  tx: Tx,
  viewerId: string,
  targetId: string,
): Promise<UstaadMemberRow> {
  const [row] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, targetId)).limit(1);
  if (!row || row.status === 'left' || row.status === 'banned') throw new NotFoundError('Member not found');
  if (await ustaadBlockedEitherWay(tx, viewerId, targetId)) throw new NotFoundError('Member not found');
  return row;
}

/** SQL: nobody blocked between `viewer` and the member id expression (SR-35). */
export const ustaadNotBlockedSql = (viewer: string, other: ReturnType<typeof sql>) =>
  sql`not exists (select 1 from ustaad_blocks bl where (bl.member_id = ${other} and bl.target_id = ${viewer})
      or (bl.member_id = ${viewer} and bl.target_id = ${other}))`;

const PRE_VERIFIED = ['apprentice', 'ustaad_pending'];

export function ustaadMemberCard(m: UstaadMemberRow): MemberCard {
  return {
    id: m.id,
    handle: m.handle,
    displayName: m.displayName,
    displayNameHi: m.displayNameHi,
    track: m.track as MemberCard['track'],
    level: m.level as MemberCard['level'],
    verified: m.verificationState === 'verified' && !PRE_VERIFIED.includes(m.level),
    official: m.official,
    areaLabel: m.areaLabel,
    areaLabelHi: m.areaLabelHi,
    photoMediaId: m.photoMediaId,
  };
}

/** Cards for many members in one read (unknown ids are absent from the map). */
export async function ustaadMemberCards(tx: Tx, ids: readonly string[]): Promise<Map<string, MemberCard>> {
  const out = new Map<string, MemberCard>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select()
    .from(ustaadMembers)
    .where(inArray(ustaadMembers.id, [...new Set(ids)]));
  for (const r of rows) out.set(r.id, ustaadMemberCard(r));
  return out;
}

/** The IST calendar day (business days are IST, CLAUDE.md conventions). */
export const IST_TODAY = sql`(now() at time zone 'Asia/Kolkata')::date`;

/**
 * Adds `by` to the member's counter for today (IST) when it is still under `cap`: one conditional upsert, never
 * count-then-insert, so parallel calls cannot pass the cap. Returns false when the cap was already reached.
 */
export async function bumpUstaadDailyCounter(
  tx: Tx,
  memberId: string,
  kind: (typeof USTAAD_DAILY_COUNTER_KINDS)[number],
  by: number,
  cap: number,
): Promise<boolean> {
  if (cap <= 0 || by <= 0) return cap > 0;
  const res = await tx.execute(sql`
    insert into ustaad_daily_counters as c (member_id, kind, day, n)
    values (${memberId}::uuid, ${kind}, ${IST_TODAY}, ${by})
    on conflict (member_id, kind, day) do update set n = c.n + excluded.n where c.n < ${cap}
    returning c.n`);
  return rowsOf(res).length > 0;
}

/** Today's (IST) count without changing it. */
export async function ustaadDailyCount(
  tx: Tx,
  memberId: string,
  kind: (typeof USTAAD_DAILY_COUNTER_KINDS)[number],
): Promise<number> {
  const res = await tx.execute(sql`select n from ustaad_daily_counters
    where member_id = ${memberId}::uuid and kind = ${kind} and day = ${IST_TODAY}`);
  const n = rowsOf<{ n: unknown }>(res)[0]?.n;
  return n === undefined ? 0 : Number(n);
}

/** Keyset cursor `<iso time>_<uuid>` as URL-safe base64. */
export function encodeUstaadCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

export function decodeUstaadCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const [iso, id] = raw.split('|');
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at, id };
}
