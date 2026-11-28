/**
 * Publish side effects of network content (spec 23 § 7, § 12; plan task G2, F2's "keep runs the publish side
 * effects"). One module both sides use: the writers (Q&A, comments, messages) call these when an item goes out at once,
 * and moderation calls `releaseUstaadHeldTarget` when a community manager keeps an item the automatic first pass held.
 * It imports no writer and no moderation file, so there is no import cycle.
 *
 * Exactly once: a release runs only for an item that was never published (its creation event did not reach
 * `visible`, and no `released` event exists). An item an intimate-image complaint hid after it was published
 * (`visible → held`) is only made visible again: no second notice, no second count. Izzat uses the same idempotent
 * key as the writer (`answer:{id}`).
 */
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { ustaadTopicLabel } from '@mechdost/shared/notice-catalogue';
import { ustaadQuestionMachine } from '@mechdost/shared/state';
import { istDateString } from '@mechdost/shared/time';
import {
  ustaadAnswers,
  ustaadComments,
  ustaadEvents,
  ustaadMemberCounters,
  ustaadMemberSpecialities,
  ustaadMembers,
  ustaadMessages,
  ustaadPostCounters,
  ustaadPosts,
  ustaadQuestions,
  ustaadThreadMembers,
  ustaadThreads,
} from '../../schema';
import type { Tx } from '../orders';
import { recordUstaadEvent, type UstaadEventInput } from './events';
import { recordIzzat } from './izzat';
import { notifyUstaad } from './notify';
import { readUstaadSettingValues } from './settings';
import type { UstaadTarget } from './targets';

/** Nobody blocked between `viewer` and the member in `author` (SR-35). */
const notBlocked = (viewer: string, author: SQL) =>
  sql`not exists (select 1 from ustaad_blocks bl where (bl.member_id = ${author} and bl.target_id = ${viewer})
      or (bl.member_id = ${viewer} and bl.target_id = ${author}))`;

const istDay = () => istDateString(new Date()).replaceAll('-', '');

/** Up to `qa.notify_ustaads` verified Ustaads in the city with a matching speciality, most helpful first. */
async function matchingUstaads(
  tx: Tx,
  q: { cityId: string; askerId: string; codes: string[]; limit: number },
): Promise<{ userId: string; memberId: string }[]> {
  if (q.codes.length === 0) return [];
  return tx
    .selectDistinct({
      userId: ustaadMembers.userId,
      memberId: ustaadMembers.id,
      helpful: ustaadMemberCounters.helpfulVotes,
    })
    .from(ustaadMembers)
    .innerJoin(ustaadMemberSpecialities, eq(ustaadMemberSpecialities.memberId, ustaadMembers.id))
    .leftJoin(ustaadMemberCounters, eq(ustaadMemberCounters.memberId, ustaadMembers.id))
    .where(
      and(
        eq(ustaadMembers.cityId, q.cityId),
        eq(ustaadMembers.status, 'active'),
        eq(ustaadMembers.track, 'ustaad'),
        sql`${ustaadMembers.level} not in ('apprentice', 'ustaad_pending')`,
        ne(ustaadMembers.id, q.askerId),
        inArray(ustaadMemberSpecialities.code, q.codes),
        notBlocked(q.askerId, sql`${ustaadMembers.id}`),
      ),
    )
    .orderBy(desc(ustaadMemberCounters.helpfulVotes))
    .limit(q.limit);
}

/** A question goes out: the matching Ustaads are told (`ustaad.question_waiting`). */
export async function publishUstaadQuestion(tx: Tx, questionId: string): Promise<void> {
  const [row] = await tx
    .select({ q: ustaadQuestions, displayName: ustaadMembers.displayName })
    .from(ustaadQuestions)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadQuestions.askerId))
    .where(eq(ustaadQuestions.id, questionId))
    .limit(1);
  if (!row) return;
  const { q } = row;
  const s = await readUstaadSettingValues(tx, ['ustaad.qa.notify_ustaads']);
  const codes = [q.segmentCode, q.workCode].filter((c): c is string => Boolean(c));
  const targets = await matchingUstaads(tx, {
    cityId: q.cityId,
    askerId: q.askerId,
    codes,
    limit: Number(s['ustaad.qa.notify_ustaads']),
  });
  for (const target of targets)
    await notifyUstaad(tx, 'ustaad.question_waiting', {
      userId: target.userId,
      entityId: q.id,
      version: 1,
      // The topic is a code: it is worded in each Ustaad's own language (SIM-F7), never shown raw.
      params: (locale) => ({
        memberName: row.displayName,
        topic: ustaadTopicLabel(locale, q.workCode ?? q.segmentCode ?? ''),
        questionCode: q.code,
      }),
    });
}

