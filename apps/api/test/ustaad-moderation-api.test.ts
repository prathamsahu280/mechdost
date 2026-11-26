/**
 * Ustaad reports and moderation over HTTP (spec 23 § 3, § 8, § 13; plan task F2): the role-leak matrix (signed out
 * 401; a customer 404 on member routes and 403 on staff routes; support, finance and marketing 403; a city-A
 * community manager 404 on city B; super admin everything), report → act remove with the objects moved out of the
 * live bucket and the signed URL refused (AT-TAKEDOWN-1 for media), the takedown fast path, strict bodies, the 21st
 * report in a day → 429, and AT-UP-9 (a test hash list: the upload is refused, the file sealed in the evidence
 * bucket, the account frozen, a POCSO report opened).
 */
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { HashListImageSafetyClassifier } from '../src/ustaad/safety/classifier';
import { bearer, buildApp, FakeTurnstile, type ErrorJson } from './helpers';
import { MemoryHost } from './ustaad-memory-host';

let ctx: Awaited<ReturnType<typeof buildApp>>;
let host: MemoryHost;
interface Person {
  id: string;
  headers: Record<string, string>;
}
let n = 0;
let raipurId = '';
let bilaspurId = '';
let blocked: Uint8Array;

async function person(role?: string, cityId: string | null = null): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-mod-api-${id}`,
    phone: `+9194000${id.padStart(5, '0')}`,
    email: `ustaad-mod-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-mod-api-0000${id}`, { ...identity, staff2fa: true });
  const user = await ensureUser(ctx.db, identity);
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
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
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const JOIN = (displayName: string) => ({
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
let cmRaipur: Person;
let cmBilaspur: Person;
let support: Person;
let finance: Person;
let marketing: Person;
let customer: Person;
let author: Person;
let authorMemberId = '';
let viewer: Person;
let viewerMemberId = '';

async function seedPost(
  withMedia: boolean,
): Promise<{ postId: string; mediaId: string | null; key: string }> {
  const [p] = await ctx.db
    .insert(s.ustaadPosts)
    .values({ authorId: authorMemberId, cityId: raipurId, kind: 'photo', body: 'Clutch plate badla' })
    .returning();
  if (!p) throw new Error('post');
  if (!withMedia) return { postId: p.id, mediaId: null, key: '' };
  const key = `m/${authorMemberId}/${randomUUID()}.webp`;
  host.objects.set(`media:${key}`, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' });
  const [m] = await ctx.db
    .insert(s.ustaadMedia)
    .values({
      ownerMemberId: authorMemberId,
      host: 'supabase',
      bucket: 'media',
      kind: 'image',
      status: 'verified',
      declaredBytes: 3,
      declaredMime: 'image/webp',
      sha256: 'd'.repeat(64),
      objectKey: key,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  await ctx.db.insert(s.ustaadPostMedia).values({ postId: p.id, mediaId: m?.id ?? '', position: 0 });
  return { postId: p.id, mediaId: m?.id ?? null, key };
}

beforeAll(async () => {
  host = new MemoryHost();
  blocked = new Uint8Array(
    await sharp({ create: { width: 320, height: 240, channels: 3, background: '#ea5728' } })
      .jpeg()
      .toBuffer(),
  );
  ctx = await buildApp({
    turnstile: new FakeTurnstile(['human-token-123']),
    mediaHost: host,
    safetyClassifier: new HashListImageSafetyClassifier(new Set([sha(blocked)])),
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
  const [bilaspur] = await ctx.db
    .insert(s.cities)
    .values({ stateId: state.id, code: 'BLP', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
    .returning();
  raipurId = raipur?.id ?? '';
  bilaspurId = bilaspur?.id ?? '';
  await ctx.db.insert(s.pincodes).values({ pincode: '492001', stateId: state.id, cityId: raipurId });
  await ctx.db.insert(s.ustaadReachCities).values({ cityId: raipurId });
  superAdmin = await person('super_admin');
  const list = await call(superAdmin, 'GET', '/admin/ustaad/settings');
  const row = (list.body.settings as { key: string; version: number | null }[]).find(
    (r) => r.key === 'ustaad.access',
  );
  expect(
    (
      await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
        value: 'open',
        version: row?.version ?? null,
      })
    ).status,
  ).toBe(200);
  cmRaipur = await person('community_manager', raipurId);
  cmBilaspur = await person('community_manager', bilaspurId);
  support = await person('support_agent');
  finance = await person('finance');
  marketing = await person('marketing');
  customer = await person();
  author = await person();
  viewer = await person();
  const a = await call(author, 'POST', '/ustaad/join', JOIN('Ramesh Sahu'));
  expect(a.status).toBe(201);
  authorMemberId = a.body.id as string;
  const v = await call(viewer, 'POST', '/ustaad/join', JOIN('Suresh Verma'));
  expect(v.status).toBe(201);
  viewerMemberId = v.body.id as string;
  // Settled accounts (pre-moderation and link rules are not under test here).
  await ctx.db
    .update(s.ustaadMembers)
    .set({ joinedAt: new Date(Date.now() - 90 * 86_400_000) })
    .where(eq(s.ustaadMembers.id, viewerMemberId));
});

const report = (p: Person, targetId: string, reasonCode = 'abuse') =>
  call(p, 'POST', '/ustaad/reports', { targetType: 'post', targetId, reasonCode });

describe('role-leak matrix (spec 23 § 3, security review § 4.2)', () => {
  it('signed out 401; a customer 404 on the member route; customer, support, finance, marketing 403 on staff routes', async () => {
    const id = '00000000-0000-7000-8000-000000000000';
    expect((await call(null, 'POST', '/ustaad/reports', {})).status).toBe(401);
    expect((await call(customer, 'POST', '/ustaad/reports', { nonsense: true })).status).toBe(404);
    for (const p of [customer, support, finance, marketing]) {
      for (const [method, path, payload] of [
        ['GET', '/admin/ustaad/moderation/reports', undefined],
        ['GET', '/admin/ustaad/moderation/reports/UR-RPR-2026-AAAAAA', undefined],
        ['POST', '/admin/ustaad/moderation/reports/UR-RPR-2026-AAAAAA/act', {}],
        ['GET', '/admin/ustaad/moderation/reports/UR-RPR-2026-AAAAAA/thread?reason=report_review', undefined],
        ['POST', '/admin/ustaad/moderation/takedowns', { targetType: 'post', targetId: id }],
      ] as const)
        expect((await call(p, method, path, payload)).status, `${method} ${path}`).toBe(403);
    }
    expect((await call(null, 'GET', '/admin/ustaad/moderation/reports')).status).toBe(401);
  });

  it('a city-A manager sees and acts on city A only; city B gets 404; super admin sees all', async () => {
    const p = await seedPost(false);
    const r = await report(viewer, p.postId);
    expect(r.status).toBe(201);
    const code = r.body.code as string;
    expect((await call(cmRaipur, 'GET', `/admin/ustaad/moderation/reports/${code}`)).status).toBe(200);
    expect((await call(cmBilaspur, 'GET', `/admin/ustaad/moderation/reports/${code}`)).status).toBe(404);
    const bq = await call(cmBilaspur, 'GET', '/admin/ustaad/moderation/reports');
    expect(bq.status).toBe(200);
    expect(bq.body.items).toEqual([]);
    expect((await call(cmBilaspur, 'GET', '/admin/ustaad/moderation/reports?city=RPR')).status).toBe(404);
    expect(
      (
        await call(cmBilaspur, 'POST', `/admin/ustaad/moderation/reports/${code}/act`, {
          action: 'keep',
          reasonCode: 'no_violation',
          version: 1,
        })
      ).status,
    ).toBe(404);
    const all = await call(superAdmin, 'GET', '/admin/ustaad/moderation/reports');
    expect((all.body.items as { code: string }[]).some((i) => i.code === code)).toBe(true);
    // No phone number anywhere in staff views.
    expect(all.text).not.toMatch(/\+91\d{10}/);
  });
});

describe('report → remove (AT-TAKEDOWN-1, media)', () => {
  it('moves the objects out of the live bucket and the signed URL is refused', async () => {
    const p = await seedPost(true);
    expect((await call(viewer, 'GET', `/ustaad/media/${String(p.mediaId)}/url`)).status).toBe(200);
    const r = await report(viewer, p.postId);
    const code = r.body.code as string;
    const bad = await call(cmRaipur, 'POST', `/admin/ustaad/moderation/reports/${code}/act`, {
      action: 'remove',
      reasonCode: 'abuse',
      version: 1,
      status: 'overturned',
    });
    expect(bad.status).toBe(400);
    const done = await call(cmRaipur, 'POST', `/admin/ustaad/moderation/reports/${code}/act`, {
      action: 'remove',
      reasonCode: 'abuse',
      version: 1,
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'actioned', mediaMoved: 1, mediaMoveFailed: 0 });
    expect(host.objects.has(`media:${p.key}`)).toBe(false);
    expect([...host.objects.keys()].some((k) => k.startsWith(`evidence:e/${authorMemberId}/`))).toBe(true);
    expect((await call(viewer, 'GET', `/ustaad/media/${String(p.mediaId)}/url`)).status).toBe(404);
    const [arch] = await ctx.db
      .select()
      .from(s.ustaadRemovedArchive)
      .where(eq(s.ustaadRemovedArchive.targetId, p.postId));
    expect(arch).toBeDefined();
  });

  it('the takedown fast path is one call, needs ustaad:takedown and reports the seconds taken', async () => {
    const p = await seedPost(true);
    const body = { targetType: 'post', targetId: p.postId, basis: 'court_order', reference: 'W.P. 7/2026' };
    expect((await call(support, 'POST', '/admin/ustaad/moderation/takedowns', body)).status).toBe(403);
    const r = await call(cmRaipur, 'POST', '/admin/ustaad/moderation/takedowns', body);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'actioned', mediaMoved: 1 });
    expect(r.body.seconds as number).toBeLessThan(60);
    expect((await call(viewer, 'GET', `/ustaad/media/${String(p.mediaId)}/url`)).status).toBe(404);
  });
});

describe('member reports', () => {
  it('unknown fields are refused; the 21st report in a day answers 429', async () => {
    const p = await seedPost(false);
    expect(
      (
        await call(viewer, 'POST', '/ustaad/reports', {
          targetType: 'post',
          targetId: p.postId,
          reasonCode: 'spam',
          x: 1,
        })
      ).status,
    ).toBe(400);
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const q = await seedPost(false);
      last = (await report(viewer, q.postId, 'spam')).status;
    }
    expect(last).toBe(429);
  });
});

describe('AT-UP-9 (classifier test double)', () => {
  it('a hash-list hit refuses the upload, seals the file, freezes the account and opens a POCSO report', async () => {
    const uploader = await person();
    const j = await call(uploader, 'POST', '/ustaad/join', JOIN('Test Uploader'));
    expect(j.status).toBe(201);
    const memberId = j.body.id as string;
    const d = await call(uploader, 'POST', '/ustaad/media', {
      kind: 'image',
      mime: 'image/jpeg',
      bytes: blocked.byteLength,
      sha256: sha(blocked),
    });
    expect(d.status).toBe(201);
    host.upload((d.body.put as { url: string }).url, blocked, 'image/jpeg');
    const done = await call(uploader, 'POST', `/ustaad/media/${String(d.body.mediaId)}/complete`, {});
    expect(done.status).toBe(422);
    const [m] = await ctx.db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, d.body.mediaId as string));
    expect(m).toMatchObject({
      status: 'rejected',
      rejectReasonCode: 'safety_block',
      bucket: 'evidence',
      legalHold: 'pocso',
    });
    expect(host.objects.has(`evidence:${m?.objectKey ?? ''}`)).toBe(true);
    expect([...host.objects.keys()].some((k) => k.startsWith('quarantine:') && k.includes(memberId))).toBe(
      false,
    );
    const [frozen] = await ctx.db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, memberId));
    expect(frozen).toMatchObject({ status: 'restricted', restrictedMode: 'review' });
    const reports = await ctx.db.select().from(s.ustaadReports).where(eq(s.ustaadReports.targetId, memberId));
    expect(reports[0]).toMatchObject({ source: 'auto_safety', clock: 'intimate_2h' });
  });
});
