/**
 * Ustaad Q&A and Learn over HTTP (spec 23 § 8; plan tasks C1–C2): the gate and the member guard come before
 * validation (role-leak: signed out, customer and non-member all get the unknown-path 404), the ask → answer →
 * helpful → best flow, the answer gate by track, strict bodies (no mass assignment), no phone in any response, the
 * daily question rate limit (429), Learn read + progress.
 */
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
    firebaseUid: `ustaad-qa-api-${id}`,
    phone: `+9195000${id.padStart(5, '0')}`,
    email: `ustaad-qa-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-qa-api-00000${id}`, { ...identity, staff2fa: true });
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

const join = (track: 'apprentice' | 'ustaad', displayName: string) => ({
  track,
  specialities: ['two_wheeler', 'engine'],
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
let chhotu: Person;
let ustaad: Person;
let k = 0;
const key = () => {
  k += 1;
  return `idem-key-${String(k).padStart(6, '0')}`;
};

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
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipur.id });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipur.id });
  superAdmin = await person('super_admin');
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  const r = await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value: 'open',
    version: row?.version ?? null,
  });
  expect(r.status).toBe(200);
  customer = await person();
  chhotu = await person();
  ustaad = await person();
  expect((await call(chhotu, 'POST', '/ustaad/join', join('apprentice', 'Chhotu Ram'))).status).toBe(201);
  const u = await call(ustaad, 'POST', '/ustaad/join', join('ustaad', 'Ramesh Sahu'));
  expect(u.status).toBe(201);
  // A verified Naya Ustaad (workstream B owns verification; the test sets the level directly).
  const { eq } = await import('@mechdost/db/testing');
  await ctx.db
    .update(s.ustaadMembers)
    .set({ level: 'naya' })
    .where(eq(s.ustaadMembers.id, u.body.id as string));
});

