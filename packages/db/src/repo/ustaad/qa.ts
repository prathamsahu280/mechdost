/**
 * Ustaad Q&A (spec 23 § 4 flow 4, § 7.5, § 9.1; plan task C1). The only writer of `ustaad_questions`,
 * `ustaad_answers`, `ustaad_answer_votes` and `ustaad_answer_parts`. Every write is one transaction: the row, the
 * conditional status move (`machine.assert` + UPDATE on `(id, status, version)`), counters by conditional increments
 * (never read-then-write), Izzat through `recordIzzat` (idempotent keys), the `ustaad_events` row + analytics and the
 * notices (outbox). Reads are actor-scoped: a question the viewer may not see (removed, blocked either way, outside
 * reach) is a 404, never a 403. No phone number is ever selected.
 */
import { and, desc, eq, inArray, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { ustaadQuestionMachine } from '@mechdost/shared/state';
import {
  VOICE_ONLY_TITLE,
  type AnswerInput,
  type AnswerView,
  type AskQuestion,
  type QuestionCard,
  type QuestionDetail,
  type QuestionFilter,
} from '@mechdost/shared/ustaad/dto/qa';
import { ustaadPublicCode } from '@mechdost/shared/ustaad/public-code';
import type { VoiceInfo } from '@mechdost/shared/ustaad/dto/media';
import {
  cities,
  products,
  ustaadAnswerParts,
  ustaadAnswers,
  ustaadAnswerVotes,
  ustaadEvents,
  ustaadMedia,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadQuestions,
  vehicleModels,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { recordIzzat } from './izzat';
import { recomputeUstaadLevel } from './levels';
import { openUstaadAutoHoldReport, screenUstaadContent } from './moderation';
import { ustaadScreenText, ustaadStoredOriginal } from './screen-text';
import { notifyUstaad } from './notify';
import { publishUstaadAnswer, publishUstaadQuestion } from './publish';
import { readUstaadSettingValues } from './settings';
import { ustaadMediaTextInfo, voiceInfoOf } from './media';

/** Who is acting: the signed-in user and their member row (the API guard read it fresh). */
export interface UstaadActor {
  userId: string;
  memberId: string;
}

type MemberRow = typeof ustaadMembers.$inferSelect;
const PRE_VERIFIED_LEVELS = ['apprentice', 'ustaad_pending'];

async function memberRow(tx: Tx, memberId: string): Promise<MemberRow> {
  const [row] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, memberId)).limit(1);
  if (!row || row.status === 'left' || row.status === 'banned') throw new NotFoundError('Member not found');
  return row;
}

/**
 * The member row for a write (ask, answer, helpful, best answer, parts): only an `active` member with no restricted
 * mode may write; a restricted member (status `restricted`, or a minor report / review mode, SR-42) reads only.
 */
export function assertUstaadMemberCanWrite(me: Pick<MemberRow, 'status' | 'restrictedMode'>): void {
  if (me.status !== 'active' || me.restrictedMode !== 'none')
    throw new ForbiddenError('Your account can only read for now', 'USTAAD_RESTRICTED');
}

async function writerRow(tx: Tx, memberId: string): Promise<MemberRow> {
  const me = await memberRow(tx, memberId);
  assertUstaadMemberCanWrite(me);
  return me;
}

/** Nobody blocked between `viewer` and the member in `author` (SR-35). */
const notBlocked = (viewer: string, author: SQL | typeof ustaadQuestions.askerId) =>
  sql`not exists (select 1 from ustaad_blocks bl where (bl.member_id = ${author} and bl.target_id = ${viewer})
      or (bl.member_id = ${viewer} and bl.target_id = ${author}))`;

/** Reach (spec 23 § 15): the viewer's city, or a state-wide question. */
const inReach = (cityId: string) =>
  or(eq(ustaadQuestions.cityId, cityId), eq(ustaadQuestions.reach, 'state')) ?? sql`false`;

