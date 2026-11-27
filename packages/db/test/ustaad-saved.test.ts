/**
 * Saved beyond posts and collections (spec 23 § 5 Saved; design 2026-11-28-mechanic-network-saved-design.md).
 * Questions, answers, jobs and lessons save idempotently; the list mixes every kind newest first with a kind filter,
 * a collection filter and a text search; collections are the member's own (404 for anyone else's), names are unique
 * per member regardless of case, at most 20, renamed with the version; an unsave drops the item from its collections.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  addToUstaadSaveCollection,
  answerUstaadQuestion,
  askUstaadQuestion,
  createUstaadPost,
  createUstaadSaveCollection,
  deleteUstaadSaveCollection,
  ensureUser,
  joinUstaad,
  listUstaadSavedItems,
  removeFromUstaadSaveCollection,
  renameUstaadSaveCollection,
  saveUstaadItem,
  syncRbacCatalogue,
  unsaveUstaadItem,
  ustaadSavedSummary,
  type Tx,
} from '../src/repo';
import { ConflictError, NotFoundError, ValidationError } from '../src/repo/errors';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

vi.mock('../src/repo/ustaad/moderation', () => ({
  screenUstaadContent: () => Promise.resolve('ok'),
  openUstaadAutoHoldReport: () => Promise.resolve(null),
}));

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

interface M {
  userId: string;
  memberId: string;
}
let n = 0;
let ramesh: M;
let suresh: M;
const OLD = new Date(Date.now() - 60 * 86_400_000);
const key = () => `k${randomUUID().replace(/-/g, '').slice(0, 20)}`;

async function member(): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-saved-${id}`,
    phone: `+9196100${id.padStart(5, '0')}`,
    email: `ustaad-saved-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler'] as never,
      displayName: `Saver ${id}`,
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
  await db.update(s.ustaadMembers).set({ joinedAt: OLD }).where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

let postId = '';
let questionId = '';
let questionCode = '';
let answerId = '';
let jobId = '';
let lessonId = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  ramesh = await member();
  suresh = await member();
  const p = await createUstaadPost(t(), ramesh, {
    kind: 'text',
    body: 'Splendor wiring: blue wire goes to the horn relay',
    correction: 'none',
    media: [],
    tags: [],
    idemKey: key(),
  });
  postId = p.id;
  const q = await askUstaadQuestion(t(), ramesh, {
    title: 'Activa 6G pickup kam hai',
    correction: 'none',
    segmentCode: 'two_wheeler',
    workCode: 'engine',
    reach: 'city',
    hideGarage: true,
    idemKey: key(),
  });
  questionId = q.id;
  questionCode = q.code;
  const a = await answerUstaadQuestion(t(), suresh, q.code, {
    body: 'Carburettor saaf karo, part price 450',
    correction: 'none',
    idemKey: key(),
  });
  answerId = a.id;
  const ws = await addWorkshop(db, f);
  const [job] = await db
    .insert(s.ustaadJobs)
    .values({
      code: 'UJ-RPR-2026-SAVEJB',
      employerMemberId: ramesh.memberId,
      workshopId: ws.id,
      cityId: f.raipur,
      areaLabel: 'Pandri',
      roleCode: 'helper',
      title: 'Helper wanted for bike garage',
      description: 'Helper for the garage, full day.',
      payMinPaiseMonth: 800_000,
      payMaxPaiseMonth: 1_000_000,
      timing: '9 to 7',
      adultAttestedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      status: 'open',
    })
    .returning();
  jobId = job?.id ?? '';
  const [lesson] = await db
    .insert(s.ustaadLearningResources)
    .values({
      kind: 'external_link',
      titleEn: 'Spark plug basics',
      titleHi: 'स्पार्क प्लग की बातें',
      url: 'https://example.com/x',
    })
    .returning();
  lessonId = lesson?.id ?? '';
});

afterAll(async () => {
  await client.close();
});

describe('save every kind', () => {
  it('saves a post, question, answer, job and lesson (repeat changes nothing); lists them newest first', async () => {
    for (const [kind, id] of [
      ['post', postId],
      ['question', questionId],
      ['answer', answerId],
      ['job', jobId],
      ['lesson', lessonId],
    ] as const) {
      expect(await saveUstaadItem(t(), suresh, { kind, id })).toEqual({ saved: true });
      expect(await saveUstaadItem(t(), suresh, { kind, id })).toEqual({ saved: true });
    }
    const page = await listUstaadSavedItems(t(), suresh, { limit: 20 });
    expect(page.items.map((i) => i.kind)).toEqual(['lesson', 'job', 'answer', 'question', 'post']);
    const lesson = page.items[0];
    expect(lesson?.text).toBe('Spark plug basics');
    expect(lesson?.textHi).toBe('स्पार्क प्लग की बातें');
    expect(page.items.find((i) => i.kind === 'answer')?.code).toBe(questionCode);
    expect(page.items.find((i) => i.kind === 'job')?.code).toBe('UJ-RPR-2026-SAVEJB');
    const summary = await ustaadSavedSummary(t(), suresh);
    expect(summary.total).toBe(5);
    expect(summary.counts).toEqual({ post: 1, question: 1, answer: 1, job: 1, lesson: 1 });
  });

  it('filters by kind, searches the words, pages with a cursor', async () => {
    const jobs = await listUstaadSavedItems(t(), suresh, { kind: 'job', limit: 20 });
    expect(jobs.items.map((i) => i.id)).toEqual([jobId]);
    const found = await listUstaadSavedItems(t(), suresh, { q: 'WIRING', limit: 20 });
    expect(found.items.map((i) => i.id)).toEqual([postId]);
    const first = await listUstaadSavedItems(t(), suresh, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await listUstaadSavedItems(t(), suresh, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.items.map((i) => i.kind)).toEqual(['answer', 'question']);
  });

  it('a removed question and an unknown id are 404; a removed item drops out of the list', async () => {
    await expect(saveUstaadItem(t(), suresh, { kind: 'question', id: randomUUID() })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(saveUstaadItem(t(), suresh, { kind: 'lesson', id: randomUUID() })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await db.update(s.ustaadJobs).set({ status: 'removed' }).where(eq(s.ustaadJobs.id, jobId));
    const page = await listUstaadSavedItems(t(), suresh, { limit: 20 });
    expect(page.items.map((i) => i.kind)).not.toContain('job');
    await db.update(s.ustaadJobs).set({ status: 'open' }).where(eq(s.ustaadJobs.id, jobId));
  });

  it('nobody else sees my saves', async () => {
    const page = await listUstaadSavedItems(t(), ramesh, { limit: 20 });
    expect(page.items).toEqual([]);
  });
});

describe('collections', () => {
  it('create, case-insensitive unique name, rename with the version, 404 for another member', async () => {
    const c = await createUstaadSaveCollection(t(), suresh, 'Wiring');
    expect(c.name).toBe('Wiring');
    await expect(createUstaadSaveCollection(t(), suresh, ' wiring ')).rejects.toBeInstanceOf(ConflictError);
    const renamed = await renameUstaadSaveCollection(t(), suresh, c.id, {
      name: 'Wiring diagrams',
      version: 1,
    });
    expect(renamed.version).toBe(2);
    await expect(
      renameUstaadSaveCollection(t(), suresh, c.id, { name: 'Old', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      renameUstaadSaveCollection(t(), ramesh, c.id, { name: 'Mine', version: 2 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteUstaadSaveCollection(t(), ramesh, c.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('only saved items go in; filter by collection; unsave takes it out; delete keeps the saves', async () => {
    const c = await createUstaadSaveCollection(t(), suresh, 'Part prices');
    await expect(
      addToUstaadSaveCollection(t(), ramesh, c.id, { kind: 'post', id: postId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const other = await createUstaadSaveCollection(t(), ramesh, 'Tips');
    await expect(
      addToUstaadSaveCollection(t(), suresh, other.id, { kind: 'post', id: postId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await addToUstaadSaveCollection(t(), suresh, c.id, { kind: 'answer', id: answerId });
    await addToUstaadSaveCollection(t(), suresh, c.id, { kind: 'answer', id: answerId });
    await addToUstaadSaveCollection(t(), suresh, c.id, { kind: 'post', id: postId });
    const inC = await listUstaadSavedItems(t(), suresh, { collectionId: c.id, limit: 20 });
    expect(inC.items.map((i) => i.kind)).toEqual(['answer', 'post']);
    expect(inC.items[0]?.collectionIds).toContain(c.id);
    await removeFromUstaadSaveCollection(t(), suresh, c.id, { kind: 'post', id: postId });
    await unsaveUstaadItem(t(), suresh, { kind: 'answer', id: answerId });
    expect((await listUstaadSavedItems(t(), suresh, { collectionId: c.id, limit: 20 })).items).toEqual([]);
    const summary = await ustaadSavedSummary(t(), suresh);
    expect(summary.collections.find((x) => x.id === c.id)?.count).toBe(0);
    await deleteUstaadSaveCollection(t(), suresh, c.id);
    expect((await ustaadSavedSummary(t(), suresh)).total).toBe(4);
    await expect(listUstaadSavedItems(t(), suresh, { collectionId: c.id, limit: 20 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('at most 20 collections', async () => {
    const m = await member();
    for (let i = 0; i < 20; i += 1) await createUstaadSaveCollection(t(), m, `C${i}`);
    await expect(createUstaadSaveCollection(t(), m, 'One more')).rejects.toBeInstanceOf(ValidationError);
  });
});
