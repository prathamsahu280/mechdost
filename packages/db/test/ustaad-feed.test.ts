/**
 * Ustaad feed repositories (spec 23 § 4 flows 4–6, § 6.3, § 6.9, § 7.4, § 9.5, § 10 step 5–6, § 10a; plan tasks D1–D2):
 * posts of every kind with owned, verified media within caps; curated tags (aliases, merges, ≤ max); types switched
 * off; `posts.per_day`; links from new accounts; content screen → held; restricted members read only; likes, saves
 * and comments as idempotent rows + conditional counters (never negative); one-level replies; blocks hide everything
 * (SR-35), mutes hide in lists; stories (30-day gate, 24 h expiry in reads and in media signing, "seen by" for the
 * owner only, expiry job); For you ranking from settings weights and the Following keyset tab; share and teaser;
 * link previews stored by URL hash. PGlite is one connection: the real-Postgres race suite is not part of this file.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { CreatePost } from '@mechdost/shared/ustaad/dto/feed';
import {
  commentOnUstaadPost,
  createUstaadPost,
  createUstaadStory,
  deleteUstaadComment,
  deleteUstaadPost,
  ensureUser,
  expireUstaadStories,
  followUstaadTag,
  joinUstaad,
  likeUstaadPost,
  listUstaadComments,
  listUstaadFollowingFeed,
  listUstaadSaved,
  listUstaadStories,
  searchUstaadTags,
  readableUstaadMedia,
  saveUstaadLinkPreview,
  saveUstaadPost,
  shareUstaadPost,
  syncRbacCatalogue,
  unlikeUstaadPost,
  unsaveUstaadPost,
  ustaadForYouIds,
  ustaadLinkPreviewNeeded,
  ustaadPostDetail,
  ustaadPostsByIds,
  ustaadTagPage,
  ustaadTeaserVisible,
  viewUstaadStory,
  voteUstaadPoll,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

const screen = vi.hoisted((): { outcome: 'ok' | 'hold' | 'block' } => ({ outcome: 'ok' }));
vi.mock('../src/repo/ustaad/moderation', () => ({
  // Holds any text with the test word, so tests prove which fields reach the screen.
  screenUstaadContent: (_tx: unknown, input: { text: string | null }) =>
    Promise.resolve(input.text?.includes('PAYFEE') ? 'hold' : screen.outcome),
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
let ramesh: M; // author
let suresh: M; // viewer
let mohan: M; // third member
const OLD = new Date(Date.now() - 60 * 86_400_000);

async function member(over: Partial<typeof s.ustaadMembers.$inferInsert> = {}): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-feed-${id}`,
    phone: `+9197000${id.padStart(5, '0')}`,
    email: `ustaad-feed-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler'] as never,
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
  await db
    .update(s.ustaadMembers)
    .set({ joinedAt: OLD, ...over })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

const EXT = { image: 'webp', audio: 'webm', video: 'mp4', document: 'pdf' } as const;
const MIME = {
  image: 'image/webp',
  audio: 'audio/webm',
  video: 'video/mp4',
  document: 'application/pdf',
} as const;
async function media(
  owner: string,
  kind: keyof typeof EXT,
  over: Partial<typeof s.ustaadMedia.$inferInsert> = {},
): Promise<string> {
  const bucket = kind === 'document' ? 'docs' : 'media';
  const [row] = await db
    .insert(s.ustaadMedia)
    .values({
      ownerMemberId: owner,
      host: 'supabase',
      bucket,
      kind,
      status: 'verified',
      declaredBytes: 40_000,
      declaredMime: MIME[kind],
      sha256: 'a'.repeat(64),
      durationMs: kind === 'audio' || kind === 'video' ? 20_000 : null,
      width: kind === 'image' ? 1080 : null,
      height: kind === 'image' ? 720 : null,
      objectKey: `${bucket === 'docs' ? 'd' : 'm'}/${owner}/${randomUUID()}.${EXT[kind]}`,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
      ...over,
    })
    .returning();
  if (!row) throw new Error('media');
  return row.id;
}

async function setSetting(key: string, value: unknown) {
  await db
    .insert(s.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: [s.settings.cityId, s.settings.key], set: { value } });
}
const resetSettings = () => db.delete(s.settings).where(sql`${s.settings.key} like 'ustaad.%'`);

const key = () => `k${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const post = (m: M, over: Partial<CreatePost> = {}) =>
  createUstaadPost(t(), m, {
    kind: 'text',
    body: 'Splendor ka self nahi chal raha tha, brush badla',
    correction: 'none',
    media: [],
    tags: [],
    idemKey: key(),
    ...over,
  });

let batteryTag = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  ramesh = await member();
  suresh = await member();
  mohan = await member();
  const [battery] = await db
    .insert(s.ustaadTags)
    .values({
      slug: 'battery',
      nameEn: 'Battery',
      nameHi: 'बैटरी',
      group: 'part',
      aliases: ['battri', 'betri'],
    })
    .returning();
  batteryTag = battery?.id ?? '';
  const [clutch] = await db
    .insert(s.ustaadTags)
    .values({ slug: 'clutchplate', nameEn: 'Clutch plate', nameHi: 'क्लच प्लेट', group: 'part' })
    .returning();
  await db.insert(s.ustaadTags).values([
    { slug: 'selfstart', nameEn: 'Self start', nameHi: 'सेल्फ स्टार्ट', group: 'repair' },
    { slug: 'mileage', nameEn: 'Mileage', nameHi: 'माइलेज', group: 'repair' },
    {
      slug: 'oldclutch',
      nameEn: 'Old clutch',
      nameHi: 'पुराना क्लच',
      group: 'part',
      mergedIntoId: clutch?.id ?? null,
    },
    { slug: 'retired', nameEn: 'Retired', nameHi: 'बंद', group: 'tool', active: false },
  ]);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  screen.outcome = 'ok';
  await resetSettings();
  // The fixture members post far more than a mechanic's day; the cap itself is tested with a fresh member.
  await setSetting('ustaad.posts.per_day', 100);
});

describe('create post', () => {
  it('a text post is visible with a counter row, an event and an analytics row; same key → same post', async () => {
    const k = key();
    const a = await post(ramesh, { idemKey: k });
    const b = await post(ramesh, { idemKey: k });
    expect(a.id).toBe(b.id);
    expect(a.status).toBe('visible');
    const [c] = await db.select().from(s.ustaadPostCounters).where(eq(s.ustaadPostCounters.postId, a.id));
    expect(c?.likes).toBe(0);
    const ev = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, a.id), eq(s.ustaadEvents.kind, 'created')));
    expect(ev).toHaveLength(1);
    const view = await ustaadPostDetail(t(), suresh, a.id);
    expect(view.author.displayName).toMatch(/^Mistri/);
    expect(JSON.stringify(view)).not.toMatch(/\+91/);
  });

  it('photos: owned + verified + within posts.max_photos; foreign, unverified and reused media refused', async () => {
    await setSetting('ustaad.posts.max_photos', 2);
    const p1 = await media(ramesh.memberId, 'image');
    const p2 = await media(ramesh.memberId, 'image');
    const ok = await post(ramesh, {
      kind: 'photo',
      body: undefined,
      media: [{ mediaId: p1 }, { mediaId: p2 }],
    });
    expect(ok.status).toBe('visible');
    const view = await ustaadPostDetail(t(), suresh, ok.id);
    expect(view.media.map((m) => m.mediaId)).toEqual([p1, p2]);
    const three = await Promise.all([1, 2, 3].map(() => media(ramesh.memberId, 'image')));
    await expect(
      post(ramesh, { kind: 'photo', body: undefined, media: three.map((mediaId) => ({ mediaId })) }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_LIMIT' });
    const foreign = await media(suresh.memberId, 'image');
    await expect(post(ramesh, { kind: 'photo', media: [{ mediaId: foreign }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
    const pending = await media(ramesh.memberId, 'image', { status: 'uploaded' });
    await expect(post(ramesh, { kind: 'photo', media: [{ mediaId: pending }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
    await expect(post(ramesh, { kind: 'photo', media: [{ mediaId: p1 }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
  });

  it('voice = one audio; video within posts.video_max_s (+ a poster); document = one PDF; mixed = photo + voice', async () => {
    const a = await media(ramesh.memberId, 'audio');
    expect((await post(ramesh, { kind: 'voice', body: undefined, media: [{ mediaId: a }] })).status).toBe(
      'visible',
    );
    const img = await media(ramesh.memberId, 'image');
    await expect(post(ramesh, { kind: 'voice', media: [{ mediaId: img }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
    await setSetting('ustaad.posts.video_max_s', 30);
    const long = await media(ramesh.memberId, 'video', { durationMs: 31_000 });
    await expect(post(ramesh, { kind: 'video', media: [{ mediaId: long }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_TOO_LONG',
    });
    const vid = await media(ramesh.memberId, 'video', { durationMs: 29_000 });
    const poster = await media(ramesh.memberId, 'image');
    expect(
      (await post(ramesh, { kind: 'video', media: [{ mediaId: vid }, { mediaId: poster }] })).status,
    ).toBe('visible');
    const pdf = await media(ramesh.memberId, 'document');
    expect((await post(ramesh, { kind: 'document', media: [{ mediaId: pdf }] })).status).toBe('visible');
    const p = await media(ramesh.memberId, 'image');
    const v = await media(ramesh.memberId, 'audio');
    expect((await post(ramesh, { kind: 'mixed', media: [{ mediaId: p }, { mediaId: v }] })).status).toBe(
      'visible',
    );
    const lone = await media(ramesh.memberId, 'image');
    await expect(post(ramesh, { kind: 'mixed', media: [{ mediaId: lone }] })).rejects.toMatchObject({
      code: 'USTAAD_MEDIA_INVALID',
    });
  });

  it('templates: fix log fields and before/after roles are stored and shown', async () => {
    const fix = await post(ramesh, {
      template: 'fix_log',
      body: undefined,
      fixSymptom: 'Self nahi chal raha',
      fixCause: 'Brush ghis gaya',
      fixFix: 'Brush badla',
    });
    const fv = await ustaadPostDetail(t(), suresh, fix.id);
    expect(fv.fix).toEqual({ symptom: 'Self nahi chal raha', cause: 'Brush ghis gaya', fix: 'Brush badla' });
    const b = await media(ramesh.memberId, 'image');
    const a = await media(ramesh.memberId, 'image');
    const ba = await post(ramesh, {
      kind: 'photo',
      template: 'before_after',
      body: undefined,
      media: [
        { mediaId: b, role: 'before' },
        { mediaId: a, role: 'after' },
      ],
    });
    const bv = await ustaadPostDetail(t(), suresh, ba.id);
    expect(bv.media.map((m) => m.role)).toEqual(['before', 'after']);
  });

  it('a type switched off is refused; posts.per_day caps a member', async () => {
    await setSetting('ustaad.posts.types.poll', false);
    await expect(
      post(mohan, { kind: 'poll', poll: { options: ['Castrol', 'Servo'], closesInHours: 24 } }),
    ).rejects.toMatchObject({ code: 'USTAAD_POST_TYPE_OFF' });
    await setSetting('ustaad.posts.per_day', 1);
    const fresh = await member();
    await post(fresh);
    await expect(post(fresh)).rejects.toMatchObject({ code: 'USTAAD_DAILY_CAP' });
  });

  it('links: accounts younger than mod.links_min_account_days and deny-listed domains refused', async () => {
    const young = await member({ joinedAt: new Date() });
    await expect(
      post(young, { kind: 'link', body: undefined, linkUrl: 'https://example.com/a' }),
    ).rejects.toMatchObject({ code: 'USTAAD_LINKS_LOCKED' });
    await db
      .insert(s.ustaadWordLists)
      .values({ list: 'link_domain', phrase: 'evil.com', phraseNorm: 'evil.com' });
    await expect(
      post(ramesh, { kind: 'link', body: undefined, linkUrl: 'https://www.evil.com/win' }),
    ).rejects.toMatchObject({ code: 'USTAAD_LINK_BLOCKED' });
    const ok = await post(ramesh, { kind: 'link', body: undefined, linkUrl: 'https://example.com/a' });
    expect(ok.linkUrl).toBe('https://example.com/a');
    const view = await ustaadPostDetail(t(), suresh, ok.id);
    expect(view.link).toEqual({ url: 'https://example.com/a', host: 'example.com', preview: null });
  });

  it('tags: slug, Hindi name or alias; merged tags resolve; unknown, inactive and over the cap refused', async () => {
    const ok = await post(ramesh, { tags: ['battri', 'oldclutch'] });
    const view = await ustaadPostDetail(t(), suresh, ok.id);
    expect(view.tags.map((x) => x.slug).sort()).toEqual(['battery', 'clutchplate']);
    const hindi = await post(ramesh, { tags: ['बैटरी'] });
    expect((await ustaadPostDetail(t(), suresh, hindi.id)).tags.map((x) => x.slug)).toEqual(['battery']);
    await expect(post(ramesh, { tags: ['retired'] })).rejects.toMatchObject({ code: 'USTAAD_TAG_UNKNOWN' });
    await expect(post(ramesh, { tags: ['nosuchtag'] })).rejects.toMatchObject({ code: 'USTAAD_TAG_UNKNOWN' });
    await setSetting('ustaad.tags.max_per_post', 2);
    await expect(post(ramesh, { tags: ['battery', 'selfstart', 'mileage'] })).rejects.toMatchObject({
      code: 'USTAAD_TAG_LIMIT',
    });
    // Two spellings of the same tag count once.
    const same = await post(ramesh, { tags: ['battery', 'battri'] });
    expect((await ustaadPostDetail(t(), suresh, same.id)).tags).toHaveLength(1);
  });

  it('a held post is invisible to others and shown to its author as held', async () => {
    screen.outcome = 'hold';
    const p = await post(ramesh);
    expect(p.status).toBe('held');
    await expect(ustaadPostDetail(t(), suresh, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    expect((await ustaadPostDetail(t(), ramesh, p.id)).status).toBe('held');
  });

  it('the original words are screened too (a clean body cannot carry an abusive "see original")', async () => {
    const p = await post(ramesh, {
      body: 'Clean words',
      bodyOriginal: 'PAYFEE to 98xxxx',
      correction: 'auto',
    });
    expect(p.status).toBe('held');
    const target = await post(ramesh);
    const c = await commentOnUstaadPost(t(), suresh, target.id, {
      body: 'Clean reply',
      bodyOriginal: 'PAYFEE now',
      correction: 'suggested_used',
      idemKey: key(),
    });
    expect(c.status).toBe('held');
    // Without a correction the original is never stored, even if a caller skips the DTO.
    const raw = await post(ramesh, { body: 'Clean', bodyOriginal: 'ignored', correction: 'none' });
    const [row] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, raw.id));
    expect(row?.bodyOriginal).toBeNull();
  });

  it('a restricted member reads but cannot post, like or comment', async () => {
    const r = await member({ restrictedMode: 'review' });
    const visible = await post(ramesh);
    await expect(post(r)).rejects.toMatchObject({ code: 'USTAAD_RESTRICTED' });
    await expect(likeUstaadPost(t(), r, visible.id)).rejects.toMatchObject({ code: 'USTAAD_RESTRICTED' });
    await expect(
      commentOnUstaadPost(t(), r, visible.id, { body: 'x', correction: 'none', idemKey: key() }),
    ).rejects.toMatchObject({ code: 'USTAAD_RESTRICTED' });
    expect((await ustaadPostDetail(t(), r, visible.id)).id).toBe(visible.id);
  });

  it('the author hides their own post; nobody else can', async () => {
    const p = await post(ramesh);
    await expect(deleteUstaadPost(t(), suresh, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    expect((await deleteUstaadPost(t(), ramesh, p.id)).status).toBe('hidden_author');
    await expect(ustaadPostDetail(t(), suresh, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('likes, saves, shares, polls', () => {
  it('double like counts once; unlike never goes below zero; a daily likes digest to the author only', async () => {
    const p = await post(ramesh);
    expect(await likeUstaadPost(t(), suresh, p.id)).toEqual({ liked: true, likes: 1 });
    expect(await likeUstaadPost(t(), suresh, p.id)).toEqual({ liked: true, likes: 1 });
    expect(await likeUstaadPost(t(), mohan, p.id)).toEqual({ liked: true, likes: 2 });
    expect(await unlikeUstaadPost(t(), suresh, p.id)).toEqual({ liked: false, likes: 1 });
    expect(await unlikeUstaadPost(t(), suresh, p.id)).toEqual({ liked: false, likes: 1 });
    await unlikeUstaadPost(t(), mohan, p.id);
    expect(await unlikeUstaadPost(t(), mohan, p.id)).toEqual({ liked: false, likes: 0 });
    const notes = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.userId, ramesh.userId), eq(s.notifications.kind, 'ustaad.likes_digest')));
    expect(notes.length).toBeGreaterThanOrEqual(1);
    const own = await post(suresh);
    await likeUstaadPost(t(), suresh, own.id);
    const self = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.userId, suresh.userId), eq(s.notifications.kind, 'ustaad.likes_digest')));
    expect(self).toHaveLength(0);
  });

  it('likes never touch Izzat; feed.show_like_counts off hides the number', async () => {
    const p = await post(ramesh);
    await likeUstaadPost(t(), suresh, p.id);
    const izzat = await db
      .select()
      .from(s.ustaadIzzatLedger)
      .where(eq(s.ustaadIzzatLedger.memberId, ramesh.memberId));
    expect(izzat).toHaveLength(0);
    await setSetting('ustaad.feed.show_like_counts', false);
    expect((await likeUstaadPost(t(), mohan, p.id)).likes).toBeNull();
    expect((await ustaadPostDetail(t(), suresh, p.id)).counts.likes).toBeNull();
  });

  it('save / unsave are idempotent and the Saved list shows saved posts newest first', async () => {
    const a = await post(ramesh);
    const b = await post(ramesh);
    await saveUstaadPost(t(), suresh, a.id);
    await saveUstaadPost(t(), suresh, a.id);
    await saveUstaadPost(t(), suresh, b.id);
    const page = await listUstaadSaved(t(), suresh, { limit: 20 });
    expect(page.items.map((x) => x.id).slice(0, 2)).toEqual([b.id, a.id]);
    expect(page.items[0]?.savedByMe).toBe(true);
    await unsaveUstaadPost(t(), suresh, b.id);
    await unsaveUstaadPost(t(), suresh, b.id);
    const [c] = await db.select().from(s.ustaadPostCounters).where(eq(s.ustaadPostCounters.postId, b.id));
    expect(c?.saves).toBe(0);
    // The author sees the save count; others do not.
    expect((await ustaadPostDetail(t(), ramesh, a.id)).counts.saves).toBe(1);
    expect((await ustaadPostDetail(t(), suresh, a.id)).counts.saves).toBeNull();
  });

  it('share counts and the teaser is visible only for a live post', async () => {
    const p = await post(ramesh);
    await shareUstaadPost(t(), suresh, p.id, 'whatsapp');
    const [c] = await db.select().from(s.ustaadPostCounters).where(eq(s.ustaadPostCounters.postId, p.id));
    expect(c?.shares).toBe(1);
    expect(await ustaadTeaserVisible(t(), p.id)).toBe(true);
    await deleteUstaadPost(t(), ramesh, p.id);
    expect(await ustaadTeaserVisible(t(), p.id)).toBe(false);
    expect(await ustaadTeaserVisible(t(), randomUUID())).toBe(false);
  });

  it('one vote per member per poll; a closed poll refuses votes', async () => {
    const p = await post(ramesh, {
      kind: 'poll',
      body: 'Kaunsa engine oil?',
      poll: { options: ['Castrol', 'Servo'], closesInHours: 24 },
    });
    const view = await ustaadPostDetail(t(), suresh, p.id);
    const poll = view.poll;
    if (!poll) throw new Error('poll');
    const [castrol, servo] = poll.options;
    if (!castrol || !servo) throw new Error('options');
    await voteUstaadPoll(t(), suresh, poll.id, castrol.id);
    await voteUstaadPoll(t(), suresh, poll.id, castrol.id);
    await expect(voteUstaadPoll(t(), suresh, poll.id, servo.id)).rejects.toMatchObject({
      code: 'USTAAD_ALREADY_VOTED',
    });
    const after = await ustaadPostDetail(t(), mohan, p.id);
    expect(after.poll?.options.map((o) => o.votes)).toEqual([1, 0]);
    expect((await ustaadPostDetail(t(), suresh, p.id)).poll?.myOptionId).toBe(castrol.id);
    await db
      .update(s.ustaadPolls)
      .set({ closesAt: new Date(Date.now() - 1000) })
      .where(eq(s.ustaadPolls.id, poll.id));
    await expect(voteUstaadPoll(t(), mohan, poll.id, servo.id)).rejects.toMatchObject({
      code: 'USTAAD_POLL_CLOSED',
    });
  });
});

describe('comments', () => {
  it('comment + one level of replies; a reply to a reply is refused; counters and reply notices', async () => {
    const p = await post(ramesh);
    const c1 = await commentOnUstaadPost(t(), suresh, p.id, {
      body: 'Sahi kaha',
      correction: 'none',
      idemKey: key(),
    });
    const r1 = await commentOnUstaadPost(t(), mohan, p.id, {
      body: 'Haan',
      correction: 'none',
      parentId: c1.id,
      idemKey: key(),
    });
    await expect(
      commentOnUstaadPost(t(), ramesh, p.id, {
        body: 'x',
        correction: 'none',
        parentId: r1.id,
        idemKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_REPLY_DEPTH' });
    const other = await post(ramesh);
    await expect(
      commentOnUstaadPost(t(), ramesh, other.id, {
        body: 'x',
        correction: 'none',
        parentId: c1.id,
        idemKey: key(),
      }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    const page = await listUstaadComments(t(), ramesh, p.id, { limit: 20 });
    expect(page.items.map((c) => c.id)).toEqual([c1.id, r1.id]);
    expect(page.items[1]?.parentId).toBe(c1.id);
    expect((await ustaadPostDetail(t(), ramesh, p.id)).counts.comments).toBe(2);
    const replies = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.kind, 'ustaad.reply'), eq(s.notifications.userId, ramesh.userId)));
    expect(replies.length).toBeGreaterThanOrEqual(1);
    const toSuresh = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.kind, 'ustaad.reply'), eq(s.notifications.userId, suresh.userId)));
    expect(toSuresh.length).toBeGreaterThanOrEqual(1);
    expect((await deleteUstaadComment(t(), mohan, r1.id)).status).toBe('hidden_author');
    expect((await ustaadPostDetail(t(), ramesh, p.id)).counts.comments).toBe(1);
    await expect(deleteUstaadComment(t(), suresh, r1.id)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('voice or photo comments must be the commenter’s own verified media; same key → same comment', async () => {
    const p = await post(ramesh);
    const v = await media(suresh.memberId, 'audio');
    const k = key();
    const a = await commentOnUstaadPost(t(), suresh, p.id, { mediaId: v, correction: 'none', idemKey: k });
    const b = await commentOnUstaadPost(t(), suresh, p.id, { mediaId: v, correction: 'none', idemKey: k });
    expect(a.id).toBe(b.id);
    const foreign = await media(mohan.memberId, 'audio');
    await expect(
      commentOnUstaadPost(t(), suresh, p.id, { mediaId: foreign, correction: 'none', idemKey: key() }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_INVALID' });
    const doc = await media(suresh.memberId, 'document');
    await expect(
      commentOnUstaadPost(t(), suresh, p.id, { mediaId: doc, correction: 'none', idemKey: key() }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_INVALID' });
    const page = await listUstaadComments(t(), ramesh, p.id, { limit: 20 });
    expect(page.items[0]?.media?.kind).toBe('audio');
    expect(await readableUstaadMedia(t(), { mediaId: v, viewerMemberId: ramesh.memberId })).not.toBeNull();
  });
});

describe('blocks and mutes (SR-35)', () => {
  it('a block either way is a 404 on the post, its like and its comments, and hides it from lists', async () => {
    const blocker = await member();
    const p = await post(blocker);
    await db.insert(s.ustaadBlocks).values({ memberId: blocker.memberId, targetId: mohan.memberId });
    await expect(ustaadPostDetail(t(), mohan, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(likeUstaadPost(t(), mohan, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(listUstaadComments(t(), mohan, p.id, { limit: 5 })).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    expect(await ustaadPostsByIds(t(), mohan, [p.id])).toEqual([]);
    const mine = await post(mohan);
    await expect(ustaadPostDetail(t(), blocker, mine.id)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('a mute hides the author from feeds but the post still opens', async () => {
    const loud = await member();
    const p = await post(loud);
    await db.insert(s.ustaadFollows).values({ followerId: suresh.memberId, followeeId: loud.memberId });
    await db.insert(s.ustaadMutes).values({ memberId: suresh.memberId, targetId: loud.memberId });
    expect(await ustaadForYouIds(t(), suresh)).not.toContain(p.id);
    const following = await listUstaadFollowingFeed(t(), suresh, { limit: 30 });
    expect(following.items.map((x) => x.id)).not.toContain(p.id);
    expect((await ustaadPostDetail(t(), suresh, p.id)).id).toBe(p.id);
  });

  it('posts of a banned, departed or restricted author leave every surface', async () => {
    const gone = await member();
    const p = await post(gone);
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'minor_report' })
      .where(eq(s.ustaadMembers.id, gone.memberId));
    await expect(ustaadPostDetail(t(), suresh, p.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await ustaadForYouIds(t(), suresh)).not.toContain(p.id);
  });
});

describe('feed', () => {
  it('For you: a followed author ranks first (settings weights); removed and story posts never appear', async () => {
    const viewer = await member();
    const star = await member();
    const stranger = await member();
    const s1 = await post(stranger);
    const f1 = await post(star);
    await db
      .update(s.ustaadPosts)
      .set({ createdAt: new Date(Date.now() - 5 * 86_400_000) })
      .where(eq(s.ustaadPosts.id, f1.id));
    await db.insert(s.ustaadFollows).values({ followerId: viewer.memberId, followeeId: star.memberId });
    const ids = await ustaadForYouIds(t(), viewer);
    expect(ids.indexOf(f1.id)).toBeLessThan(ids.indexOf(s1.id));
    // With the follows weight at 0 and recency at 45 the newer post wins.
    await setSetting('ustaad.feed.w_follows', 0);
    await setSetting('ustaad.feed.w_recency', 45);
    const again = await ustaadForYouIds(t(), viewer);
    expect(again.indexOf(s1.id)).toBeLessThan(again.indexOf(f1.id));
    const removed = await post(stranger);
    await db.update(s.ustaadPosts).set({ status: 'removed' }).where(eq(s.ustaadPosts.id, removed.id));
    expect(await ustaadForYouIds(t(), viewer)).not.toContain(removed.id);
  });

  it('posts older than feed.window_days are not candidates', async () => {
    const viewer = await member();
    const old = await post(ramesh);
    await db
      .update(s.ustaadPosts)
      .set({ createdAt: new Date(Date.now() - 20 * 86_400_000) })
      .where(eq(s.ustaadPosts.id, old.id));
    expect(await ustaadForYouIds(t(), viewer)).not.toContain(old.id);
  });

  it('Following: only followed authors, newest first, keyset pages never repeat or skip', async () => {
    const viewer = await member();
    const star = await member();
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) made.push((await post(star)).id);
    await post(mohan);
    await db.insert(s.ustaadFollows).values({ followerId: viewer.memberId, followeeId: star.memberId });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 4; i += 1) {
      const page = await listUstaadFollowingFeed(t(), viewer, { limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((x) => x.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([...made].reverse());
  });

  it('hydration keeps the snapshot order and drops posts that became invisible', async () => {
    const a = await post(ramesh);
    const b = await post(ramesh);
    const c = await post(ramesh);
    await deleteUstaadPost(t(), ramesh, b.id);
    const views = await ustaadPostsByIds(t(), suresh, [c.id, b.id, a.id]);
    expect(views.map((v) => v.id)).toEqual([c.id, a.id]);
  });
});

describe('stories', () => {
  it('accounts younger than stories.min_account_days cannot post stories', async () => {
    const young = await member({ joinedAt: new Date() });
    const m = await media(young.memberId, 'image');
    await expect(createUstaadStory(t(), young, { mediaId: m, idemKey: key() })).rejects.toMatchObject({
      code: 'USTAAD_STORIES_LOCKED',
    });
  });

  it('rings, views ("seen by" for the owner only), 24 h expiry in reads and in media signing, the expiry job', async () => {
    const author = await member();
    const viewer = await member();
    const img = await media(author.memberId, 'image');
    const st = await createUstaadStory(t(), author, { mediaId: img, idemKey: key() });
    expect(Date.parse(st.expiresAt) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    const rings = await listUstaadStories(t(), viewer);
    const ring = rings.find((r) => r.author.id === author.memberId);
    expect(ring?.stories[0]?.seen).toBe(false);
    expect(ring?.stories[0]?.seenBy).toBeNull();
    await viewUstaadStory(t(), viewer, st.id);
    await viewUstaadStory(t(), viewer, st.id);
    await viewUstaadStory(t(), author, st.id);
    const mine = (await listUstaadStories(t(), author)).find((r) => r.mine);
    expect(mine?.stories[0]?.seenBy).toBe(1);
    expect((await listUstaadStories(t(), viewer)).find((r) => r.author.id === author.memberId)?.allSeen).toBe(
      true,
    );
    expect(await readableUstaadMedia(t(), { mediaId: img, viewerMemberId: viewer.memberId })).not.toBeNull();

    await db
      .update(s.ustaadPosts)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.ustaadPosts.id, st.id));
    expect(
      (await listUstaadStories(t(), viewer)).find((r) => r.author.id === author.memberId),
    ).toBeUndefined();
    await expect(ustaadPostDetail(t(), viewer, st.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(viewUstaadStory(t(), viewer, st.id)).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await readableUstaadMedia(t(), { mediaId: img, viewerMemberId: viewer.memberId })).toBeNull();

    expect(await expireUstaadStories(t(), { limit: 100 })).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, st.id));
    expect(row?.status).toBe('expired');
    const [m] = await db.select().from(s.ustaadMedia).where(eq(s.ustaadMedia.id, img));
    expect(m?.purgeAfter).not.toBeNull();
    const ev = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, st.id), eq(s.ustaadEvents.toStatus, 'expired')));
    expect(ev).toHaveLength(1);
  });

  it('a story caption is screened (held like a post)', async () => {
    const img = await media(ramesh.memberId, 'image');
    const st = await createUstaadStory(t(), ramesh, { mediaId: img, body: 'PAYFEE', idemKey: key() });
    expect(st.status).toBe('held');
  });

  it('stories are not comment targets and the stories type switch turns them off', async () => {
    const img = await media(ramesh.memberId, 'image');
    const st = await createUstaadStory(t(), ramesh, { mediaId: img, idemKey: key() });
    await expect(
      commentOnUstaadPost(t(), suresh, st.id, { body: 'x', correction: 'none', idemKey: key() }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
    await setSetting('ustaad.posts.types.stories', false);
    const img2 = await media(ramesh.memberId, 'image');
    await expect(createUstaadStory(t(), ramesh, { mediaId: img2, idemKey: key() })).rejects.toMatchObject({
      code: 'USTAAD_POST_TYPE_OFF',
    });
  });
});

describe('tags pages and follows', () => {
  it('lists curated tags (search by alias), opens a tag with its posts, follows a tag (tag match in For you)', async () => {
    const found = await searchUstaadTags(t(), suresh, { q: 'battri' });
    expect(found.map((x) => x.slug)).toEqual(['battery']);
    const all = await searchUstaadTags(t(), suresh, {});
    expect(all.map((x) => x.slug)).not.toContain('retired');
    expect(all.map((x) => x.slug)).not.toContain('oldclutch');
    const p = await post(ramesh, { tags: ['battery'] });
    const page = await ustaadTagPage(t(), suresh, 'battery', { limit: 30 });
    expect(page.items.map((x) => x.id)).toContain(p.id);
    expect(await followUstaadTag(t(), suresh, 'battery')).toEqual({ followed: true });
    expect((await searchUstaadTags(t(), suresh, { q: 'battery' }))[0]?.followed).toBe(true);
    const [row] = await db
      .select()
      .from(s.ustaadTagFollows)
      .where(and(eq(s.ustaadTagFollows.memberId, suresh.memberId), eq(s.ustaadTagFollows.tagId, batteryTag)));
    expect(row).toBeDefined();
    await expect(ustaadTagPage(t(), suresh, 'retired', { limit: 5 })).rejects.toMatchObject({
      name: 'NotFoundError',
    });
  });
});

describe('link previews', () => {
  it('stored by URL hash, shown on the post, refreshed only when stale', async () => {
    const url = 'https://example.org/brake-guide';
    expect(await ustaadLinkPreviewNeeded(t(), url)).toBe(true);
    await saveUstaadLinkPreview(t(), url, {
      status: 'ok',
      finalHost: 'example.org',
      title: 'Brake guide',
      description: 'How to bleed brakes',
    });
    expect(await ustaadLinkPreviewNeeded(t(), url)).toBe(false);
    const p = await post(ramesh, { kind: 'link', body: undefined, linkUrl: url });
    const view = await ustaadPostDetail(t(), suresh, p.id);
    expect(view.link?.preview).toEqual({ title: 'Brake guide', description: 'How to bleed brakes' });
    await saveUstaadLinkPreview(t(), 'https://example.org/x', {
      status: 'blocked',
      finalHost: null,
      title: null,
      description: null,
    });
    const p2 = await post(ramesh, { kind: 'link', body: undefined, linkUrl: 'https://example.org/x' });
    expect((await ustaadPostDetail(t(), suresh, p2.id)).link?.preview).toBeNull();
  });
});