/**
 * A voice note attached to a question or answer: the caller's own, verified, audio, in a live bucket and within
 * `qa.voice_max_s`. Attaching makes it readable through the thread, so anything else is refused (no foreign media).
 */
async function assertOwnVoice(tx: Tx, memberId: string, mediaId: string, maxS: number): Promise<void> {
  const [m] = await tx
    .select({
      owner: ustaadMedia.ownerMemberId,
      kind: ustaadMedia.kind,
      status: ustaadMedia.status,
      bucket: ustaadMedia.bucket,
      durationMs: ustaadMedia.durationMs,
    })
    .from(ustaadMedia)
    .where(eq(ustaadMedia.id, mediaId))
    .limit(1);
  const ok =
    m?.owner === memberId &&
    m.kind === 'audio' &&
    m.status === 'verified' &&
    m.bucket === 'media' &&
    (m.durationMs ?? 0) <= maxS * 1000;
  if (!ok) throw new ValidationError('That voice note cannot be used', 'USTAAD_MEDIA_INVALID');
}

function inputOf(x: { voiceMediaId?: string | undefined }): 'voice' | 'text' {
  return x.voiceMediaId ? 'voice' : 'text';
}

/** Ask (idempotent on `idemKey`). Refuses `USTAAD_REGION` (state-wide while off), `USTAAD_MEDIA_INVALID`. */
export async function askUstaadQuestion(
  db: Tx,
  actor: UstaadActor,
  input: AskQuestion,
): Promise<{ id: string; code: string; status: string }> {
  return db.transaction(async (tx) => {
    const me = await writerRow(tx, actor.memberId);
    const [existing] = await tx
      .select({ id: ustaadQuestions.id, code: ustaadQuestions.code, status: ustaadQuestions.status })
      .from(ustaadQuestions)
      .where(and(eq(ustaadQuestions.askerId, me.id), eq(ustaadQuestions.idemKey, input.idemKey)))
      .limit(1);
    if (existing) return existing;
    const s = await readUstaadSettingValues(tx, [
      'ustaad.qa.voice_max_s',
      'ustaad.qa.notify_ustaads',
      'ustaad.general.all_state',
    ]);
    if (input.reach === 'state' && s['ustaad.general.all_state'] !== true)
      throw new ValidationError('Questions reach your city only', 'USTAAD_REGION');
    if (input.voiceMediaId)
      await assertOwnVoice(tx, me.id, input.voiceMediaId, Number(s['ustaad.qa.voice_max_s']));
    const [city] = await tx
      .select({ code: cities.code })
      .from(cities)
      .where(eq(cities.id, me.cityId))
      .limit(1);
    if (!city) throw new NotFoundError('City not found');
    const screen = await screenUstaadContent(tx, {
      kind: 'question',
      text: ustaadScreenText({
        parts: [input.title, input.body],
        original: input.bodyOriginal,
        correction: input.correction,
      }),
      mediaIds: input.voiceMediaId ? [input.voiceMediaId] : [],
      authorId: me.id,
    });
    // F2: a phone number, plate or denied link in public text is refused (the author can fix it).
    if (screen === 'block')
      throw new ValidationError('This cannot be posted as it is', 'USTAAD_CONTENT_BLOCKED');
    let row: { id: string; code: string; status: string } | undefined;
    for (let attempt = 0; attempt < 3 && !row; attempt += 1) {
      try {
        [row] = await tx
          .insert(ustaadQuestions)
          .values({
            code: ustaadPublicCode('UQ', city.code),
            askerId: me.id,
            cityId: me.cityId,
            reach: input.reach,
            segmentCode: input.segmentCode ?? null,
            workCode: input.workCode ?? null,
            vehicleModelId: input.vehicleModelId ?? null,
            title: input.title ?? VOICE_ONLY_TITLE,
            body: input.body ?? null,
            bodyOriginal: ustaadStoredOriginal(input.bodyOriginal, input.correction),
            correction: input.correction,
            voiceMediaId: input.voiceMediaId ?? null,
            safetyTag: input.safetyTag ?? (input.segmentCode === 'ev' ? 'ev_hv' : null),
            hideGarage: input.hideGarage,
            idemKey: input.idemKey,
          })
          .returning({ id: ustaadQuestions.id, code: ustaadQuestions.code, status: ustaadQuestions.status });
      } catch (err) {
        // A code collision retries with a new code; anything else (incl. a same-key race) is rethrown.
        if (pgCode(err) !== '23505' || attempt === 2) throw err;
      }
    }
    if (!row) throw new ConflictError('Could not create the question');
    await recordUstaadEvent(
      tx,
      {
        entityType: 'question',
        entityId: row.id,
        kind: 'asked',
        toStatus: 'open',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: me.cityId,
        props: { input: inputOf(input), screen },
      },
      {
        name: 'ustaad_question_asked',
        memberId: me.id,
        userId: actor.userId,
        props: {
          questionCode: row.code,
          input: inputOf(input),
          segment: input.segmentCode ?? null,
          work: input.workCode ?? null,
          correction: input.correction,
        },
      },
    );
    // Questions have no `held` status: a hold keeps the question out of the Ustaads' notices and puts it in the
    // moderation queue with a clock (F2).
    if (screen === 'hold')
      await openUstaadAutoHoldReport(tx, {
        targetType: 'question',
        targetId: row.id,
        authorId: me.id,
        kind: 'question',
      });
    if (screen === 'ok') await publishUstaadQuestion(tx, row.id);
    return row;
  });
}