/**
 * A visible answer goes out: the question moves `open → answered` (conditional), the author earns Izzat when the
 * answer counts for levels (idempotent key `answer:{id}`), and the asker is told.
 */
export async function publishUstaadAnswer(tx: Tx, answerId: string): Promise<void> {
  const [row] = await tx
    .select({ a: ustaadAnswers, q: ustaadQuestions })
    .from(ustaadAnswers)
    .innerJoin(ustaadQuestions, eq(ustaadQuestions.id, ustaadAnswers.questionId))
    .where(eq(ustaadAnswers.id, answerId))
    .limit(1);
  if (row?.a.status !== 'visible') return;
  const { a, q } = row;
  const [author] = await tx
    .select({ userId: ustaadMembers.userId, displayName: ustaadMembers.displayName })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, a.authorId))
    .limit(1);
  if (q.status === 'open') {
    ustaadQuestionMachine.assert('open', 'answered', 'system');
    const moved = await tx
      .update(ustaadQuestions)
      .set({ status: 'answered' })
      .where(
        and(
          eq(ustaadQuestions.id, q.id),
          eq(ustaadQuestions.status, 'open'),
          eq(ustaadQuestions.version, q.version),
        ),
      )
      .returning({ id: ustaadQuestions.id });
    if (moved.length > 0)
      await recordUstaadEvent(tx, {
        entityType: 'question',
        entityId: q.id,
        kind: 'first_answer',
        fromStatus: 'open',
        toStatus: 'answered',
        actorId: null,
        actorRole: 'system',
        cityId: q.cityId,
      });
  }
  if (a.countsForLevels && author)
    await recordIzzat(
      tx,
      { userId: author.userId },
      {
        memberId: a.authorId,
        reason: 'answer_posted',
        source: { type: 'answer', id: a.id },
        idemKey: `answer:${a.id}`,
      },
    );
  const [asker] = await tx
    .select({ userId: ustaadMembers.userId })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, q.askerId))
    .limit(1);
  if (asker && author)
    await notifyUstaad(tx, 'ustaad.answer_received', {
      userId: asker.userId,
      entityId: a.id,
      version: 1,
      params: { memberName: author.displayName, questionCode: q.code },
    });
}

/** A visible comment goes out: the post's reply count grows and the post author (and the parent's author) are told. */
export async function publishUstaadComment(tx: Tx, commentId: string): Promise<void> {
  const [c] = await tx.select().from(ustaadComments).where(eq(ustaadComments.id, commentId)).limit(1);
  if (c?.status !== 'visible' || !c.postId) return;
  const [post] = await tx.select().from(ustaadPosts).where(eq(ustaadPosts.id, c.postId)).limit(1);
  if (!post) return;
  await tx
    .update(ustaadPostCounters)
    .set({ comments: sql`${ustaadPostCounters.comments} + 1` })
    .where(eq(ustaadPostCounters.postId, post.id));
  let parentAuthor: string | null = null;
  if (c.parentId) {
    const [parent] = await tx
      .select({ authorId: ustaadComments.authorId })
      .from(ustaadComments)
      .where(eq(ustaadComments.id, c.parentId))
      .limit(1);
    parentAuthor = parent?.authorId ?? null;
  }
  const [me] = await tx
    .select({ displayName: ustaadMembers.displayName })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, c.authorId))
    .limit(1);
  const targets = [...new Set([post.authorId, parentAuthor].filter((x): x is string => x !== null))].filter(
    (id) => id !== c.authorId,
  );
  const users = targets.length
    ? await tx
        .select({ userId: ustaadMembers.userId })
        .from(ustaadMembers)
        .where(and(inArray(ustaadMembers.id, targets), eq(ustaadMembers.status, 'active')))
    : [];
  for (const u of users)
    await notifyUstaad(tx, 'ustaad.reply', {
      userId: u.userId,
      entityId: post.id,
      version: `d${istDay()}`,
      params: { memberName: me?.displayName ?? '' },
      linkParams: { postId: post.id },
    });
}

/**
 * A message goes out: the thread's last message time moves (never backwards) and the other member is told (a request
 * notice while the thread is still a request), unless they muted the thread.
 */
