/**
 * Saved API (spec 23 § 5 Saved; design 2026-11-28-mechanic-network-saved-design.md): every route is members-only
 * (404 for a customer, 401 signed out), strict bodies, save any kind by path, the mixed list with filters, the summary,
 * collections (404 for another member's), and a stale rename is 409.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;
interface Person {
  id: string;
  headers: Record<string, string>;
}
let n = 0;

async function person(role?: string): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-saved-api-${id}`,
    phone: `+9195200${id.padStart(5, '0')}`,
    email: `ustaad-saved-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-saved-api-000${id}`, { ...identity, staff2fa: true });
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
  return {
    status: res.status,
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

async function member(name: string): Promise<Person> {
  const p = await person();
  const r = await call(p, 'POST', '/ustaad/join', join(name));
  expect(r.status, r.text).toBe(201);
  return p;
}

beforeAll(async () => {
  ctx = await buildApp({
    turnstile: new FakeTurnstile(['human-token-123']),
    env: { USTAAD_SHARE_SECRET: 'x'.repeat(40) },
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
  superAdmin = await person('super_admin');
  customer = await person();
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  const open = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value: 'open',
    version: row?.version ?? null,
  });
  expect(open.status, open.text).toBe(200);
  ramesh = await member('Ramesh Sahu');
  suresh = await member('Suresh Verma');
});

const ROUTES: [string, string, unknown?][] = [
  ['GET', '/ustaad/saves'],
  ['GET', '/ustaad/saves/summary'],
  ['PUT', `/ustaad/saves/lesson/${randomUUID()}`],
  ['DELETE', `/ustaad/saves/lesson/${randomUUID()}`],
  ['POST', '/ustaad/save-collections', { name: 'Wiring' }],
  ['PATCH', `/ustaad/save-collections/${randomUUID()}`, { name: 'x', version: 1 }],
  ['DELETE', `/ustaad/save-collections/${randomUUID()}`],
  ['PUT', `/ustaad/save-collections/${randomUUID()}/items/post/${randomUUID()}`],
  ['DELETE', `/ustaad/save-collections/${randomUUID()}/items/post/${randomUUID()}`],
];

describe('saved API', () => {
  it('signed out 401; a customer who is not a member gets 404 everywhere', async () => {
    expect((await call(null, 'GET', '/ustaad/saves')).status).toBe(401);
    for (const [method, path, body] of ROUTES) {
      const r = await call(customer, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });

  it('save a post and a lesson, list, filter, summary; unknown kind 400; foreign lesson id 404', async () => {
    const post = await call(ramesh, 'POST', '/ustaad/posts', {
      kind: 'text',
      body: 'Wiring tip: earth wire first',
      idemKey: `idem-${randomUUID().slice(0, 12)}`,
    });
    expect(post.status, post.text).toBe(201);
    const postId = post.body.id as string;
    const [lesson] = await ctx.db
      .insert(s.ustaadLearningResources)
      .values({
        kind: 'external_link',
        titleEn: 'Relay basics',
        titleHi: 'रिले की बातें',
        url: 'https://example.com/r',
      })
      .returning();
    const lessonId = lesson?.id ?? '';
    expect((await call(suresh, 'PUT', `/ustaad/saves/post/${postId}`)).body).toEqual({ saved: true });
    expect((await call(suresh, 'PUT', `/ustaad/saves/lesson/${lessonId}`)).body).toEqual({ saved: true });
    expect((await call(suresh, 'PUT', `/ustaad/saves/recipe/${lessonId}`)).status).toBe(400);
    expect((await call(suresh, 'PUT', `/ustaad/saves/lesson/${randomUUID()}`)).status).toBe(404);
    const all = await call(suresh, 'GET', '/ustaad/saves');
    expect((all.body.items as { kind: string }[]).map((i) => i.kind)).toEqual(['lesson', 'post']);
    const found = await call(suresh, 'GET', '/ustaad/saves?q=wiring');
    expect((found.body.items as { id: string }[]).map((i) => i.id)).toEqual([postId]);
    const summary = await call(suresh, 'GET', '/ustaad/saves/summary');
    expect(summary.body.total).toBe(2);
    expect((summary.body.counts as Record<string, number>).lesson).toBe(1);
    expect((await call(suresh, 'DELETE', `/ustaad/saves/lesson/${lessonId}`)).body).toEqual({ saved: false });
  });

  it('collections: strict body, create, add, filter, stale rename 409, foreign 404, delete 204', async () => {
    expect(
      (await call(suresh, 'POST', '/ustaad/save-collections', { name: 'x', memberId: randomUUID() })).status,
    ).toBe(400);
    expect((await call(suresh, 'POST', '/ustaad/save-collections', { name: '<b>' })).status).toBe(400);
    const c = await call(suresh, 'POST', '/ustaad/save-collections', { name: 'Wiring' });
    expect(c.status, c.text).toBe(201);
    const id = c.body.id as string;
    expect((await call(suresh, 'POST', '/ustaad/save-collections', { name: 'WIRING' })).status).toBe(409);
    const items = await call(suresh, 'GET', '/ustaad/saves?kind=post');
    const postId = (items.body.items as { id: string }[])[0]?.id ?? '';
    expect((await call(suresh, 'PUT', `/ustaad/save-collections/${id}/items/post/${postId}`)).status).toBe(
      204,
    );
    const inC = await call(suresh, 'GET', `/ustaad/saves?collectionId=${id}`);
    expect((inC.body.items as { id: string }[]).map((i) => i.id)).toEqual([postId]);
    expect(
      (await call(suresh, 'PATCH', `/ustaad/save-collections/${id}`, { name: 'Wires', version: 1 })).status,
    ).toBe(200);
    expect(
      (await call(suresh, 'PATCH', `/ustaad/save-collections/${id}`, { name: 'W', version: 1 })).status,
    ).toBe(409);
    expect((await call(ramesh, 'DELETE', `/ustaad/save-collections/${id}`)).status).toBe(404);
    expect((await call(ramesh, 'GET', `/ustaad/saves?collectionId=${id}`)).status).toBe(404);
    expect((await call(suresh, 'DELETE', `/ustaad/save-collections/${id}`)).status).toBe(204);
  });
});
