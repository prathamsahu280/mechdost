/**
 * Ustaad identity jobs (spec 23 § 6.9, § 8 "Worker jobs", § 9.2–9.3, SR-9; plan task B5), run by the API worker:
 *
 * - `reconcileUstaadCounters` (nightly `ustaad_counter_reconcile`): one `UPDATE … FROM (aggregate)` recomputes the
 *   lifetime counters from their source rows, fixes drift and records it (`counter_drift` event + analytics). No
 *   read-then-write: the aggregate and the update are one statement. `posts` is left to workstream D (its writer).
 * - `refreshUstaadCounters30d` (nightly `ustaad_counters_30d`): best answers chosen and helpful votes received in the
 *   last 30 days (rolling; a change here is the window moving, not drift).
 * - `refreshUstaadQualifiedFollowers`: stores the qualified-follower count (SR-9) and recomputes the level of members
 *   whose count changed. Which members to refresh comes from a `UstaadFollowChangeSource` (follow events) or, nightly,
 *   every active member. Workstream D2 (follows) is not on main yet: `ustaadEventFollowSource` reads the contract
 *   below from `ustaad_events`, and tests use a double.
 * - `awardUstaadBadges`: typed badge rules (§ 9.3) over facts counted in SQL; one award per member and badge, never
 *   again after staff revoked it; event, analytics and notice only for a row actually inserted.
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { badgesToAward, type BadgeFacts } from '@mechdost/shared/ustaad/badges';
import {
  ustaadAnswers,
  ustaadBadgeAwards,
  ustaadBadges,
  ustaadEvents,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadPosts,
  ustaadQuestions,
} from '../../schema';
import type { Tx } from '../orders';
import { recordServerEvent } from '../events';
import { rowsOf, num } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { recomputeUstaadLevel, ustaadQualifiedFollowerCount } from './levels';
import { notifyUstaad } from './notify';

const DAY_MS = 86_400_000;

// ── Counter reconcile ─────────────────────────────────────────────────────────────────────────────────────────

/** Recompute lifetime counters from source rows; returns the members whose counters had drifted. */
export async function reconcileUstaadCounters(tx: Tx): Promise<{ drifted: number }> {
  const result = await tx.execute(sql`
    with src as (
      select m.id as member_id,
        (select count(*) from ustaad_follows f where f.followee_id = m.id)::int as followers,
        (select count(*) from ustaad_follows f where f.follower_id = m.id)::int as following,
        (select count(*) from ustaad_answers a where a.author_id = m.id)::int as answers,
        (select count(*) from ustaad_questions q join ustaad_answers a on a.id = q.best_answer_id
           where a.author_id = m.id)::int as best_answers,
        (select count(*) from ustaad_answer_votes v join ustaad_answers a on a.id = v.answer_id
           where a.author_id = m.id)::int as helpful_votes,
        (select count(*) from ustaad_answers a where a.author_id = m.id
           and exists (select 1 from ustaad_answer_votes v where v.answer_id = a.id))::int as helpful_answers,
        (select count(*) from ustaad_learning_progress p where p.member_id = m.id
           and p.completed_at is not null)::int as videos_watched,
        (select count(*) from ustaad_vouches v join ustaad_members g on g.id = v.voucher_id
           where v.vouchee_id = m.id and v.status = 'given'
           and g.level in ('pakka','bada','master'))::int as recommendations,
        (select coalesce(sum(l.delta), 0) from ustaad_izzat_ledger l where l.member_id = m.id)::int as izzat
      from ustaad_members m
    )
    update ustaad_member_counters c set
      followers = src.followers, following = src.following, answers = src.answers,
      best_answers = src.best_answers, helpful_votes = src.helpful_votes, helpful_answers = src.helpful_answers,
      videos_watched = src.videos_watched, recommendations = src.recommendations, izzat = src.izzat
    from src
    where c.member_id = src.member_id
      and (c.followers, c.following, c.answers, c.best_answers, c.helpful_votes, c.helpful_answers,
           c.videos_watched, c.recommendations, c.izzat)
        is distinct from
          (src.followers, src.following, src.answers, src.best_answers, src.helpful_votes, src.helpful_answers,
           src.videos_watched, src.recommendations, src.izzat)
    returning c.member_id
  `);
  const ids = rowsOf<{ member_id: string }>(result).map((r) => r.member_id);
  if (ids.length > 0) {
    for (const id of ids)
      await recordUstaadEvent(tx, {
        entityType: 'member',
        entityId: id,
        kind: 'counter_drift',
        actorId: null,
        actorRole: 'system',
      });
    await recordServerEvent(tx, 'ustaad_counter_drift', { props: { members: ids.length } });
  }
  return { drifted: ids.length };
}