/** The question by code for a viewer (404 when removed, blocked or outside reach). */
async function visibleQuestion(tx: Tx, viewer: MemberRow, code: string) {
  const [q] = await tx
    .select()
    .from(ustaadQuestions)
    .where(
      and(
        eq(ustaadQuestions.code, code),
        ne(ustaadQuestions.status, 'removed'),
        inReach(viewer.cityId),
        notBlocked(viewer.id, ustaadQuestions.askerId),
      ),
    )
    .limit(1);
  if (!q) throw new NotFoundError('Question not found');
  return q;
}

/**
 * Answer (idempotent). Refuses `USTAAD_CANNOT_ANSWER` (a Chhotu while `qa.apprentice_can_answer` is off, or a
 * restricted member), `USTAAD_QUESTION_CLOSED`, `USTAAD_MEDIA_INVALID`. A pending Ustaad's answer is stored with
 * `counts_for_levels = false` and earns no Izzat until verification flips it (workstream B back-fills).
 */
export async function answerUstaadQuestion(
  db: Tx,
  actor: UstaadActor,
  code: string,
  input: AnswerInput,
): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const me = await writerRow(tx, actor.memberId);
    const q = await visibleQuestion(tx, me, code);
    const [existing] = await tx
      .select({ id: ustaadAnswers.id, status: ustaadAnswers.status })
      .from(ustaadAnswers)
      .where(and(eq(ustaadAnswers.authorId, me.id), eq(ustaadAnswers.idemKey, input.idemKey)))
      .limit(1);
    if (existing) return existing;
    const s = await readUstaadSettingValues(tx, ['ustaad.qa.apprentice_can_answer', 'ustaad.qa.voice_max_s']);
    if (me.track !== 'ustaad' && s['ustaad.qa.apprentice_can_answer'] !== true)
      throw new ForbiddenError('Only Ustaads can answer', 'USTAAD_CANNOT_ANSWER');
    if (q.status !== 'open' && q.status !== 'answered')
      throw new ConflictError('This question is closed', 'USTAAD_QUESTION_CLOSED');
    if (q.askerId === me.id) throw new ValidationError('You asked this question', 'USTAAD_CANNOT_ANSWER');
    if (input.voiceMediaId)
      await assertOwnVoice(tx, me.id, input.voiceMediaId, Number(s['ustaad.qa.voice_max_s']));
    const screen = await screenUstaadContent(tx, {
      kind: 'answer',
      text: ustaadScreenText({
        parts: [input.body],
        original: input.bodyOriginal,
        correction: input.correction,
      }),
      mediaIds: input.voiceMediaId ? [input.voiceMediaId] : [],
      authorId: me.id,
    });
    if (screen === 'block')
      throw new ValidationError('This cannot be posted as it is', 'USTAAD_CONTENT_BLOCKED');
    const counts = me.track === 'ustaad' && !PRE_VERIFIED_LEVELS.includes(me.level);
    const status = screen === 'ok' ? 'visible' : 'held';
    const [row] = await tx
      .insert(ustaadAnswers)
      .values({
        questionId: q.id,
        authorId: me.id,
        body: input.body ?? null,
        bodyOriginal: ustaadStoredOriginal(input.bodyOriginal, input.correction),
        correction: input.correction,
        voiceMediaId: input.voiceMediaId ?? null,
        status,
        countsForLevels: counts,
        idemKey: input.idemKey,
      })
      .returning({ id: ustaadAnswers.id, status: ustaadAnswers.status });
    if (!row) throw new ConflictError('Could not save the answer');
    if (status === 'held')
      await openUstaadAutoHoldReport(tx, {
        targetType: 'answer',
        targetId: row.id,
        authorId: me.id,
        kind: 'answer',
      });
    await tx
      .update(ustaadMemberCounters)
      .set({ answers: sql`${ustaadMemberCounters.answers} + 1` })
      .where(eq(ustaadMemberCounters.memberId, me.id));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'answer',
        entityId: row.id,
        kind: 'posted',
        toStatus: status,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: q.cityId,
        props: { questionId: q.id, input: inputOf(input), countsForLevels: counts },
      },
      {
        name: 'ustaad_answer_posted',
        memberId: me.id,
        userId: actor.userId,
        props: { answerId: row.id, input: inputOf(input) },
      },
    );
    if (status === 'visible') await publishUstaadAnswer(tx, row.id);
    return row;
  });
}

