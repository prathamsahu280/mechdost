/**
 * Voice and video text alternatives (founder 2026-11-27 night; spec 23 § 10a): the author's typed summary and video
 * captions are stored with the media row when the upload is declared (immutable afterwards, so no edit can skip the
 * screen), the moderation screen reads them like any typed text, and readers get them in one batched lookup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  declareUstaadMedia,
  explainUstaadScreen,
  joinUstaad,
  markUstaadMediaUploaded,
  markUstaadMediaVerified,
  ustaadMediaViews,
  saveUstaadChoices,
  getUstaadChoices,
  syncRbacCatalogue,
  ustaadMediaTextInfo,
  type DeclareMediaInput,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
let a: string;

const voice = (over: Partial<DeclareMediaInput> = {}): DeclareMediaInput => ({
  memberId: a,
  userId: f.customer,
  host: 'supabase',
  kind: 'audio',
  mime: 'audio/ogg',
  bytes: 40_000,
  sha256: 'b'.repeat(64),
  durationMs: 42_000,
  width: null,
  height: null,
  uploadExpiresAt: new Date(Date.now() + 600_000),
  hostMaxBytes: 50 * 1024 * 1024,
  ...over,
});

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  a = (
    await joinUstaad(
      t(),
      { userId: f.customer },
      {
        track: 'ustaad',
        specialities: ['two_wheeler'],
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
        displayName: 'Ramesh',
      },
      { via: 'ustaad' },
    )
  ).id;
  const c = await getUstaadChoices(t(), f.customer);
  await saveUstaadChoices(
    t(),
    { userId: f.customer },
    { expectedVersion: c.version, consents: { ustaad_voice: true } },
  );
});

afterAll(async () => {
  await client.close();
});

describe('typed summary and captions are stored with the media row', () => {
  it('a voice note keeps its summary; a video keeps its captions and their language', async () => {
    const v = await declareUstaadMedia(t(), voice({ summary: 'Splendor clutch plate slipping' }));
    expect(v.summary).toBe('Splendor clutch plate slipping');
    expect(v.captions).toBeNull();
    const vid = await declareUstaadMedia(
      t(),
      voice({
        kind: 'video',
        mime: 'video/mp4',
        bytes: 900_000,
        summary: 'Brake pads on an Activa',
        captions: { lang: 'hi', text: '0:00 — पैड निकालो\n0:05 — नए पैड लगाओ' },
      }),
    );
    expect(vid.captions).toContain('पैड');
    expect(vid.captionsLang).toBe('hi');
  });

  it('the database refuses a 201-character summary and captions on a voice note (CHECKs)', async () => {
    await expect(declareUstaadMedia(t(), voice({ summary: 'x'.repeat(201) }))).rejects.toThrow();
    await expect(
      declareUstaadMedia(t(), voice({ captions: { lang: 'en', text: 'not on audio' } })),
    ).rejects.toThrow();
  });
});

describe('moderation reads the summary like any typed text', () => {
  it('a phone number in a voice question summary blocks the question; a clean one passes', async () => {
    const bad = await declareUstaadMedia(t(), voice({ summary: 'call me 98765 43210 for parts' }));
    const verdict = await explainUstaadScreen(t(), {
      kind: 'question',
      text: null,
      mediaIds: [bad.id],
      authorId: a,
    });
    expect(verdict.signals).toContain('phone_number');
    expect(verdict.outcome).toBe('block');
    const ok = await declareUstaadMedia(t(), voice({ summary: 'Clutch plate slipping' }));
    const clean = await explainUstaadScreen(t(), {
      kind: 'question',
      text: null,
      mediaIds: [ok.id],
      authorId: a,
    });
    expect(clean.signals).not.toContain('phone_number');
  });
});

describe('batched text info for readers', () => {
  it('one query returns duration, size, summary and a built WebVTT for videos', async () => {
    const v = await declareUstaadMedia(
      t(),
      voice({ summary: 'Horn wiring', durationMs: 9_000, bytes: 30_000 }),
    );
    const vid = await declareUstaadMedia(
      t(),
      voice({
        kind: 'video',
        mime: 'video/mp4',
        bytes: 800_000,
        durationMs: 6_000,
        captions: { lang: 'en', text: 'Whole clip caption' },
      }),
    );
    const info = await ustaadMediaTextInfo(t(), [v.id, vid.id, crypto.randomUUID()]);
    expect(info.get(v.id)).toEqual({
      durationMs: 9_000,
      bytes: 30_000,
      summary: 'Horn wiring',
      captionsLang: null,
      captionsVtt: null,
    });
    expect(info.get(vid.id)?.captionsVtt).toBe(
      'WEBVTT\n\n1\n00:00:00.000 --> 00:00:06.000\nWhole clip caption\n',
    );
    expect(info.size).toBe(2);
  });
});

describe('post media views carry the text alternative', () => {
  it('a video post gives the player its summary, caption language and WebVTT', async () => {
    const row = await declareUstaadMedia(
      t(),
      voice({
        kind: 'video',
        mime: 'video/mp4',
        bytes: 700_000,
        durationMs: 4_000,
        summary: 'Chain tension',
        captions: { lang: 'hi', text: 'चेन ढीली है' },
      }),
    );
    const up = await markUstaadMediaUploaded(t(), row);
    await markUstaadMediaVerified(t(), up, {
      bucket: 'media',
      objectKey: `m/${a}/${crypto.randomUUID()}.mp4`,
      durationMs: 4_000,
      width: null,
      height: null,
      lqip: null,
    });
    const [post] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: a, cityId: f.raipur, kind: 'video' })
      .returning();
    if (!post) throw new Error('post');
    await db.insert(s.ustaadPostMedia).values({ postId: post.id, mediaId: row.id, position: 0 });
    const views = await ustaadMediaViews(t(), [post.id]);
    expect(views.get(post.id)?.[0]).toMatchObject({
      summary: 'Chain tension',
      captionsLang: 'hi',
      captionsVtt: 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.000\nचेन ढीली है\n',
    });
  });
});
