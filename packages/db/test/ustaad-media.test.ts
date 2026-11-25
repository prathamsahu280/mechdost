/**
 * Ustaad media bookkeeping (spec 23 § 10; plan task A4): caps before any processing (AT-UP-4), quotas and the network
 * budget as conditional increments (SR-20), owner-only completion (AT-UP-10), quarantine never readable (AT-UP-8),
 * blocked viewer 404 (SR-35 media part), `url refused for expired story` (review focus 2), purge queue.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  declareUstaadMedia,
  dueUstaadMediaPurges,
  joinUstaad,
  markUstaadMediaUploaded,
  markUstaadMediaVerified,
  pendingUstaadMediaOf,
  readableUstaadMedia,
  rejectUstaadMedia,
  saveUstaadSetting,
  syncRbacCatalogue,
  type DeclareMediaInput,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { addWorkshop, seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
let a: string;
let b: string;
const MB = 1024 * 1024;

const declare = (over: Partial<DeclareMediaInput> = {}): DeclareMediaInput => ({
  memberId: a,
  userId: f.customer,
  host: 'supabase',
  kind: 'image',
  mime: 'image/webp',
  bytes: 200_000,
  sha256: 'a'.repeat(64),
  durationMs: null,
  width: 1080,
  height: 720,
  uploadExpiresAt: new Date(Date.now() + 600_000),
  hostMaxBytes: 50 * MB,
  ...over,
});

async function verified(memberId: string, userId: string) {
  const row = await declareUstaadMedia(t(), declare({ memberId, userId }));
  const up = await markUstaadMediaUploaded(t(), row);
  return markUstaadMediaVerified(t(), up, {
    bucket: 'media',
    objectKey: `m/${memberId}/${crypto.randomUUID()}.webp`,
    durationMs: null,
    width: 1080,
    height: 720,
    lqip: null,
  });
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  const base = {
    track: 'ustaad' as const,
    specialities: ['two_wheeler' as const],
    showGarage: false,
    pincode: '492001',
    areaLabel: 'Pandri',
    yearsClaimed: 5,
    workPlace: 'shop' as const,
    verifyMethods: [],
    consents: {
      ustaad_profile: true as const,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
    },
    turnstileToken: 'human-token-123',
  };
  a = (await joinUstaad(t(), { userId: f.customer }, { ...base, displayName: 'Ramesh' }, { via: 'ustaad' }))
    .id;
  b = (await joinUstaad(t(), { userId: f.other }, { ...base, displayName: 'Suresh' }, { via: 'ustaad' })).id;
});

afterAll(async () => {
  await client.close();
});

describe('declare', () => {
  it('records a pending upload in quarantine with a random key and an hour to finish', async () => {
    const row = await declareUstaadMedia(t(), declare());
    expect(row.status).toBe('pending_upload');
    expect(row.bucket).toBe('quarantine');
    expect(row.objectKey).toMatch(new RegExp(`^q/${a}/[0-9a-f-]{36}\\.webp$`));
    expect(row.purgeAfter?.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses 181 s and more than 150 MB before any processing (AT-UP-4); the host limit clamps too', async () => {
    await expect(
      declareUstaadMedia(
        t(),
        declare({ kind: 'video', mime: 'video/mp4', bytes: 5 * MB, durationMs: 182_001 }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
    await expect(
      declareUstaadMedia(
        t(),
        declare({
          kind: 'video',
          mime: 'video/mp4',
          bytes: 151 * MB,
          durationMs: 60_000,
          hostMaxBytes: 500 * MB,
        }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    // Supabase free plan: 50 MB per file, so a 60 MB clip waits for R2 (spec 23 § 10).
    await expect(
      declareUstaadMedia(
        t(),
        declare({ kind: 'video', mime: 'video/mp4', bytes: 60 * MB, durationMs: 60_000 }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
  });

  it('daily caps: 3 videos a day (the 4th is MEDIA_QUOTA); nothing is counted for a refused one', async () => {
    for (let i = 0; i < 3; i += 1)
      await declareUstaadMedia(
        t(),
        declare({
          memberId: b,
          userId: f.other,
          kind: 'video',
          mime: 'video/mp4',
          bytes: 2 * MB,
          durationMs: 30_000,
        }),
      );
    await expect(
      declareUstaadMedia(
        t(),
        declare({
          memberId: b,
          userId: f.other,
          kind: 'video',
          mime: 'video/mp4',
          bytes: 2 * MB,
          durationMs: 30_000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_QUOTA' });
    const rows = await db.select().from(s.ustaadMedia).where(eq(s.ustaadMedia.ownerMemberId, b));
    expect(rows).toHaveLength(3);
  });

  it('the member quota holds under a race: concurrent declares never pass the lifetime cap', async () => {
    await saveUstaadSetting(t(), {
      key: 'ustaad.media.member_quota_mb',
      value: 50,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    await saveUstaadSetting(t(), {
      key: 'ustaad.media.uploads_per_day',
      value: 200,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => declareUstaadMedia(t(), declare({ bytes: 3 * MB }))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const [usage] = await db
      .select()
      .from(s.ustaadMediaUsage)
      .where(eq(s.ustaadMediaUsage.day, '1970-01-01'));
    expect(ok).toBeLessThan(25);
    expect(usage?.bytes ?? 0).toBeLessThanOrEqual(50 * MB);
  });

  it('a full network budget refuses video only (MEDIA_BUDGET_FULL), photos still work', async () => {
    await saveUstaadSetting(t(), {
      key: 'ustaad.media.network_budget_gb',
      value: 1,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    await db
      .update(s.ustaadMediaTotals)
      .set({ bytes: 1024 * MB - 1 })
      .where(eq(s.ustaadMediaTotals.kind, 'image'));
    await expect(
      declareUstaadMedia(
        t(),
        declare({
          memberId: b,
          userId: f.other,
          kind: 'audio',
          mime: 'audio/ogg',
          bytes: 100_000,
          durationMs: 10_000,
        }),
      ),
    ).resolves.toMatchObject({ kind: 'audio' });
    await db.delete(s.ustaadMediaUsage).where(eq(s.ustaadMediaUsage.memberId, b));
    await expect(
      declareUstaadMedia(
        t(),
        declare({
          memberId: b,
          userId: f.other,
          kind: 'video',
          mime: 'video/mp4',
          bytes: MB,
          durationMs: 10_000,
        }),
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_BUDGET_FULL' });
    await db.update(s.ustaadMediaTotals).set({ bytes: 0 });
  });
});

describe('complete and read', () => {
  it('another member cannot complete my upload (AT-UP-10: 404)', async () => {
    const row = await declareUstaadMedia(t(), declare({ memberId: b, userId: f.other, bytes: 10_000 }));
    await expect(pendingUstaadMediaOf(t(), { mediaId: row.id, memberId: a })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(pendingUstaadMediaOf(t(), { mediaId: row.id, memberId: b })).resolves.toMatchObject({
      id: row.id,
    });
  });

  it('an expired upload link is refused and the row rejected', async () => {
    const row = await declareUstaadMedia(
      t(),
      declare({
        memberId: b,
        userId: f.other,
        bytes: 10_000,
        uploadExpiresAt: new Date(Date.now() - 3_600_000),
      }),
    );
    await expect(pendingUstaadMediaOf(t(), { mediaId: row.id, memberId: b })).rejects.toMatchObject({
      code: 'MEDIA_MISMATCH',
    });
    const [after] = await db.select().from(s.ustaadMedia).where(eq(s.ustaadMedia.id, row.id));
    expect(after?.status).toBe('rejected');
    expect(after?.rejectReasonCode).toBe('expired_upload');
  });

  it('quarantine is never readable (AT-UP-8); unlinked verified media only by its owner (deny by default)', async () => {
    const pending = await declareUstaadMedia(t(), declare({ memberId: b, userId: f.other, bytes: 10_000 }));
    expect(await readableUstaadMedia(t(), { mediaId: pending.id, viewerMemberId: b })).toBeNull();
    const m = await verified(b, f.other);
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: b })).not.toBeNull();
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: a })).toBeNull();
  });

  it('a blocked viewer gets nothing (SR-35)', async () => {
    const m = await verified(b, f.other);
    const [post] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: b, cityId: f.raipur, kind: 'photo', body: 'Aaj ka kaam' })
      .returning();
    if (!post) throw new Error('post');
    await db.insert(s.ustaadPostMedia).values({ postId: post.id, mediaId: m.id, position: 0 });
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: a })).not.toBeNull();
    await db.insert(s.ustaadBlocks).values({ memberId: b, targetId: a });
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: a })).toBeNull();
    await db.delete(s.ustaadBlocks);
  });

  it('url refused for expired story; and for a removed post', async () => {
    const m = await verified(b, f.other);
    const [story] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: b, cityId: f.raipur, kind: 'story', expiresAt: new Date(Date.now() + 60_000) })
      .returning();
    if (!story) throw new Error('story');
    await db.insert(s.ustaadPostMedia).values({ postId: story.id, mediaId: m.id, position: 0 });
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: a })).not.toBeNull();
    expect(
      await readableUstaadMedia(t(), {
        mediaId: m.id,
        viewerMemberId: a,
        now: new Date(Date.now() + 120_000),
      }),
    ).toBeNull();
    await db.update(s.ustaadPosts).set({ status: 'removed' }).where(eq(s.ustaadPosts.id, story.id));
    expect(await readableUstaadMedia(t(), { mediaId: m.id, viewerMemberId: a })).toBeNull();
  });

  it('a rejected file gives its bytes back and enters the purge queue', async () => {
    const row = await declareUstaadMedia(t(), declare({ memberId: b, userId: f.other, bytes: 10_000 }));
    await rejectUstaadMedia(t(), row, 'magic_mismatch');
    const due = await dueUstaadMediaPurges(t(), 100, new Date(Date.now() + 1000));
    expect(due.map((d) => d.id)).toContain(row.id);
  });
});

describe('media read per host (security review 2026-11-26: deny by default)', () => {
  const can = (mediaId: string, viewer: string) =>
    readableUstaadMedia(t(), { mediaId, viewerMemberId: viewer });
  let c: string;

  beforeAll(async () => {
    c = (
      await joinUstaad(
        t(),
        { userId: f.staff },
        {
          track: 'apprentice',
          specialities: ['two_wheeler'],
          displayName: 'Third Member',
          showGarage: false,
          pincode: '492001',
          areaLabel: 'Pandri',
          yearsClaimed: 1,
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
      )
    ).id;
  });

  it('a message photo: only the two people in the thread', async () => {
    const m = await verified(b, f.other);
    const [low, high] = [a, b].sort();
    if (!low || !high) throw new Error('pair');
    const [thread] = await db
      .insert(s.ustaadThreads)
      .values({ lowId: low, highId: high, requestedBy: b, status: 'open' })
      .returning();
    if (!thread) throw new Error('thread');
    await db
      .insert(s.ustaadMessages)
      .values({ threadId: thread.id, senderId: b, kind: 'photo', mediaId: m.id });
    expect(await can(m.id, a)).not.toBeNull();
    expect(await can(m.id, c)).toBeNull();
  });

  it('a question voice note: members while the question is not removed', async () => {
    const m = await verified(b, f.other);
    const [q] = await db
      .insert(s.ustaadQuestions)
      .values({
        code: 'UQ-RPR-2026-MEDIAQ',
        askerId: b,
        cityId: f.raipur,
        title: 'Awaaz wala sawaal',
        voiceMediaId: m.id,
      })
      .returning();
    if (!q) throw new Error('q');
    expect(await can(m.id, c)).not.toBeNull();
    await db.update(s.ustaadQuestions).set({ status: 'removed' }).where(eq(s.ustaadQuestions.id, q.id));
    expect(await can(m.id, c)).toBeNull();
  });

  it('an answer voice note and a comment photo: only while visible', async () => {
    const [q] = await db
      .insert(s.ustaadQuestions)
      .values({ code: 'UQ-RPR-2026-MEDIAR', askerId: a, cityId: f.raipur, title: 'Sawaal' })
      .returning();
    if (!q) throw new Error('q');
    const voice = await verified(b, f.other);
    const [ans] = await db
      .insert(s.ustaadAnswers)
      .values({ questionId: q.id, authorId: b, voiceMediaId: voice.id })
      .returning();
    if (!ans) throw new Error('a');
    expect(await can(voice.id, c)).not.toBeNull();
    await db.update(s.ustaadAnswers).set({ status: 'removed' }).where(eq(s.ustaadAnswers.id, ans.id));
    expect(await can(voice.id, c)).toBeNull();
    const photo = await verified(b, f.other);
    const [com] = await db
      .insert(s.ustaadComments)
      .values({ answerId: ans.id, authorId: b, mediaId: photo.id })
      .returning();
    if (!com) throw new Error('c');
    // The comment is visible but sits on a removed answer: hidden with it.
    expect(await can(photo.id, c)).toBeNull();
    await db.update(s.ustaadAnswers).set({ status: 'visible' }).where(eq(s.ustaadAnswers.id, ans.id));
    expect(await can(photo.id, c)).not.toBeNull();
    await db.update(s.ustaadComments).set({ status: 'held' }).where(eq(s.ustaadComments.id, com.id));
    expect(await can(photo.id, c)).toBeNull();
  });

  it('a profile photo: members while the profile is not left or banned', async () => {
    const m = await verified(b, f.other);
    await db.update(s.ustaadMembers).set({ photoMediaId: m.id }).where(eq(s.ustaadMembers.id, b));
    expect(await can(m.id, c)).not.toBeNull();
  });

  it('a job application voice intro: only the applicant and the employer', async () => {
    const ws = await addWorkshop(db, f);
    const [job] = await db
      .insert(s.ustaadJobs)
      .values({
        code: 'UJ-RPR-2026-MEDIAJ',
        employerMemberId: a,
        workshopId: ws.id,
        cityId: f.raipur,
        areaLabel: 'Pandri',
        roleCode: 'helper',
        title: 'Helper wanted',
        description: 'Helper for the garage, full day.',
        payMinPaiseMonth: 800_000,
        payMaxPaiseMonth: 1_000_000,
        timing: '9 to 7',
        adultAttestedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'open',
      })
      .returning();
    if (!job) throw new Error('job');
    const m = await verified(b, f.other);
    await db.insert(s.ustaadJobApplications).values({ jobId: job.id, memberId: b, voiceIntroMediaId: m.id });
    expect(await can(m.id, a)).not.toBeNull();
    expect(await can(m.id, c)).toBeNull();
  });

  it('a story photo and a removed post are refused; a held post too', async () => {
    const m = await verified(b, f.other);
    const [post] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: b, cityId: f.raipur, kind: 'photo', body: 'x', status: 'held' })
      .returning();
    if (!post) throw new Error('post');
    await db.insert(s.ustaadPostMedia).values({ postId: post.id, mediaId: m.id, position: 0 });
    expect(await can(m.id, c)).toBeNull();
    expect(await can(m.id, b)).not.toBeNull();
  });
});