/** A visible answer the viewer may see (its question visible to them, its author not blocked), or 404. */
async function visibleAnswer(tx: Tx, viewer: MemberRow, answerId: string) {
  const [a] = await tx
    .select({ answer: ustaadAnswers, question: ustaadQuestions })
    .from(ustaadAnswers)
    .innerJoin(ustaadQuestions, eq(ustaadQuestions.id, ustaadAnswers.questionId))
    .where(
      and(
        eq(ustaadAnswers.id, answerId),
        eq(ustaadAnswers.status, 'visible'),
        ne(ustaadQuestions.status, 'removed'),
        inReach(viewer.cityId),
        notBlocked(viewer.id, ustaadQuestions.askerId),
        notBlocked(viewer.id, sql`${ustaadAnswers.authorId}`),
      ),
    )
    .limit(1);
  if (!a) throw new NotFoundError('Answer not found');
  return a;
}

/** A question or answer the member may see, by id (Saved, spec 23 § 5); `NotFoundError` otherwise. */
export async function assertUstaadQaVisible(
  tx: Tx,
  memberId: string,
  kind: 'question' | 'answer',
  id: string,
): Promise<void> {
  const viewer = await memberRow(tx, memberId);
  if (kind === 'answer') {
    await visibleAnswer(tx, viewer, id);
    return;
  }
  const [q] = await tx
    .select({ code: ustaadQuestions.code })
    .from(ustaadQuestions)
    .where(eq(ustaadQuestions.id, id))
    .limit(1);
  if (!q) throw new NotFoundError('Question not found');
  await visibleQuestion(tx, viewer, q.code);
}

/**
 * "Helpful" (one per member and answer; a repeat changes nothing). Refuses `USTAAD_SELF_VOTE`. The count and the
 * author's counters move only when a vote row was inserted.
 */