/** Rolling 30-day counters (best answers chosen, helpful votes received); returns rows changed. */
export async function refreshUstaadCounters30d(tx: Tx, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const result = await tx.execute(sql`
    with best as (
      select a.author_id as member_id, count(*)::int as n
      from ustaad_events e
      join ustaad_questions q on q.id = e.entity_id
      join ustaad_answers a on a.id = q.best_answer_id
      where e.entity_type = 'question' and e.kind = 'best_chosen' and e.occurred_at >= ${since}::timestamptz
      group by a.author_id
    ), helpful as (
      select a.author_id as member_id, count(*)::int as n
      from ustaad_answer_votes v join ustaad_answers a on a.id = v.answer_id
      where v.created_at >= ${since}::timestamptz
      group by a.author_id
    )
    update ustaad_member_counters c set
      best_answers30d = coalesce(best.n, 0), helpful30d = coalesce(helpful.n, 0)
    from ustaad_member_counters c2
      left join best on best.member_id = c2.member_id
      left join helpful on helpful.member_id = c2.member_id
    where c.member_id = c2.member_id
      and (c.best_answers30d, c.helpful30d) is distinct from (coalesce(best.n, 0), coalesce(helpful.n, 0))
    returning c.member_id
  `);
  return rowsOf<{ member_id: string }>(result).length;
}

// ── Qualified followers (SR-9) ────────────────────────────────────────────────────────────────────────────────

/**
 * Where the job learns whose followers changed. Contract for workstream D2: every follow and unfollow writes an
 * `ustaad_events` row with `entity_type = 'member'`, `entity_id` = the **followee**, `kind` = `followed` or
 * `unfollowed` (the follower in `actor_id`/props). The cursor is the last `occurred_at` read.
 */
export interface UstaadFollowChangeSource {
  changedFollowees(
    tx: Tx,
    since: Date | null,
    limit: number,
  ): Promise<{ memberIds: string[]; until: Date | null }>;
}

export const ustaadEventFollowSource: UstaadFollowChangeSource = {
  async changedFollowees(tx, since, limit) {
    const rows = await tx
      .select({ memberId: ustaadEvents.entityId, at: ustaadEvents.occurredAt })
      .from(ustaadEvents)
      .where(
        and(
          eq(ustaadEvents.entityType, 'member'),
          inArray(ustaadEvents.kind, ['followed', 'unfollowed']),
          since ? gt(ustaadEvents.occurredAt, since) : undefined,
        ),
      )
      .orderBy(asc(ustaadEvents.occurredAt))
      .limit(limit);
    const last = rows.at(-1);
    return { memberIds: [...new Set(rows.map((r) => r.memberId))], until: last ? last.at : since };
  },
};

/**
 * Store the qualified-follower count for the given members and recompute the level of those whose count changed.
 * Returns how many counts changed. Safe to repeat.
 */
export async function refreshUstaadQualifiedFollowers(
  tx: Tx,
  memberIds: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  let changed = 0;
  for (const memberId of memberIds) {
    const n = await ustaadQualifiedFollowerCount(tx, memberId, now);
    const rows = await tx
      .update(ustaadMemberCounters)
      .set({ qualifiedFollowers: n })
      .where(
        and(
          eq(ustaadMemberCounters.memberId, memberId),
          sql`${ustaadMemberCounters.qualifiedFollowers} <> ${n}`,
        ),
      )
      .returning({ id: ustaadMemberCounters.memberId });
    if (rows.length > 0) {
      changed += 1;
      await recomputeUstaadLevel(tx, memberId);
    }
  }
  return changed;
}

// ── Badges (§ 9.3) ────────────────────────────────────────────────────────────────────────────────────────────

