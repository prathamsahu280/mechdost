/**
 * Video-link posts (spec 23 § 10b; founder 2026-11-28): a YouTube link is stored as the canonical watch URL plus
 * provider, id and start; the oEmbed title and author handed in by the API are screened with the post text and kept
 * on the post; the blocked-sites list catches every YouTube URL form through the canonical URL; the oEmbed answer is
 * cached by URL hash and reused while fresh.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { CreatePost } from '@mechdost/shared/ustaad/dto/feed';
import {
  createUstaadPost,
  ensureUser,
  joinUstaad,
  saveUstaadLinkPreview,
  syncRbacCatalogue,
  ustaadPostDetail,
  ustaadVideoMetaCached,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture } from './service-fixture';

vi.mock('../src/repo/ustaad/moderation', () => ({
  screenUstaadContent: (_tx: unknown, input: { text: string | null }) =>
    Promise.resolve(input.text?.includes('PAYFEE') ? 'hold' : 'ok'),
  openUstaadAutoHoldReport: () => Promise.resolve(null),
}));

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
interface M {
  userId: string;
  memberId: string;
}
let ramesh: M;
let suresh: M;
const ID = 'dQw4w9WgXcQ';

let n = 0;
async function member(): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-video-${id}`,
    phone: `+9196000${id.padStart(5, '0')}`,
    email: `ustaad-video-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler'] as never,
      displayName: `Mistri V${id}`,
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
    .set({ joinedAt: new Date(Date.now() - 60 * 86_400_000) })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

const link = (m: M, linkUrl: string, meta?: { title: string | null; author: string | null } | null) =>
  createUstaadPost(
    t(),
    m,
    {
      kind: 'link',
      body: 'Dekho ye video',
      correction: 'none',
      media: [],
      tags: [],
      idemKey: `k${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      linkUrl,
    } satisfies CreatePost,
    { video: meta ?? null },
  );

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  const f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  ramesh = await member();
  suresh = await member();
});
afterAll(async () => {
  await client.close();
});

describe('video-link posts', () => {
  it('a youtu.be link with a start time is stored canonical with provider, id, start, title and author', async () => {
    const p = await link(ramesh, `https://youtu.be/${ID}?t=1m30s`, {
      title: 'Splendor clutch plate change',
      author: 'Raipur Garage',
    });
    expect(p.linkUrl).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(p.video).toEqual({ provider: 'youtube', videoId: ID });
    const view = await ustaadPostDetail(t(), suresh, p.id);
    expect(view.link?.video).toEqual({
      provider: 'youtube',
      videoId: ID,
      startS: 90,
      title: 'Splendor clutch plate change',
      author: 'Raipur Garage',
    });
    expect(view.link?.host).toBe('youtube.com');
  });

  it('without oEmbed (fetch failed) the post still goes up with the id only', async () => {
    const p = await link(ramesh, `https://www.youtube.com/shorts/${ID}`, null);
    const view = await ustaadPostDetail(t(), suresh, p.id);
    expect(view.link?.video).toEqual({
      provider: 'youtube',
      videoId: ID,
      startS: 0,
      title: null,
      author: null,
    });
  });

  it('a plain link carries no video', async () => {
    const p = await link(ramesh, 'https://example.com/guide');
    expect(p.video).toBeNull();
    const view = await ustaadPostDetail(t(), suresh, p.id);
    expect(view.link?.video ?? null).toBeNull();
  });

  it('the oEmbed title and author are screened like post text', async () => {
    const held = await link(ramesh, `https://youtu.be/${ID}`, { title: 'PAYFEE to join', author: null });
    expect(held.status).toBe('held');
    const heldByAuthor = await link(ramesh, `https://youtu.be/${ID}`, {
      title: 'ok',
      author: 'PAYFEE channel',
    });
    expect(heldByAuthor.status).toBe('held');
  });

  it('blocking youtube.com catches youtu.be and m.youtube.com links (canonical URL checked)', async () => {
    await db
      .insert(s.ustaadWordLists)
      .values({ list: 'link_domain', phrase: 'youtube.com', phraseNorm: 'youtube.com' });
    await expect(link(ramesh, `https://youtu.be/${ID}`)).rejects.toMatchObject({
      code: 'USTAAD_LINK_BLOCKED',
    });
    await expect(link(ramesh, `https://m.youtube.com/watch?v=${ID}`)).rejects.toMatchObject({
      code: 'USTAAD_LINK_BLOCKED',
    });
    await db.delete(s.ustaadWordLists).where(eq(s.ustaadWordLists.phrase, 'youtube.com'));
  });

  it('blocking youtu.be also refuses the short form even though the canonical host differs', async () => {
    await db
      .insert(s.ustaadWordLists)
      .values({ list: 'link_domain', phrase: 'youtu.be', phraseNorm: 'youtu.be' });
    await expect(link(ramesh, `https://youtu.be/${ID}`)).rejects.toMatchObject({
      code: 'USTAAD_LINK_BLOCKED',
    });
    await db.delete(s.ustaadWordLists).where(eq(s.ustaadWordLists.phrase, 'youtu.be'));
  });

  it('oEmbed answers are cached by URL hash: ok rows reused while fresh, failures not shown', async () => {
    const url = `https://www.youtube.com/watch?v=${ID}`;
    expect(await ustaadVideoMetaCached(t(), url)).toBeNull();
    await saveUstaadLinkPreview(t(), url, {
      status: 'ok',
      finalHost: 'youtube.com',
      title: 'Clutch',
      description: null,
      author: 'Raipur Garage',
    });
    expect(await ustaadVideoMetaCached(t(), url)).toEqual({ title: 'Clutch', author: 'Raipur Garage' });
    await saveUstaadLinkPreview(t(), url, {
      status: 'failed',
      finalHost: null,
      title: null,
      description: null,
    });
    expect(await ustaadVideoMetaCached(t(), url)).toBeNull();
  });

  it('the database refuses a malformed video id or a provider without an id', async () => {
    const [row] = await db.select({ id: s.ustaadPosts.id }).from(s.ustaadPosts).limit(1);
    if (!row) throw new Error('post');
    await expect(
      db
        .update(s.ustaadPosts)
        .set({ videoProvider: 'youtube', videoId: '../../evil' })
        .where(eq(s.ustaadPosts.id, row.id)),
    ).rejects.toThrow();
    await expect(
      db
        .update(s.ustaadPosts)
        .set({ videoProvider: 'youtube', videoId: null })
        .where(eq(s.ustaadPosts.id, row.id)),
    ).rejects.toThrow();
  });
});