export async function voteUstaadAnswerHelpful(
  db: Tx,
  actor: UstaadActor,
  answerId: string,
): Promise<{ helpfulCount: number; voted: boolean }> {
  return db.transaction(async (tx) => {
    const me = await writerRow(tx, actor.memberId);
    const { answer, question } = await visibleAnswer(tx, me, answerId);
    if (answer.authorId === me.id)
      throw new ValidationError('You cannot vote for yourself', 'USTAAD_SELF_VOTE');
    const inserted = await tx
      .insert(ustaadAnswerVotes)
      .values({ answerId, voterId: me.id })
      .onConflictDoNothing()
      .returning({ answerId: ustaadAnswerVotes.answerId });
    if (inserted.length === 0) return { helpfulCount: answer.helpfulCount, voted: false };
    const [updated] = await tx
      .update(ustaadAnswers)
      .set({ helpfulCount: sql`${ustaadAnswers.helpfulCount} + 1` })
      .where(eq(ustaadAnswers.id, answerId))
      .returning({ helpfulCount: ustaadAnswers.helpfulCount });
    const count = updated?.helpfulCount ?? answer.helpfulCount + 1;
    await tx
      .update(ustaadMemberCounters)
      .set({
        helpfulVotes: sql`${ustaadMemberCounters.helpfulVotes} + 1`,
        ...(count === 1 ? { helpfulAnswers: sql`${ustaadMemberCounters.helpfulAnswers} + 1` } : {}),
      })
      .where(eq(ustaadMemberCounters.memberId, answer.authorId));
    if (answer.countsForLevels) {
      const [author] = await tx
        .select({ userId: ustaadMembers.userId })
        .from(ustaadMembers)
        .where(eq(ustaadMembers.id, answer.authorId))
        .limit(1);
      await recordIzzat(
        tx,
        { userId: author?.userId ?? null },
        {
          memberId: answer.authorId,
          reason: 'helpful_received',
          source: { type: 'answer', id: answerId },
          idemKey: `helpful:${answerId}:${me.id}`,
        },
      );
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'answer',
        entityId: answerId,
        kind: 'helpful',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: question.cityId,
      },
      { name: 'ustaad_answer_helpful', memberId: me.id, userId: actor.userId, props: { answerId } },
    );
    return { helpfulCount: count, voted: true };
  });
}

/**
 * The asker picks one best answer (spec 23 § 7.5). 404 for anyone but the asker and for an answer of another
 * question; `USTAAD_ALREADY_SOLVED` (409) when a best exists or two picks race; `USTAAD_WEEKLY_CAP` past
 * `qa.best_per_week` in 7 days.
 */