async function badgeFacts(tx: Tx, memberId: string, founding: boolean, now: Date): Promise<BadgeFacts> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const [posts] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadPosts)
    .where(and(eq(ustaadPosts.authorId, memberId), eq(ustaadPosts.status, 'visible')));
  const [questions] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadQuestions)
    .where(eq(ustaadQuestions.askerId, memberId));
  const [answers] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadAnswers)
    .where(and(eq(ustaadAnswers.authorId, memberId), eq(ustaadAnswers.status, 'visible')));
  // A "tag" of a best answer is its question's work or vehicle code (battery, electrical, two_wheeler…).
  const byTag = rowsOf<{ tag: string; n: unknown }>(
    await tx.execute(sql`
      select t.tag, count(*) as n from ustaad_questions q
      join ustaad_answers a on a.id = q.best_answer_id and a.author_id = ${memberId} and a.status = 'visible'
      cross join lateral (values (q.work_code), (q.segment_code)) as t(tag)
      where t.tag is not null
      group by t.tag
    `),
  );
  const bySegment = rowsOf<{ segment: string; n: unknown }>(
    await tx.execute(sql`
      select q.segment_code as segment, count(*) as n from ustaad_answers a
      join ustaad_questions q on q.id = a.question_id
      where a.author_id = ${memberId} and a.status = 'visible' and a.helpful_count > 0
        and q.segment_code is not null
      group by q.segment_code
    `),
  );
  const [apprentice] = rowsOf<{ n: unknown }>(
    await tx.execute(sql`
      select count(*) as n from ustaad_answers a
      join ustaad_questions q on q.id = a.question_id
      join ustaad_members asker on asker.id = q.asker_id
      where a.author_id = ${memberId} and a.status = 'visible' and asker.track = 'apprentice'
        and a.created_at >= ${weekAgo}::timestamptz
    `),
  );
  return {
    posts: posts?.n ?? 0,
    questions: questions?.n ?? 0,
    answers: answers?.n ?? 0,
    founding,
    bestAnswersByTag: Object.fromEntries(byTag.map((r) => [r.tag, num(r.n)])),
    helpfulBySegment: Object.fromEntries(bySegment.map((r) => [r.segment, num(r.n)])),
    apprenticeAnswersThisWeek: apprentice ? num(apprentice.n) : 0,
  };
}

/**
 * Award the active badges whose rule the member now meets. "Held" includes revoked awards, so a badge staff took away
 * is never re-awarded by the job. Returns the codes newly awarded.
 */
export async function awardUstaadBadges(tx: Tx, memberId: string, now: Date = new Date()): Promise<string[]> {
  const [m] = await tx
    .select({
      id: ustaadMembers.id,
      userId: ustaadMembers.userId,
      status: ustaadMembers.status,
      founding: ustaadMembers.founding,
      lang: ustaadMembers.lang,
      cityId: ustaadMembers.cityId,
    })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, memberId))
    .limit(1);
  if (!m || m.status === 'left' || m.status === 'banned') return [];
  const badges = await tx
    .select({
      code: ustaadBadges.code,
      rule: ustaadBadges.rule,
      nameEn: ustaadBadges.nameEn,
      nameHi: ustaadBadges.nameHi,
    })
    .from(ustaadBadges)
    .where(eq(ustaadBadges.active, true));
  if (badges.length === 0) return [];
  const heldRows = await tx
    .select({ code: ustaadBadgeAwards.badgeCode })
    .from(ustaadBadgeAwards)
    .where(eq(ustaadBadgeAwards.memberId, memberId));
  const held = new Set(heldRows.map((r) => r.code));
  const due = badgesToAward(badges, await badgeFacts(tx, memberId, m.founding, now), held);
  const awarded: string[] = [];
  for (const code of due) {
    const [row] = await tx
      .insert(ustaadBadgeAwards)
      .values({ memberId, badgeCode: code, awardedAt: now })
      .onConflictDoNothing()
      .returning({ id: ustaadBadgeAwards.id });
    if (!row) continue;
    awarded.push(code);
    const badge = badges.find((b) => b.code === code);
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: memberId,
        kind: 'badge_earned',
        actorId: null,
        actorRole: 'system',
        cityId: m.cityId,
        props: { badge: code },
      },
      { name: 'ustaad_badge_earned', memberId, userId: m.userId, props: { memberId, badge: code } },
    );
    await notifyUstaad(tx, 'ustaad.badge_earned', {
      userId: m.userId,
      entityId: memberId,
      version: `badge:${code}`,
      // The badge name in the member's language (content data carries Hindi, hard rule 10).
      params: { badge: (m.lang === 'en' ? badge?.nameEn : badge?.nameHi) ?? code },
    });
  }
  return awarded;
}