export async function publishUstaadMessage(tx: Tx, messageId: string): Promise<void> {
  const [row] = await tx
    .select({ m: ustaadMessages, t: ustaadThreads })
    .from(ustaadMessages)
    .innerJoin(ustaadThreads, eq(ustaadThreads.id, ustaadMessages.threadId))
    .where(eq(ustaadMessages.id, messageId))
    .limit(1);
  if (row?.m.heldReasonCode !== null || row.m.deletedAt !== null) return;
  const { m, t } = row;
  if (t.status !== 'open' && t.status !== 'requested') return;
  await tx
    .update(ustaadThreads)
    .set({
      lastMessageAt: sql`greatest(coalesce(${ustaadThreads.lastMessageAt}, ${m.createdAt.toISOString()}::timestamptz), ${m.createdAt.toISOString()}::timestamptz)`,
    })
    .where(eq(ustaadThreads.id, t.id));
  const requested = t.status === 'requested';
  const otherId = t.lowId === m.senderId ? t.highId : t.lowId;
  const [other] = await tx
    .select({ userId: ustaadMembers.userId, muted: ustaadThreadMembers.muted })
    .from(ustaadMembers)
    .leftJoin(
      ustaadThreadMembers,
      and(eq(ustaadThreadMembers.threadId, t.id), eq(ustaadThreadMembers.memberId, ustaadMembers.id)),
    )
    .where(eq(ustaadMembers.id, otherId))
    .limit(1);
  const [me] = await tx
    .select({ displayName: ustaadMembers.displayName, displayNameHi: ustaadMembers.displayNameHi })
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, m.senderId))
    .limit(1);
  if (other && other.muted !== true && me)
    await notifyUstaad(tx, requested ? 'ustaad.message_request' : 'ustaad.message', {
      userId: other.userId,
      entityId: t.id,
      // One bell entry per thread and IST day for messages; one per request.
      version: requested ? `req-${String(t.version)}` : istDateString(new Date()),
      params: (locale) => ({
        memberName: locale === 'hi' ? (me.displayNameHi ?? me.displayName) : me.displayName,
      }),
    });
}

/** True when the item already went out once (created visible, or released before). */
async function wasPublished(
  tx: Tx,
  entityType: UstaadEventInput['entityType'],
  entityId: string,
): Promise<boolean> {
  const [e] = await tx
    .select({ id: ustaadEvents.id })
    .from(ustaadEvents)
    .where(
      and(
        eq(ustaadEvents.entityType, entityType),
        eq(ustaadEvents.entityId, entityId),
        sql`(${ustaadEvents.toStatus} = 'visible' or ${ustaadEvents.kind} = 'released')`,
      ),
    )
    .limit(1);
  return e !== undefined;
}

/** A question is "held" only through its screen result at asking time (questions have no `held` status). */
async function questionWasHeld(tx: Tx, questionId: string): Promise<boolean> {
  const [asked] = await tx
    .select({ id: ustaadEvents.id })
    .from(ustaadEvents)
    .where(
      and(
        eq(ustaadEvents.entityType, 'question'),
        eq(ustaadEvents.entityId, questionId),
        eq(ustaadEvents.kind, 'asked'),
        sql`${ustaadEvents.props} ->> 'screen' = 'hold'`,
      ),
    )
    .limit(1);
  return asked !== undefined;
}

/**
 * A community manager kept an item the first pass held: run what publishing would have done, once. Call after the
 * status move (held → visible; a held message is released by `moveUstaadTarget`).
 */
export async function releaseUstaadHeldTarget(tx: Tx, t: UstaadTarget, staffUserId: string): Promise<void> {
  const released = async (entityType: UstaadEventInput['entityType'], id: string, cityId: string | null) => {
    await recordUstaadEvent(tx, {
      entityType,
      entityId: id,
      kind: 'released',
      toStatus: 'visible',
      actorId: staffUserId,
      actorRole: 'staff',
      cityId,
    });
  };
  switch (t.type) {
    case 'answer':
      if (t.status !== 'held' || (await wasPublished(tx, 'answer', t.id))) return;
      await publishUstaadAnswer(tx, t.id);
      await released('answer', t.id, t.cityId);
      return;
    case 'comment':
      if (t.status !== 'held' || (await wasPublished(tx, 'comment', t.id))) return;
      await publishUstaadComment(tx, t.id);
      await released('comment', t.id, t.cityId);
      return;
    case 'post':
    case 'story':
      if (t.status !== 'held') return;
      await tx.update(ustaadPosts).set({ heldReasonCode: null }).where(eq(ustaadPosts.id, t.id));
      if (!(await wasPublished(tx, 'post', t.id))) await released('post', t.id, t.cityId);
      return;
    case 'question':
      if (!['open', 'answered'].includes(t.status)) return;
      if (!(await questionWasHeld(tx, t.id)) || (await wasPublished(tx, 'question', t.id))) return;
      await publishUstaadQuestion(tx, t.id);
      await released('question', t.id, t.cityId);
      return;
    case 'message':
      if (t.status !== 'held') return;
      await publishUstaadMessage(tx, t.id);
      return;
    case 'job':
    case 'member':
      return;
  }
}