export async function chooseUstaadBestAnswer(
  db: Tx,
  actor: UstaadActor,
  code: string,
  answerId: string,
): Promise<{ status: 'solved' }> {
  return db.transaction(async (tx) => {
    const me = await writerRow(tx, actor.memberId);
    const q = await visibleQuestion(tx, me, code);
    if (q.askerId !== me.id) throw new NotFoundError('Question not found');
    const [a] = await tx
      .select()
      .from(ustaadAnswers)
      .where(
        and(
          eq(ustaadAnswers.id, answerId),
          eq(ustaadAnswers.questionId, q.id),
          eq(ustaadAnswers.status, 'visible'),
        ),
      )
      .limit(1);
    if (!a) throw new NotFoundError('Answer not found');
    if (q.status !== 'answered')
      throw new ConflictError('A best answer is already chosen', 'USTAAD_ALREADY_SOLVED');
    const s = await readUstaadSettingValues(tx, ['ustaad.qa.best_per_week']);
    const [week] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ustaadEvents)
      .where(
        and(
          eq(ustaadEvents.entityType, 'question'),
          eq(ustaadEvents.kind, 'best_chosen'),
          eq(ustaadEvents.actorId, actor.userId),
          sql`${ustaadEvents.occurredAt} > now() - interval '7 days'`,
        ),
      );
    if ((week?.n ?? 0) >= Number(s['ustaad.qa.best_per_week']))
      throw new ValidationError('Weekly limit for best answers reached', 'USTAAD_WEEKLY_CAP');
    ustaadQuestionMachine.assert('answered', 'solved', 'member');
    const moved = await tx
      .update(ustaadQuestions)
      .set({ status: 'solved', bestAnswerId: a.id })
      .where(
        and(
          eq(ustaadQuestions.id, q.id),
          eq(ustaadQuestions.status, 'answered'),
          eq(ustaadQuestions.version, q.version),
        ),
      )
      .returning({ id: ustaadQuestions.id });
    if (moved.length === 0)
      throw new ConflictError('A best answer is already chosen', 'USTAAD_ALREADY_SOLVED');
    await tx
      .update(ustaadMemberCounters)
      .set({ bestAnswers: sql`${ustaadMemberCounters.bestAnswers} + 1` })
      .where(eq(ustaadMemberCounters.memberId, a.authorId));
    const [author] = await tx
      .select({ userId: ustaadMembers.userId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, a.authorId))
      .limit(1);
    if (a.countsForLevels) {
      await recordIzzat(
        tx,
        { userId: author?.userId ?? null },
        {
          memberId: a.authorId,
          reason: 'best_answer',
          source: { type: 'answer', id: a.id },
          idemKey: `best:${a.id}`,
        },
      );
      await recomputeUstaadLevel(tx, a.authorId);
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'question',
        entityId: q.id,
        kind: 'best_chosen',
        fromStatus: 'answered',
        toStatus: 'solved',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: q.cityId,
        props: { answerId: a.id },
      },
      {
        name: 'ustaad_best_answer_chosen',
        memberId: me.id,
        userId: actor.userId,
        props: { questionCode: q.code, answerId: a.id },
      },
    );
    if (author)
      await notifyUstaad(tx, 'ustaad.best_answer', {
        userId: author.userId,
        entityId: a.id,
        version: 1,
        params: { questionCode: q.code },
      });
    return { status: 'solved' };
  });
}

/**
 * "Parts used in this fix": the best answer's author replaces its ≤ 5 catalogue links (live products only).
 * `USTAAD_NOT_BEST` until the answer is the best one; 404 for anyone else (staff edit through workstream G).
 */
export async function setUstaadAnswerParts(
  db: Tx,
  actor: UstaadActor,
  answerId: string,
  productIds: readonly string[],
): Promise<{ count: number }> {
  if (productIds.length > 5) throw new ValidationError('At most 5 parts', 'USTAAD_PART_INVALID');
  return db.transaction(async (tx) => {
    const me = await writerRow(tx, actor.memberId);
    const { answer, question } = await visibleAnswer(tx, me, answerId);
    if (answer.authorId !== me.id) throw new NotFoundError('Answer not found');
    if (question.bestAnswerId !== answer.id)
      throw new ValidationError('Parts go under the best answer', 'USTAAD_NOT_BEST');
    if (productIds.length > 0) {
      const live = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, [...productIds]), eq(products.status, 'live')));
      if (live.length !== new Set(productIds).size)
        throw new ValidationError('A part is not in the catalogue', 'USTAAD_PART_INVALID');
    }
    await tx.delete(ustaadAnswerParts).where(eq(ustaadAnswerParts.answerId, answerId));
    if (productIds.length > 0)
      await tx
        .insert(ustaadAnswerParts)
        .values(
          [...new Set(productIds)].map((productId) => ({ answerId, productId, addedBy: actor.userId })),
        );
    await recordUstaadEvent(tx, {
      entityType: 'answer',
      entityId: answerId,
      kind: 'parts_set',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: question.cityId,
      props: { count: productIds.length },
    });
    return { count: productIds.length };
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