describe('role leak (gate + member guard before validation)', () => {
  it('signed out → 401 while open; a customer who is not a member → 404 on every Q&A and Learn route', async () => {
    expect((await call(null, 'GET', '/ustaad/questions')).status).toBe(401);
    for (const [method, path, body] of [
      ['GET', '/ustaad/questions', undefined],
      ['POST', '/ustaad/questions', { nonsense: true }],
      ['GET', '/ustaad/questions/UQ-RPR-2026-AAAAAA', undefined],
      ['POST', '/ustaad/questions/UQ-RPR-2026-AAAAAA/answers', {}],
      ['POST', '/ustaad/answers/00000000-0000-7000-8000-000000000000/helpful', undefined],
      ['GET', '/ustaad/learn', undefined],
      ['PUT', '/ustaad/learn/00000000-0000-7000-8000-000000000000/progress', {}],
    ] as const) {
      const r = await call(customer, method, path, body);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe('ask → answer → helpful → best', () => {
  it('runs end to end with no phone in any response', async () => {
    const asked = await call(chhotu, 'POST', '/ustaad/questions', {
      title: 'Activa 6G pickup kam hai',
      segmentCode: 'two_wheeler',
      workCode: 'engine',
      idemKey: key(),
    });
    expect(asked.status).toBe(201);
    const code = asked.body.code as string;
    expect(code).toMatch(/^UQ-RPR-\d{4}-[A-Z2-7]{6}$/);

    const refused = await call(chhotu, 'POST', `/ustaad/questions/${code}/answers`, {
      body: 'Main bhi',
      idemKey: key(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('USTAAD_CANNOT_ANSWER');

    const answered = await call(ustaad, 'POST', `/ustaad/questions/${code}/answers`, {
      body: 'Carburettor saaf karo, plug badlo',
      idemKey: key(),
    });
    expect(answered.status).toBe(201);
    const answerId = answered.body.id as string;

    const self = await call(ustaad, 'POST', `/ustaad/answers/${answerId}/helpful`);
    expect(self.body.error.code).toBe('USTAAD_SELF_VOTE');
    const vote = await call(chhotu, 'POST', `/ustaad/answers/${answerId}/helpful`);
    expect(vote.body).toEqual({ helpfulCount: 1, voted: true });

    expect((await call(ustaad, 'POST', `/ustaad/questions/${code}/best`, { answerId })).status).toBe(404);
    expect((await call(chhotu, 'POST', `/ustaad/questions/${code}/best`, { answerId })).status).toBe(200);
    const again = await call(chhotu, 'POST', `/ustaad/questions/${code}/best`, { answerId });
    expect(again.status).toBe(409);

    const thread = await call(chhotu, 'GET', `/ustaad/questions/${code}`);
    expect(thread.status).toBe(200);
    expect(thread.body.status).toBe('solved');
    expect(thread.text).not.toContain('+91');
    const listed = await call(ustaad, 'GET', '/ustaad/questions?filter=all');
    expect(listed.text).not.toContain('+91');
  });

  it('strict bodies: a status or asker in the body is refused (no mass assignment)', async () => {
    const r = await call(chhotu, 'POST', '/ustaad/questions', {
      title: 'Brake fail',
      status: 'solved',
      idemKey: key(),
    });
    expect(r.status).toBe(400);
  });

  it('the 11th question in a day → 429 with Retry-After', async () => {
    const m = await person();
    expect((await call(m, 'POST', '/ustaad/join', join('apprentice', 'Naya Chhotu'))).status).toBe(201);
    for (let i = 0; i < 10; i += 1)
      expect(
        (await call(m, 'POST', '/ustaad/questions', { title: `Sawaal ${String(i)}`, idemKey: key() })).status,
      ).toBe(201);
    const r = await call(m, 'POST', '/ustaad/questions', { title: 'One more', idemKey: key() });
    expect(r.status).toBe(429);
  });
});

describe('restricted members read only', () => {
  it('each write route → 403 USTAAD_RESTRICTED; reads still work', async () => {
    const asked = await call(chhotu, 'POST', '/ustaad/questions', { title: 'Clutch slip', idemKey: key() });
    const code = asked.body.code as string;
    const a = await call(ustaad, 'POST', `/ustaad/questions/${code}/answers`, {
      body: 'Plate badlo',
      idemKey: key(),
    });
    const answerId = a.body.id as string;
    const { eq } = await import('@mechdost/db/testing');
    const [row] = await ctx.db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.userId, chhotu.id));
    await ctx.db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, row?.id ?? ''));
    const writes = [
      await call(chhotu, 'POST', '/ustaad/questions', { title: 'Another', idemKey: key() }),
      await call(chhotu, 'POST', `/ustaad/answers/${answerId}/helpful`),
      await call(chhotu, 'POST', `/ustaad/questions/${code}/best`, { answerId }),
      await call(chhotu, 'PUT', `/ustaad/answers/${answerId}/parts`, { productIds: [] }),
    ];
    for (const w of writes) {
      expect(w.status).toBe(403);
      expect(w.body.error.code).toBe('USTAAD_RESTRICTED');
    }
    expect((await call(chhotu, 'GET', `/ustaad/questions/${code}`)).status).toBe(200);
    await ctx.db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'none' })
      .where(eq(s.ustaadMembers.id, row?.id ?? ''));
  });
});

describe('learn', () => {
  it('lists courses and records progress', async () => {
    const [course] = await ctx.db
      .insert(s.ustaadCourses)
      .values({ code: 'basics', titleEn: 'Basics', titleHi: 'बुनियादी बातें' })
      .returning();
    const [res] = await ctx.db
      .insert(s.ustaadLearningResources)
      .values({
        courseId: course?.id ?? null,
        kind: 'external_link',
        titleEn: 'Spark plug basics',
        titleHi: 'स्पार्क प्लग की बातें',
        url: 'https://example.com/spark',
      })
      .returning();
    const view = await call(chhotu, 'GET', '/ustaad/learn');
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).toContain('बुनियादी बातें');
    const p = await call(chhotu, 'PUT', `/ustaad/learn/${res?.id ?? ''}/progress`, { selfMark: true });
    expect(p.body).toEqual({ watchedSeconds: 0, completed: true });
  });
});
