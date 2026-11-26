/**
 * Ustaad graph, messages, Discover and promotions over HTTP (spec 23 § 8 "Graph", "Messages", "Discover",
 * "Promotions"; workstream D2): the gate and the member guard before validation (signed out 401 while open, a
 * non-member 404 on every route, the staff preview hides everything from members), strict bodies, follow →
 * message request → accept → reply with no phone in any response (SR-34), blocks 404 both ways (SR-35), the 21st
 * follow in a day 429 with Retry-After (AT-RATE-1), double accept over HTTP, Discover, promotions with the locked
 * label, and the staff thread read only through a report (community manager yes, marketing and customers no).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  memberId: string;
  headers: Record<string, string>;
}
let n = 0;
let raipurId = '';
const DAY = 86_400_000;

async function person(role?: string, cityId: string | null = null): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-social-api-${id}`,
    phone: `+9194000${id.padStart(5, '0')}`,
    email: `ustaad-social-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-social-api-0000${id}`, { ...identity, staff2fa: true });
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, memberId: '', headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const join = (displayName: string) => ({
  track: 'ustaad',
  specialities: ['two_wheeler', 'battery'],
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

async function memberOf(name: string, role?: string): Promise<Person> {
  const p = await person(role);
  const r = await call(p, 'POST', '/ustaad/join', join(name));
  expect(r.status).toBe(201);
  p.memberId = r.body.id as string;
  const { eq } = await import('@mechdost/db/testing');
  // Old enough to start conversations (limits.dm_min_account_days = 7).
  await ctx.db
    .update(s.ustaadMembers)
    .set({ joinedAt: new Date(Date.now() - 30 * DAY), level: 'naya' })
    .where(eq(s.ustaadMembers.id, p.memberId));
  return p;
}

async function setAccess(admin: Person, value: string) {
  const list = await call(admin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  const r = await call(admin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value,
    version: row?.version ?? null,
  });
  expect(r.status).toBe(200);
}

let superAdmin: Person;
let customer: Person;
let a: Person;
let b: Person;

beforeAll(async () => {
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']) });
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
  raipurId = raipur.id;
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  superAdmin = await person('super_admin');
  await setAccess(superAdmin, 'open');
  customer = await person();
  a = await memberOf('Ramesh Sahu');
  b = await memberOf('Suresh Verma');
});

const ZERO = '00000000-0000-7000-8000-000000000000';
const ROUTES: [string, string, unknown][] = [
  ['PUT', `/ustaad/follows/${ZERO}`, undefined],
  ['DELETE', `/ustaad/follows/${ZERO}`, undefined],
  ['GET', '/ustaad/follows', undefined],
  ['DELETE', `/ustaad/followers/${ZERO}`, undefined],
  ['GET', `/ustaad/members/${ZERO}/relationship`, undefined],
  ['POST', '/ustaad/connections', { nonsense: true }],
  ['GET', '/ustaad/connections', undefined],
  ['POST', `/ustaad/connections/${ZERO}/accept`, undefined],
  ['PUT', `/ustaad/blocks/${ZERO}`, undefined],
  ['DELETE', `/ustaad/blocks/${ZERO}`, undefined],
  ['GET', '/ustaad/blocks', undefined],
  ['PUT', `/ustaad/mutes/${ZERO}`, undefined],
  ['DELETE', `/ustaad/mutes/${ZERO}`, undefined],
  ['GET', '/ustaad/threads', undefined],
  ['POST', '/ustaad/threads', { nonsense: true }],
  ['POST', `/ustaad/threads/${ZERO}/accept`, undefined],
  ['POST', `/ustaad/threads/${ZERO}/decline`, undefined],
  ['GET', `/ustaad/threads/${ZERO}/messages`, undefined],
  ['POST', `/ustaad/threads/${ZERO}/messages`, {}],
  ['POST', `/ustaad/threads/${ZERO}/read`, undefined],
  ['PUT', `/ustaad/threads/${ZERO}/mute`, {}],
  ['GET', '/ustaad/discover', undefined],
  ['GET', '/ustaad/discover/tags', undefined],
  ['GET', '/ustaad/discover/top-posts', undefined],
  ['GET', '/ustaad/promotions?slot=feed', undefined],
  ['POST', `/ustaad/promotions/${ZERO}/click`, undefined],
  ['POST', `/ustaad/promotions/${ZERO}/hide`, {}],
];

describe('role leak (gate + member guard before validation)', () => {
  it('signed out → 401 while open; a customer who is not a member → 404 on every D2 route', async () => {
    expect((await call(null, 'GET', '/ustaad/threads')).status).toBe(401);
    for (const [method, path, body] of ROUTES)
      expect((await call(customer, method, path, body)).status, `${method} ${path}`).toBe(404);
  });

  it('staff preview: a member who is not staff gets 404 on every D2 route', async () => {
    await setAccess(superAdmin, 'staff_preview');
    try {
      for (const [method, path, body] of ROUTES)
        expect((await call(a, method, path, body)).status, `${method} ${path}`).toBe(404);
    } finally {
      await setAccess(superAdmin, 'open');
    }
  });

  it('strict bodies: unknown fields are refused (no mass assignment)', async () => {
    const r = await call(a, 'POST', '/ustaad/threads', { memberId: b.memberId, text: 'hi', status: 'open' });
    expect(r.status).toBe(400);
    const c = await call(a, 'POST', '/ustaad/connections', { memberId: b.memberId, status: 'accepted' });
    expect(c.status).toBe(400);
  });
});

describe('follow, connect, message (flow 7)', () => {
  it('follow → request → accept → reply; no phone number anywhere', async () => {
    const f = await call(a, 'PUT', `/ustaad/follows/${b.memberId}`);
    expect(f.status).toBe(200);
    expect(f.body).toMatchObject({ following: true, followers: 1 });
    const started = await call(a, 'POST', '/ustaad/threads', { memberId: b.memberId, text: 'Ram ram bhai' });
    expect(started.status).toBe(201);
    expect(started.body.status).toBe('requested');
    const threadId = started.body.threadId as string;
    const reqs = await call(b, 'GET', '/ustaad/threads?box=requests');
    expect((reqs.body.items as { id: string }[]).map((x) => x.id)).toContain(threadId);
    const [x, y] = await Promise.all([
      call(b, 'POST', `/ustaad/threads/${threadId}/accept`),
      call(b, 'POST', `/ustaad/threads/${threadId}/accept`),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 404]);
    const reply = await call(b, 'POST', `/ustaad/threads/${threadId}/messages`, {
      kind: 'text',
      text: 'Haan bolo',
    });
    expect(reply.status).toBe(201);
    const page = await call(a, 'GET', `/ustaad/threads/${threadId}/messages`);
    expect(page.status).toBe(200);
    expect((page.body.items as unknown[]).length).toBe(2);
    const rel = await call(a, 'GET', `/ustaad/members/${b.memberId}/relationship`);
    expect(rel.body).toMatchObject({ following: true, threadId });
    for (const r of [f, started, reqs, reply, page, rel]) expect(r.text).not.toMatch(/\+91|9400\d/);
  });

  it('connect: request then accept from the other side; a stranger gets 404', async () => {
    const c = await memberOf('Connect One');
    const d = await memberOf('Connect Two');
    const req = await call(c, 'POST', '/ustaad/connections', { memberId: d.memberId });
    expect(req.status).toBe(201);
    const id = req.body.id as string;
    expect((await call(a, 'POST', `/ustaad/connections/${id}/accept`)).status).toBe(404);
    const ok = await call(d, 'POST', `/ustaad/connections/${id}/accept`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('accepted');
    const list = await call(c, 'GET', '/ustaad/connections?box=connected');
    expect((list.body.items as unknown[]).length).toBe(1);
  });

  it('a link in a first message → 422 USTAAD_DM_LINK', async () => {
    const c = await memberOf('Link Sender');
    const d = await memberOf('Link Receiver');
    const r = await call(c, 'POST', '/ustaad/threads', {
      memberId: d.memberId,
      text: 'www.example.com dekho',
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('USTAAD_DM_LINK');
  });

  it('block → 404 both ways on relationship, follow and messages', async () => {
    const c = await memberOf('Blocker');
    const d = await memberOf('Blocked');
    expect((await call(c, 'PUT', `/ustaad/blocks/${d.memberId}`)).status).toBe(200);
    expect((await call(d, 'GET', `/ustaad/members/${c.memberId}/relationship`)).status).toBe(404);
    expect((await call(c, 'GET', `/ustaad/members/${d.memberId}/relationship`)).status).toBe(404);
    expect((await call(d, 'PUT', `/ustaad/follows/${c.memberId}`)).status).toBe(404);
    expect((await call(d, 'POST', '/ustaad/threads', { memberId: c.memberId, text: 'suno' })).status).toBe(
      404,
    );
    const blocks = await call(c, 'GET', '/ustaad/blocks');
    expect((blocks.body.blocked as { id: string }[]).map((x) => x.id)).toEqual([d.memberId]);
  });

  it('the 21st follow in a day → 429 with Retry-After (AT-RATE-1)', async () => {
    const fan = await memberOf('Big Fan');
    const targets: Person[] = [];
    for (let i = 0; i < 21; i += 1) targets.push(await memberOf(`Target ${String(i)}`));
    for (let i = 0; i < 20; i += 1)
      expect((await call(fan, 'PUT', `/ustaad/follows/${targets[i]?.memberId ?? ''}`)).status).toBe(200);
    const r = await call(fan, 'PUT', `/ustaad/follows/${targets[20]?.memberId ?? ''}`);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).not.toBeNull();
  });
});

describe('Discover and promotions', () => {
  it('Discover answers 20 at most, a cursor and no total; tags and top posts answer', async () => {
    const r = await call(a, 'GET', '/ustaad/discover');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect((r.body.items as unknown[]).length).toBeLessThanOrEqual(20);
    expect(r.body).not.toHaveProperty('total');
    expect(r.text).not.toMatch(/\+91/);
    expect((await call(a, 'GET', '/ustaad/discover/tags')).status).toBe(200);
    expect((await call(a, 'GET', '/ustaad/discover/top-posts')).status).toBe(200);
    expect((await call(a, 'GET', '/ustaad/discover?q=x')).status).toBe(400);
  });

  it('serves a live promotion with the locked label and an internal link; click returns it; answer_parts is not a slot', async () => {
    const [p] = await ctx.db
      .insert(s.ustaadPromotions)
      .values({
        slot: 'feed',
        titleEn: 'Battery week',
        titleHi: 'बैटरी सप्ताह',
        target: 'url_internal',
        targetId: '/shop?category=batteries',
        startsAt: new Date(Date.now() - DAY),
        endsAt: new Date(Date.now() + DAY),
        status: 'live',
      })
      .returning();
    if (!p) throw new Error('promo');
    const r = await call(a, 'GET', '/ustaad/promotions?slot=feed');
    expect(r.status).toBe(200);
    expect(r.body.promotion).toMatchObject({
      label: { en: 'Sponsored', hi: 'प्रायोजित' },
      href: '/shop?category=batteries',
    });
    const click = await call(a, 'POST', `/ustaad/promotions/${p.id}/click`);
    expect(click.body).toEqual({ href: '/shop?category=batteries' });
    expect((await call(a, 'GET', '/ustaad/promotions?slot=answer_parts')).status).toBe(400);
    expect(
      (await call(a, 'POST', `/ustaad/promotions/${p.id}/hide`, { reason: 'not_relevant' })).status,
    ).toBe(200);
    expect((await call(a, 'GET', '/ustaad/promotions?slot=feed')).body.promotion).toBeNull();
  });
});

describe('staff read a thread only through a report (SR-38)', () => {
  it('community manager with an open report reads it (audited); marketing and customers are refused', async () => {
    const c = await memberOf('Report Sender');
    const d = await memberOf('Report Receiver');
    const started = await call(c, 'POST', '/ustaad/threads', { memberId: d.memberId, text: 'namaste ji' });
    const message = (await ctx.db.select().from(s.ustaadMessages)).find(
      (m) => m.threadId === started.body.threadId,
    );
    if (!message) throw new Error('message');
    await ctx.db.insert(s.ustaadReports).values({
      code: 'UR-RPR-2026-QQQQQQ',
      targetType: 'message',
      targetId: message.id,
      reporterId: d.memberId,
      cityId: raipurId,
      reasonCode: 'abuse',
      dueAt: new Date(Date.now() + DAY),
    });
    const path = '/admin/ustaad/threads/read?reportCode=UR-RPR-2026-QQQQQQ&reason=report_review';
    const manager = await person('community_manager', raipurId);
    const ok = await call(manager, 'GET', path);
    expect(ok.status).toBe(200);
    expect((ok.body.messages as unknown[]).length).toBe(1);
    expect(ok.text).not.toMatch(/\+91/);
    expect((await call(await person('marketing'), 'GET', path)).status).toBe(403);
    expect((await call(customer, 'GET', path)).status).toBe(403);
    expect(
      (
        await call(
          manager,
          'GET',
          '/admin/ustaad/threads/read?reportCode=UR-RPR-2026-ZZZZZZ&reason=report_review',
        )
      ).status,
    ).toBe(404);
    expect(
      (await call(manager, 'GET', '/admin/ustaad/threads/read?reportCode=UR-RPR-2026-QQQQQQ')).status,
    ).toBe(400);
  });
});