const authorCols = {
  id: ustaadMembers.id,
  handle: ustaadMembers.handle,
  displayName: ustaadMembers.displayName,
  displayNameHi: ustaadMembers.displayNameHi,
  level: ustaadMembers.level,
  track: ustaadMembers.track,
};

const visibleAnswerCount = sql<number>`(select count(*)::int from ustaad_answers va
  where va.question_id = ${ustaadQuestions.id} and va.status = 'visible')`;

const titleOf = (t: string): string | null => (t === VOICE_ONLY_TITLE ? null : t);

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(c: string): { at: Date; id: string } | null {
  const [iso, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
  const at = new Date(iso ?? '');
  if (!id || !/^[0-9a-f-]{36}$/.test(id) || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

/** Q&A list: All, For you (my specialities), Mine, No answer yet; keyset cursor, newest first. */
export async function listUstaadQuestions(
  db: Tx,
  actor: UstaadActor,
  query: { filter: QuestionFilter; limit: number; cursor?: string | undefined },
): Promise<{ items: QuestionCard[]; nextCursor: string | null }> {
  const me = await memberRow(db, actor.memberId);
  const conds: (SQL | undefined)[] = [
    sql`${ustaadQuestions.status} not in ('removed')`,
    inReach(me.cityId),
    notBlocked(me.id, ustaadQuestions.askerId),
  ];
  if (query.filter === 'mine') conds.push(eq(ustaadQuestions.askerId, me.id));
  if (query.filter === 'unanswered') conds.push(eq(ustaadQuestions.status, 'open'));
  if (query.filter === 'for_you')
    conds.push(
      sql`exists (select 1 from ustaad_member_specialities sp where sp.member_id = ${me.id}
        and sp.code in (${ustaadQuestions.segmentCode}, ${ustaadQuestions.workCode}))`,
      ne(ustaadQuestions.askerId, me.id),
    );
  const cur = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cur) throw new ValidationError('Bad cursor', 'BAD_CURSOR');
  if (cur)
    conds.push(
      or(
        lt(ustaadQuestions.createdAt, cur.at),
        and(eq(ustaadQuestions.createdAt, cur.at), lt(ustaadQuestions.id, cur.id)),
      ),
    );
  const rows = await db
    .select({ q: ustaadQuestions, asker: authorCols, answers: visibleAnswerCount })
    .from(ustaadQuestions)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadQuestions.askerId))
    .where(and(...conds))
    .orderBy(desc(ustaadQuestions.createdAt), desc(ustaadQuestions.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => cardOf(r.q, r.asker, r.answers, me.id)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.q.createdAt, last.q.id) : null,
  };
}

function cardOf(
  q: typeof ustaadQuestions.$inferSelect,
  asker: QuestionCard['asker'],
  answers: number,
  viewerId: string,
): QuestionCard {
  return {
    id: q.id,
    code: q.code,
    title: titleOf(q.title),
    hasVoice: q.voiceMediaId !== null,
    segmentCode: q.segmentCode,
    workCode: q.workCode,
    safetyTag: q.safetyTag,
    status: q.status,
    answers,
    asker: { ...asker, handle: asker.handle },
    mine: q.askerId === viewerId,
    createdAt: q.createdAt.toISOString(),
  };
}

