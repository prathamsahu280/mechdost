/**
 * Ustaad Q&A and Learn repositories (spec 23 § 4 flows 4 and 12, § 7.5, § 9.1–9.2; plan tasks C1–C2): ask by voice or
 * text (idempotent, UQ code against the real CHECK), voice notes only the caller's own verified audio, the answer gate
 * by track, pending Ustaads' answers not counting for levels, one helpful vote and no self-vote, one best answer by
 * the asker only (double → 409, weekly cap), parts under the best answer, blocks hide the thread, Learn progress
 * (≥ 80 % completes a video, self-marks capped a day).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { USTAAD_QUESTION_CODE_RE } from '@mechdost/shared/ustaad/dto/qa';
import {
  answerUstaadQuestion,
  askUstaadQuestion,
  chooseUstaadBestAnswer,
  ensureUser,
  joinUstaad,
  listUstaadQuestions,
  saveUstaadSetting,
  setUstaadAnswerParts,
  syncRbacCatalogue,
  ustaadLearnView,
  ustaadQuestionDetail,
  voteUstaadAnswerHelpful,
  writeUstaadLearnProgress,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

interface M {
  userId: string;
  memberId: string;
}
let asker: M; // Chhotu (apprentice)
let ustaad: M; // verified Naya Ustaad
let pending: M; // Ustaad · to verify
let chhotu2: M; // a second apprentice
let productId = '';
let n = 0;

async function member(track: 'apprentice' | 'ustaad', level?: string, specialities = ['two_wheeler']) {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-qa-${id}`,
    phone: `+9196000${id.padStart(5, '0')}`,
    email: `ustaad-qa-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track,
      specialities: specialities as never,
      displayName: `Mistri ${id}`,
      showGarage: false,
      pincode: '492001',
      areaLabel: 'Pandri',
      yearsClaimed: 5,
      workPlace: 'shop',
      verifyMethods: [],
      consents: {
        ustaad_profile: true,
        ustaad_directory: false,
        ustaad_training: false,
        ustaad_offers: false,
      },
      turnstileToken: 'human-token-123',
    },
    { via: 'ustaad' },
  );
  if (level) await db.update(s.ustaadMembers).set({ level }).where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

async function audio(owner: string, over: Partial<typeof s.ustaadMedia.$inferInsert> = {}) {
  const [row] = await db
    .insert(s.ustaadMedia)
    .values({
      ownerMemberId: owner,
      host: 'supabase',
      bucket: 'media',
      kind: 'audio',
      status: 'verified',
      declaredBytes: 40_000,
      declaredMime: 'audio/webm',
      sha256: 'a'.repeat(64),
      durationMs: 20_000,
      objectKey: `m/${owner}/${randomUUID()}.webm`,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
      ...over,
    })
    .returning();
  if (!row) throw new Error('media');
  return row.id;
}

const key = () => `k${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const ask = (m: M, over: Record<string, unknown> = {}) =>
  askUstaadQuestion(t(), m, {
    title: 'Activa 6G pickup kam hai',
    correction: 'none',
    segmentCode: 'two_wheeler',
    workCode: 'engine',
    reach: 'city',
    hideGarage: true,
    idemKey: key(),
    ...over,
  });
const answer = (m: M, code: string, over: Record<string, unknown> = {}) =>
  answerUstaadQuestion(t(), m, code, {
    body: 'Carburettor saaf karo',
    correction: 'none',
    idemKey: key(),
    ...over,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  asker = await member('apprentice');
  ustaad = await member('ustaad', 'naya');
  pending = await member('ustaad');
  chhotu2 = await member('apprentice');
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'spark', name: 'Spark plugs', sort: 1 })
    .returning();
  const [brand] = await db.insert(s.brands).values({ slug: 'ngk', name: 'NGK' }).returning();
  const [p] = await db
    .insert(s.products)
    .values({
      slug: 'ngk-spark-plug',
      name: 'NGK spark plug',
      nameHi: 'NGK स्पार्क प्लग',
      brandId: brand?.id ?? '',
      categoryId: cat?.id ?? '',
      hsn: '8511',
      gstRateBp: 1800,
      status: 'live',
    })
    .returning();
  productId = p?.id ?? '';
});

afterAll(async () => {
  await client.close();
});

describe('ask', () => {
  it('creates an open question with a UQ code the CHECK accepts, an event and an analytics row', async () => {
    const q = await ask(asker);
    expect(q.code).toMatch(USTAAD_QUESTION_CODE_RE);
    expect(q.status).toBe('open');
    const events = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityType, 'question'), eq(s.ustaadEvents.kind, 'asked')));
    expect(events.length).toBeGreaterThan(0);
  });

  it('idempotent create: the same key returns the same question', async () => {
    const k = key();
    const a = await ask(asker, { idemKey: k });
    const b = await ask(asker, { idemKey: k });
    expect(b.code).toBe(a.code);
  });

  it('by voice only: own verified audio; the view has no title', async () => {
    const q = await ask(asker, { title: undefined, voiceMediaId: await audio(asker.memberId) });
    const d = await ustaadQuestionDetail(t(), asker, q.code);
    expect(d.title).toBeNull();
    expect(d.hasVoice).toBe(true);
  });

  it("refuses someone else's voice note, an image, unverified audio and audio over qa.voice_max_s", async () => {
    await expect(ask(asker, { voiceMediaId: await audio(ustaad.memberId) })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
    await expect(
      ask(asker, {
        voiceMediaId: await audio(asker.memberId, {
          kind: 'image',
          declaredMime: 'image/webp',
          objectKey: `m/${asker.memberId}/${randomUUID()}.webp`,
        }),
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_INVALID' });
    await expect(
      ask(asker, {
        voiceMediaId: await audio(asker.memberId, { status: 'pending_upload', bucket: 'quarantine' }),
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_INVALID' });
    await expect(
      ask(asker, { voiceMediaId: await audio(asker.memberId, { durationMs: 121_000 }) }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_INVALID' });
  });

  it('a state-wide question is refused while general.all_state is off', async () => {
    await expect(ask(asker, { reach: 'state' })).rejects.toMatchObject({ code: 'USTAAD_REGION' });
  });

  it('queues question_waiting to matching Ustaads (speciality + city), never to the asker', async () => {
    const q = await ask(asker);
    const rows = await db
      .select()
      .from(s.notifications)
      .where(eq(s.notifications.kind, 'ustaad.question_waiting'));
    const forQ = rows.filter((r) => JSON.stringify(r).includes(q.code));
    expect(forQ.map((r) => r.userId)).toContain(ustaad.userId);
    expect(forQ.map((r) => r.userId)).not.toContain(asker.userId);
  });
});

describe('answer gate and levels', () => {
  it('Chhotu → USTAAD_CANNOT_ANSWER unless qa.apprentice_can_answer', async () => {
    const q = await ask(asker);
    await expect(answer(chhotu2, q.code)).rejects.toMatchObject({ code: 'USTAAD_CANNOT_ANSWER' });
    const v1 = await saveUstaadSetting(t(), {
      key: 'ustaad.qa.apprentice_can_answer',
      value: true,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    const a = await answer(chhotu2, q.code);
    expect(a.id).toBeTruthy();
    await saveUstaadSetting(t(), {
      key: 'ustaad.qa.apprentice_can_answer',
      value: false,
      expectedVersion: v1.version,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
  });

  it('a pending Ustaad answer is stored with counts_for_levels = false; a verified one true; question → answered', async () => {
    const q = await ask(asker);
    const p = await answer(pending, q.code);
    const v = await answer(ustaad, q.code);
    const rows = await db.select().from(s.ustaadAnswers).where(eq(s.ustaadAnswers.questionId, q.id));
    expect(rows.find((r) => r.id === p.id)?.countsForLevels).toBe(false);
    expect(rows.find((r) => r.id === v.id)?.countsForLevels).toBe(true);
    const [row] = await db.select().from(s.ustaadQuestions).where(eq(s.ustaadQuestions.id, q.id));
    expect(row?.status).toBe('answered');
    const notes = await db
      .select()
      .from(s.notifications)
      .where(
        and(eq(s.notifications.kind, 'ustaad.answer_received'), eq(s.notifications.userId, asker.userId)),
      );
    expect(notes.length).toBeGreaterThan(0);
  });

  it('idempotent answer: the same key returns the same answer', async () => {
    const q = await ask(asker);
    const k = key();
    const a = await answer(ustaad, q.code, { idemKey: k });
    const b = await answer(ustaad, q.code, { idemKey: k });
    expect(b.id).toBe(a.id);
  });
});

describe('helpful votes', () => {
  it('one vote per member (a second is a no-op); no self-vote', async () => {
    const q = await ask(asker);
    const a = await answer(ustaad, q.code);
    expect(await voteUstaadAnswerHelpful(t(), asker, a.id)).toEqual({ helpfulCount: 1, voted: true });
    expect(await voteUstaadAnswerHelpful(t(), asker, a.id)).toEqual({ helpfulCount: 1, voted: false });
    await expect(voteUstaadAnswerHelpful(t(), ustaad, a.id)).rejects.toMatchObject({
      code: 'USTAAD_SELF_VOTE',
    });
    const [c] = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, ustaad.memberId));
    expect(c?.helpfulVotes).toBeGreaterThanOrEqual(1);
  });
});

describe('best answer', () => {
  it('only the asker; one best; double best → 409; question solved; event + notice', async () => {
    const q = await ask(asker);
    const a = await answer(ustaad, q.code);
    const b = await answer(pending, q.code);
    await expect(chooseUstaadBestAnswer(t(), ustaad, q.code, a.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await chooseUstaadBestAnswer(t(), asker, q.code, a.id);
    await expect(chooseUstaadBestAnswer(t(), asker, q.code, b.id)).rejects.toMatchObject({
      code: 'USTAAD_ALREADY_SOLVED',
    });
    const d = await ustaadQuestionDetail(t(), asker, q.code);
    expect(d.status).toBe('solved');
    expect(d.bestAnswerId).toBe(a.id);
    expect(d.answerList.find((x) => x.id === a.id)?.isBest).toBe(true);
    const [c] = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, ustaad.memberId));
    expect(c?.bestAnswers).toBeGreaterThanOrEqual(1);
  });

  it('an answer from another question is refused', async () => {
    const q1 = await ask(asker);
    const q2 = await ask(asker);
    const a2 = await answer(ustaad, q2.code);
    await expect(chooseUstaadBestAnswer(t(), asker, q1.code, a2.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('≤ qa.best_per_week best answers a week per asker', async () => {
    const m = await member('apprentice');
    for (let i = 0; i < 5; i += 1) {
      const q = await ask(m);
      const a = await answer(ustaad, q.code);
      await chooseUstaadBestAnswer(t(), m, q.code, a.id);
    }
    const q = await ask(m);
    const a = await answer(ustaad, q.code);
    await expect(chooseUstaadBestAnswer(t(), m, q.code, a.id)).rejects.toMatchObject({
      code: 'USTAAD_WEEKLY_CAP',
    });
  });
});

describe('parts used in this fix', () => {
  it('the best answer author links ≤ 5 live products; others are refused; the view shows them', async () => {
    const q = await ask(asker);
    const a = await answer(ustaad, q.code);
    await expect(setUstaadAnswerParts(t(), ustaad, a.id, [productId])).rejects.toMatchObject({
      code: 'USTAAD_NOT_BEST',
    });
    await chooseUstaadBestAnswer(t(), asker, q.code, a.id);
    await expect(setUstaadAnswerParts(t(), asker, a.id, [productId])).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await setUstaadAnswerParts(t(), ustaad, a.id, [productId]);
    const d = await ustaadQuestionDetail(t(), chhotu2, q.code);
    expect(d.answerList.find((x) => x.id === a.id)?.parts.map((p) => p.slug)).toEqual(['ngk-spark-plug']);
    await expect(setUstaadAnswerParts(t(), ustaad, a.id, [randomUUID()])).rejects.toMatchObject({
      code: 'USTAAD_PART_INVALID',
    });
  });
});

describe('reads', () => {
  it('a blocked member gets 404 on the thread and never sees it in lists; no phone anywhere', async () => {
    const q = await ask(asker);
    await db.insert(s.ustaadBlocks).values({ memberId: asker.memberId, targetId: chhotu2.memberId });
    await expect(ustaadQuestionDetail(t(), chhotu2, q.code)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const list = await listUstaadQuestions(t(), chhotu2, { filter: 'all', limit: 30 });
    expect(list.items.map((x) => x.code)).not.toContain(q.code);
    const mine = await listUstaadQuestions(t(), asker, { filter: 'mine', limit: 30 });
    expect(mine.items.every((x) => x.mine)).toBe(true);
    expect(JSON.stringify(mine)).not.toContain('+91');
    await db.delete(s.ustaadBlocks).where(eq(s.ustaadBlocks.memberId, asker.memberId));
  });

  it('unanswered filter lists only open questions; the cursor never repeats', async () => {
    const page1 = await listUstaadQuestions(t(), ustaad, { filter: 'unanswered', limit: 2 });
    expect(page1.items.every((x) => x.status === 'open')).toBe(true);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listUstaadQuestions(t(), ustaad, {
      filter: 'unanswered',
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    const codes = new Set(page1.items.map((x) => x.code));
    expect(page2.items.some((x) => codes.has(x.code))).toBe(false);
  });
});

describe('learn', () => {
  let video = '';
  let link = '';
  beforeAll(async () => {
    const [course] = await db
      .insert(s.ustaadCourses)
      .values({
        code: 'how_to_use',
        titleEn: 'How to use Ustaad Network',
        titleHi: 'उस्ताद नेटवर्क कैसे चलाएँ',
      })
      .returning();
    const media = await audio(ustaad.memberId, {
      kind: 'video',
      declaredMime: 'video/mp4',
      declaredBytes: 2_000_000,
      objectKey: `m/${ustaad.memberId}/${randomUUID()}.mp4`,
    });
    const rows = await db
      .insert(s.ustaadLearningResources)
      .values([
        {
          courseId: course?.id ?? null,
          kind: 'hosted_video',
          titleEn: 'Ask by voice',
          titleHi: 'बोलकर पूछो',
          durationS: 100,
          mediaId: media,
          label: 'mechdost_training',
        },
        {
          kind: 'external_link',
          titleEn: 'Spark plug basics',
          titleHi: 'स्पार्क प्लग की बातें',
          url: 'https://example.com/x',
        },
      ])
      .returning();
    video = rows[0]?.id ?? '';
    link = rows[1]?.id ?? '';
  });

  it('a hosted video completes at ≥ 80 % watched; watched seconds never go down', async () => {
    expect((await writeUstaadLearnProgress(t(), asker, video, { watchedSeconds: 79 })).completed).toBe(false);
    expect((await writeUstaadLearnProgress(t(), asker, video, { watchedSeconds: 10 })).watchedSeconds).toBe(
      79,
    );
    expect((await writeUstaadLearnProgress(t(), asker, video, { watchedSeconds: 80 })).completed).toBe(true);
    const [c] = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, asker.memberId));
    expect(c?.videosWatched).toBe(1);
    // A replay after completion does not count twice.
    await writeUstaadLearnProgress(t(), asker, video, { watchedSeconds: 100 });
    const [c2] = await db
      .select()
      .from(s.ustaadMemberCounters)
      .where(eq(s.ustaadMemberCounters.memberId, asker.memberId));
    expect(c2?.videosWatched).toBe(1);
  });

  it('a self mark only for external links; hosted videos need watched seconds', async () => {
    await expect(writeUstaadLearnProgress(t(), asker, video, { selfMark: true })).rejects.toMatchObject({
      code: 'USTAAD_LEARN_KIND',
    });
    expect((await writeUstaadLearnProgress(t(), asker, link, { selfMark: true })).completed).toBe(true);
  });

  it('self marks are capped at learn.self_mark_daily_cap a day', async () => {
    const extra = await db
      .insert(s.ustaadLearningResources)
      .values(
        Array.from({ length: 6 }, (_, i) => ({
          kind: 'external_link',
          titleEn: `Link ${String(i)}`,
          titleHi: `लिंक ${String(i)}`,
          url: `https://example.com/${String(i)}`,
        })),
      )
      .returning();
    const m = await member('apprentice');
    for (const r of extra.slice(0, 5)) await writeUstaadLearnProgress(t(), m, r.id, { selfMark: true });
    await expect(
      writeUstaadLearnProgress(t(), m, extra[5]?.id ?? '', { selfMark: true }),
    ).rejects.toMatchObject({
      code: 'USTAAD_DAILY_CAP',
    });
  });

  it('the Learn view lists courses with Hindi titles, the training label and my progress', async () => {
    const v = await ustaadLearnView(t(), asker);
    const course = v.courses.find((c) => c.code === 'how_to_use');
    expect(course?.titleHi).toBe('उस्ताद नेटवर्क कैसे चलाएँ');
    expect(course?.resources[0]).toMatchObject({ label: 'mechdost_training', completed: true });
    expect(v.loose.length).toBeGreaterThan(0);
  });
});
