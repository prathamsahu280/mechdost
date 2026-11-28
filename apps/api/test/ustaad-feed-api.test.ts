/**
 * Ustaad feed over HTTP (spec 23 § 8; plan tasks D1–D2): the gate and the member guard come before validation on
 * every feed route (role-leak: signed out, customer, staff without membership, and the default staff preview), strict
 * bodies, the For you snapshot cursor (no repeats, forged cursor refused), Following, like / save / comment, the
 * share teaser (public, generic, noindex, 404 once removed or while the network is not open), `posts.per_day` as 429,
 * the stories account-age gate, a link preview stored after commit, and no phone number in any response (SR-34).
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import type { PreviewDeps } from '../src/ustaad/link-preview';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
  memberId?: string;
}
let n = 0;
const bodies: string[] = [];

async function person(role?: string): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-feed-api-${id}`,
    phone: `+9195100${id.padStart(5, '0')}`,
    email: `ustaad-feed-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-feed-api-0000${id}`, { ...identity, staff2fa: true });
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId: null, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  bodies.push(text);
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const join = (displayName: string) => ({
  track: 'ustaad',
  specialities: ['two_wheeler'],
  displayName,
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 6,
  workPlace: 'shop',
  verifyMethods: [],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'human-token-123',
});

let superAdmin: Person;
let customer: Person;
let ramesh: Person;
let suresh: Person;
const k = () => `idem-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const previews: string[] = [];
const oembedCalls: string[] = [];

async function setSetting(key: string, value: unknown) {
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find((r) => r.key === key);
  const res = await call(superAdmin, 'PUT', `/admin/ustaad/settings/${key}`, {
    value,
    version: row?.version ?? null,
  });
  expect(res.status, `${key} ${res.text}`).toBe(200);
}

async function member(name: string): Promise<Person> {
  const p = await person();
  const r = await call(p, 'POST', '/ustaad/join', join(name));
  expect(r.status, r.text).toBe(201);
  const { eq } = await import('@mechdost/db/testing');
  // Old enough for links and stories (the account-age gates are tested separately).
  await ctx.db
    .update(s.ustaadMembers)
    .set({ joinedAt: new Date(Date.now() - 60 * 86_400_000) })
    .where(eq(s.ustaadMembers.id, r.body.id as string));
  return { ...p, memberId: r.body.id as string };
}

beforeAll(async () => {
  const fakePreview: PreviewDeps = {
    resolve: () => Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
    request: ({ url }) => {
      previews.push(url.href);
      return Promise.resolve({
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<meta property="og:title" content="Clutch guide">'),
      });
    },
  };
  ctx = await buildApp({
    turnstile: new FakeTurnstile(['human-token-123']),
    env: { USTAAD_SHARE_SECRET: 'x'.repeat(40) },
    linkPreview: fakePreview,
    videoOEmbed: {
      fetch: (url) => {
        oembedCalls.push(url);
        return Promise.resolve(
          new Response(JSON.stringify({ title: 'Clutch plate change', author_name: 'Raipur Garage' }), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    },
  });
  const [state] = await ctx.db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  if (!state) throw new Error('state');
  const [raipur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
    .returning();
  if (!raipur) throw new Error('city');
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  await ctx.db
    .insert(s.ustaadTags)
    .values({ slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'part', aliases: ['battri'] });
  superAdmin = await person('super_admin');
  customer = await person();
});

const ROUTES: [string, string, unknown?][] = [
  ['GET', '/ustaad/feed'],
  ['GET', '/ustaad/feed?tab=following'],
  ['GET', '/ustaad/feed/fresh?since=2026-11-27T00:00:00.000Z'],
  ['GET', '/ustaad/feed/limits'],
  ['POST', '/ustaad/posts', { nonsense: true }],
  ['GET', `/ustaad/posts/${randomUUID()}`],
  ['DELETE', `/ustaad/posts/${randomUUID()}`],
  ['POST', `/ustaad/posts/${randomUUID()}/like`],
  ['DELETE', `/ustaad/posts/${randomUUID()}/like`],
  ['POST', `/ustaad/posts/${randomUUID()}/useful`],
  ['DELETE', `/ustaad/posts/${randomUUID()}/useful`],
  ['POST', `/ustaad/posts/${randomUUID()}/save`],
  ['DELETE', `/ustaad/posts/${randomUUID()}/save`],
  ['POST', `/ustaad/posts/${randomUUID()}/share`, {}],
  ['GET', `/ustaad/posts/${randomUUID()}/comments`],
  ['POST', `/ustaad/posts/${randomUUID()}/comments`, {}],
  ['DELETE', `/ustaad/comments/${randomUUID()}`],
  ['POST', `/ustaad/polls/${randomUUID()}/vote`, {}],
  ['GET', '/ustaad/saved'],
  ['GET', '/ustaad/stories'],
  ['POST', '/ustaad/stories', {}],
  ['POST', `/ustaad/stories/${randomUUID()}/view`],
  ['GET', '/ustaad/tags'],
  ['GET', '/ustaad/tags/battery'],
  ['PUT', '/ustaad/tags/battery/follow'],
  ['DELETE', '/ustaad/tags/battery/follow'],
  ['POST', '/ustaad/tag-suggestions', {}],
  ['GET', '/ustaad/shares/AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA'],
];

describe('role leak (gate + member guard before validation)', () => {
  it('staff preview (default): a member-to-be, a customer and staff without membership all get 404', async () => {
    for (const p of [customer, superAdmin])
      for (const [method, path, body] of ROUTES) {
        const r = await call(p, method, path, body);
        expect(r.status, `${method} ${path}`).toBe(404);
      }
  });

  it('open: signed out → 401; a customer who is not a member → 404 on every feed route', async () => {
    await setSetting('ustaad.access', 'open');
    ramesh = await member('Ramesh Sahu');
    suresh = await member('Suresh Verma');
    expect((await call(null, 'GET', '/ustaad/feed')).status).toBe(401);
    for (const [method, path, body] of ROUTES) {
      const r = await call(customer, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('posts, feed, reactions, comments', () => {
  it('SIM-P6 / SIM-P29: GET /ustaad/feed/limits answers the live photo limit and the story lock for a member', async () => {
    const r = await call(ramesh, 'GET', '/ustaad/feed/limits');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ maxPhotos: 6, canWrite: true });
    expect(['open', 'locked', 'off']).toContain(r.body.stories);
  });

  it('strict bodies: status and authorId are refused', async () => {
    const r = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'text',
      body: 'x',
      status: 'visible',
      idemKey: k(),
    });
    expect(r.status).toBe(400);
  });

  it('create → For you pages through a snapshot without repeats → like, save, comment', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await call(ramesh, 'POST', '/ustaad/posts', {
        kind: 'text',
        body: `Tip ${String(i)}: plug saaf karo`,
        tags: ['battri'],
        idemKey: k(),
      });
      expect(r.status, r.text).toBe(201);
      made.push(r.body.id as string);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await call(
        suresh,
        'GET',
        `/ustaad/feed?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(page.status, page.text).toBe(200);
      seen.push(...(page.body.items as { id: string }[]).map((x) => x.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of made) expect(seen).toContain(id);
    expect((await call(suresh, 'GET', '/ustaad/feed?cursor=bm90LWEtY3Vyc29y')).status).toBe(422);

    const id = made[0] ?? '';
    const liked = await call(suresh, 'POST', `/ustaad/posts/${id}/like`);
    expect(liked.body).toEqual({ liked: true, likes: 1 });
    expect((await call(suresh, 'POST', `/ustaad/posts/${id}/save`)).body).toEqual({ saved: true });
    const useful = await call(suresh, 'POST', `/ustaad/posts/${id}/useful`);
    expect(useful.body).toEqual({ useful: true, usefulCount: 1 });
    const c = await call(suresh, 'POST', `/ustaad/posts/${id}/comments`, { body: 'Sahi baat', idemKey: k() });
    expect(c.status, c.text).toBe(201);
    const list = await call(ramesh, 'GET', `/ustaad/posts/${id}/comments`);
    expect((list.body.items as unknown[]).length).toBe(1);
    const detail = await call(ramesh, 'GET', `/ustaad/posts/${id}`);
    expect(detail.body.counts).toEqual({ likes: 1, useful: 1, comments: 1, saves: 1 });
    expect((detail.body.tags as { slug: string }[])[0]?.slug).toBe('battery');
    const savedList = await call(suresh, 'GET', '/ustaad/saved');
    expect((savedList.body.items as { id: string }[]).map((x) => x.id)).toEqual([id]);
  });

  it('fresh: counts newer visible posts by others since a time (capped at 10; U1, SIM-F4)', async () => {
    // From this test's own start: earlier tests in the file (video links) post within the same second.
    await new Promise((r) => setTimeout(r, 5));
    const since = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    const none = await call(suresh, 'GET', `/ustaad/feed/fresh?since=${encodeURIComponent(since)}`);
    expect(none.status, none.text).toBe(200);
    expect(none.body).toEqual({ count: 0 });
    for (let i = 0; i < 2; i += 1) {
      const r = await call(ramesh, 'POST', '/ustaad/posts', {
        kind: 'text',
        body: `Naya ${String(i)}`,
        idemKey: k(),
      });
      expect(r.status, r.text).toBe(201);
    }
    const two = await call(suresh, 'GET', `/ustaad/feed/fresh?since=${encodeURIComponent(since)}`);
    expect(two.body).toEqual({ count: 2 });
    // My own posts never announce themselves to me.
    const own = await call(ramesh, 'GET', `/ustaad/feed/fresh?since=${encodeURIComponent(since)}`);
    expect(own.body).toEqual({ count: 0 });
    // Following: Suresh follows nobody yet.
    const following = await call(
      suresh,
      'GET',
      `/ustaad/feed/fresh?tab=following&since=${encodeURIComponent(since)}`,
    );
    expect(following.body).toEqual({ count: 0 });
    expect((await call(suresh, 'GET', '/ustaad/feed/fresh?since=yesterday')).status).toBe(400);
    expect((await call(suresh, 'GET', '/ustaad/feed/fresh')).status).toBe(400);
  });

  it('Following shows only followed authors', async () => {
    const empty = await call(suresh, 'GET', '/ustaad/feed?tab=following');
    expect(empty.body.items).toEqual([]);
    await ctx.db
      .insert(s.ustaadFollows)
      .values({ followerId: suresh.memberId ?? '', followeeId: ramesh.memberId ?? '' });
    const page = await call(suresh, 'GET', '/ustaad/feed?tab=following&limit=3');
    expect((page.body.items as unknown[]).length).toBe(3);
    expect(page.body.nextCursor).not.toBeNull();
  });

  it('posts.per_day answers 429 USTAAD_DAILY_CAP', async () => {
    await setSetting('ustaad.posts.per_day', 1);
    const fresh = await member('Mohan Lal');
    expect(
      (await call(fresh, 'POST', '/ustaad/posts', { kind: 'text', body: 'a', idemKey: k() })).status,
    ).toBe(201);
    const second = await call(fresh, 'POST', '/ustaad/posts', { kind: 'text', body: 'b', idemKey: k() });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('USTAAD_DAILY_CAP');
    await setSetting('ustaad.posts.per_day', 20);
  });

  it('a link post gets its preview after commit; the post never waits for it', async () => {
    const r = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'link',
      linkUrl: 'https://example.com/clutch',
      idemKey: k(),
    });
    expect(r.status, r.text).toBe(201);
    let preview: unknown = null;
    for (let i = 0; i < 40 && !preview; i += 1) {
      await new Promise((res) => setTimeout(res, 25));
      const d = await call(suresh, 'GET', `/ustaad/posts/${r.body.id as string}`);
      preview = (d.body.link as { preview: unknown } | null)?.preview ?? null;
    }
    expect(preview).toEqual({ title: 'Clutch guide', description: null });
    expect(previews).toEqual(['https://example.com/clutch']);
  });

  it('a YouTube link: oEmbed title + author on the post, cached, no HTML preview fetch (spec 23 § 10b)', async () => {
    const before = previews.length;
    const r = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'link',
      linkUrl: 'https://youtu.be/dQw4w9WgXcQ?t=42',
      body: 'Clutch video',
      idemKey: k(),
    });
    expect(r.status, r.text).toBe(201);
    const d = await call(suresh, 'GET', `/ustaad/posts/${r.body.id as string}`);
    expect(d.body.link).toMatchObject({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      host: 'youtube.com',
      preview: null,
      video: {
        provider: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        startS: 42,
        title: 'Clutch plate change',
        author: 'Raipur Garage',
      },
    });
    const again = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'link',
      linkUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      idemKey: k(),
    });
    expect(again.status, again.text).toBe(201);
    expect(oembedCalls).toHaveLength(1);
    await new Promise((res) => setTimeout(res, 50));
    expect(previews.length).toBe(before);
  });

  it('stories are locked for accounts younger than stories.min_account_days', async () => {
    const p = await person();
    const j = await call(p, 'POST', '/ustaad/join', join('Naya Banda'));
    const [m] = await ctx.db
      .insert(s.ustaadMedia)
      .values({
        ownerMemberId: j.body.id as string,
        host: 'supabase',
        bucket: 'media',
        kind: 'image',
        status: 'verified',
        declaredBytes: 40_000,
        declaredMime: 'image/webp',
        sha256: 'a'.repeat(64),
        objectKey: `m/${j.body.id as string}/${randomUUID()}.webp`,
        uploadExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    const r = await call(p, 'POST', '/ustaad/stories', { mediaId: m?.id, idemKey: k() });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('USTAAD_STORIES_LOCKED');
  });
});

describe('share teaser (SR-44)', () => {
  it('public, generic, noindex; members resolve it; removed post → 404; not open → 404', async () => {
    const post = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'text',
      body: 'Secret fix details for Ramesh customers',
      idemKey: k(),
    });
    const id = post.body.id as string;
    const shared = await call(suresh, 'POST', `/ustaad/posts/${id}/share`, { channel: 'whatsapp' });
    expect(shared.status, shared.text).toBe(200);
    const token = shared.body.token as string;
    expect(shared.body.path).toBe(`/ustaad/s/${token}`);

    const t = await call(null, 'GET', `/ustaad/s/${token}`);
    expect(t.status).toBe(200);
    expect(t.body).toEqual({ kind: 'ustaad_post' });
    expect(t.headers.get('x-robots-tag')).toContain('noindex');
    expect(t.text).not.toContain('Secret');
    expect(t.text).not.toContain('Ramesh');

    const forged = `${token.slice(0, 23)}${token[23] === 'A' ? 'B' : 'A'}${token.slice(24)}`;
    expect((await call(null, 'GET', `/ustaad/s/${forged}`)).status).toBe(404);
    expect((await call(suresh, 'GET', `/ustaad/shares/${token}`)).body).toEqual({ postId: id });
    expect((await call(customer, 'GET', `/ustaad/shares/${token}`)).status).toBe(404);

    await call(ramesh, 'DELETE', `/ustaad/posts/${id}`);
    expect((await call(null, 'GET', `/ustaad/s/${token}`)).status).toBe(404);

    const other = await call(ramesh, 'POST', '/ustaad/posts', { kind: 'text', body: 'x', idemKey: k() });
    const tok2 = (
      await call(suresh, 'POST', `/ustaad/posts/${other.body.id as string}/share`, { channel: 'copy_link' })
    ).body.token as string;
    await setSetting('ustaad.access', 'staff_preview');
    expect((await call(null, 'GET', `/ustaad/s/${tok2}`)).status).toBe(404);
    // A member who is not staff is outside the preview: 404 on the feed too.
    expect((await call(suresh, 'GET', '/ustaad/feed')).status).toBe(404);
    await setSetting('ustaad.access', 'open');
  });
});

describe('SR-34', () => {
  it('no phone number in any response of this suite', () => {
    for (const b of bodies) expect(b).not.toMatch(/\+91951/);
  });
});