/** The thread: question, visible answers (best first, then most helpful, then oldest), parts, what I may do. */
export async function ustaadQuestionDetail(
  db: Tx,
  actor: UstaadActor,
  code: string,
): Promise<QuestionDetail> {
  const me = await memberRow(db, actor.memberId);
  const q = await visibleQuestion(db, me, code);
  const [asker] = await db
    .select(authorCols)
    .from(ustaadMembers)
    .where(eq(ustaadMembers.id, q.askerId))
    .limit(1);
  if (!asker) throw new NotFoundError('Question not found');
  const [model] = q.vehicleModelId
    ? await db
        .select({ name: vehicleModels.name })
        .from(vehicleModels)
        .where(eq(vehicleModels.id, q.vehicleModelId))
        .limit(1)
    : [];
  const answers = await db
    .select({
      a: ustaadAnswers,
      author: authorCols,
      voted: sql<unknown>`exists (select 1 from ustaad_answer_votes v where v.answer_id = ${ustaadAnswers.id}
        and v.voter_id = ${me.id})`,
    })
    .from(ustaadAnswers)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadAnswers.authorId))
    .where(
      and(
        eq(ustaadAnswers.questionId, q.id),
        or(
          eq(ustaadAnswers.status, 'visible'),
          and(eq(ustaadAnswers.status, 'held'), eq(ustaadAnswers.authorId, me.id)),
        ),
        notBlocked(me.id, sql`${ustaadAnswers.authorId}`),
      ),
    )
    .orderBy(desc(ustaadAnswers.helpfulCount), ustaadAnswers.createdAt)
    .limit(200);
  const ids = answers.map((r) => r.a.id);
  const parts =
    ids.length === 0
      ? []
      : await db
          .select({
            answerId: ustaadAnswerParts.answerId,
            productId: products.id,
            slug: products.slug,
            name: products.name,
            nameHi: products.nameHi,
          })
          .from(ustaadAnswerParts)
          .innerJoin(products, eq(products.id, ustaadAnswerParts.productId))
          .where(and(inArray(ustaadAnswerParts.answerId, ids), eq(products.status, 'live')));
  const s = await readUstaadSettingValues(db, ['ustaad.qa.apprentice_can_answer']);
  // Spec 23 § 10a: duration, size and typed summary of every voice note on the page, in one query.
  const voices = await ustaadMediaTextInfo(db, [
    ...(q.voiceMediaId ? [q.voiceMediaId] : []),
    ...answers.flatMap((r) => (r.a.voiceMediaId ? [r.a.voiceMediaId] : [])),
  ]);
  const voiceOf = (id: string | null): VoiceInfo | null => voiceInfoOf(id ? voices.get(id) : undefined);
  const list: AnswerView[] = answers
    .map((r) => ({
      id: r.a.id,
      body: r.a.body,
      bodyOriginal: r.a.correction === 'none' ? null : r.a.bodyOriginal,
      correction: r.a.correction,
      voiceMediaId: r.a.voiceMediaId,
      voice: voiceOf(r.a.voiceMediaId),
      helpfulCount: r.a.helpfulCount,
      votedByMe: r.voted === true || r.voted === 't',
      isBest: q.bestAnswerId === r.a.id,
      mine: r.a.authorId === me.id,
      author: { ...r.author, handle: r.author.handle },
      parts: parts
        .filter((p) => p.answerId === r.a.id)
        .map(({ productId, slug, name, nameHi }) => ({ productId, slug, name, nameHi })),
      createdAt: r.a.createdAt.toISOString(),
    }))
    .sort((x, y) => Number(y.isBest) - Number(x.isBest));
  const open = q.status === 'open' || q.status === 'answered';
  return {
    ...cardOf(q, { ...asker, handle: asker.handle }, 0, me.id),
    answers: answers.filter((r) => r.a.status === 'visible').length,
    body: q.body,
    bodyOriginal: q.correction === 'none' ? null : q.bodyOriginal,
    correction: q.correction,
    voiceMediaId: q.voiceMediaId,
    voice: voiceOf(q.voiceMediaId),
    bestAnswerId: q.bestAnswerId,
    vehicleModel: model?.name ?? null,
    can: {
      answer:
        open &&
        q.askerId !== me.id &&
        me.status === 'active' &&
        me.restrictedMode === 'none' &&
        (me.track === 'ustaad' || s['ustaad.qa.apprentice_can_answer'] === true),
      chooseBest: q.askerId === me.id && q.status === 'answered',
    },
    answerList: list,
  };
}
