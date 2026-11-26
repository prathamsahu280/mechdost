/**
 * Community manager console over HTTP (spec 23 § 3, § 13; SR-38; plan task G2): the role-leak matrix for the new
 * staff routes (signed out 401; support, finance and marketing 403; ops read-only where they read; a city-A manager
 * 404 on city B; super admin everything), the capabilities the UI reads, the audited short-lived media URL
 * (moderators only, no-store), members search / detail / restrict / unban, the legal list, and the own audit trail.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
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

async function person(role?: string, cityId: string | null = null): Promise<Person> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const identity = {
    firebaseUid: `ustaad-con-api-${id}`,
    phone: `+9194100${id.padStart(5, '0')}`,
    email: `ustaad-con-api-${id}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-ustaad-con-api-0000${id}`, { ...identity, staff2fa: true });
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
    headers: res.headers,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};
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
let cmRaipur2: Person;
let cmRaipur3: Person;
let cmBilaspur: Person;
let ops: Person;
let support: Person;
let finance: Person;
let marketing: Person;
let author: Person;
let authorMemberId = '';
let authorHandle = '';
let viewer: Person;

async function reportedPostWithMedia(): Promise<{ code: string; mediaId: string }> {
  const [p] = await ctx.db
    .insert(s.ustaadPosts)
    .values({ authorId: authorMemberId, cityId: raipurId, kind: 'photo', body: 'Clutch plate badla' })
    .returning();
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
  await ctx.db.insert(s.ustaadPostMedia).values({ postId: p?.id ?? '', mediaId: m?.id ?? '', position: 0 });
  const r = await call(viewer, 'POST', '/ustaad/reports', {
    targetType: 'post',
    targetId: p?.id,
    reasonCode: 'spam',
  });
  expect(r.status).toBe(201);
  return { code: r.body.code as string, mediaId: m?.id ?? '' };
}

beforeAll(async () => {
  host = new MemoryHost();
  ctx = await buildApp({ turnstile: new FakeTurnstile(['human-token-123']), mediaHost: host });
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
  await call(superAdmin, 'PUT', '/admin/ustaad/settings/ustaad.access', {
    value: 'open',
    version: row?.version ?? null,
  });
  cmRaipur = await person('community_manager', raipurId);
  cmRaipur2 = await person('community_manager', raipurId);
  cmRaipur3 = await person('community_manager', raipurId);
  cmBilaspur = await person('community_manager', bilaspurId);
  ops = await person('ops_manager');
  support = await person('support_agent');
  finance = await person('finance');
  marketing = await person('marketing');
  author = await person();
  viewer = await person();
  const a = await call(author, 'POST', '/ustaad/join', JOIN('Ramesh Sahu'));
  expect(a.status).toBe(201);
  authorMemberId = a.body.id as string;
  const [m] = await ctx.db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, authorMemberId));
  authorHandle = m?.handle ?? '';
  const v = await call(viewer, 'POST', '/ustaad/join', JOIN('Suresh Verma'));
  expect(v.status).toBe(201);
  await ctx.db
    .update(s.ustaadMembers)
    .set({ joinedAt: new Date(Date.now() - 90 * 86_400_000) })
    .where(eq(s.ustaadMembers.id, v.body.id as string));
});

describe('role-leak matrix for the console routes', () => {
  it('signed out 401; support, finance and marketing 403 on every console route', async () => {
    const id = '00000000-0000-7000-8000-000000000000';
    const routes = [
      ['GET', '/admin/ustaad/console', undefined],
      ['GET', '/admin/ustaad/members?q=ra', undefined],
      ['GET', `/admin/ustaad/members/${id}`, undefined],
      [
        'POST',
        `/admin/ustaad/members/${id}/sanction`,
        { action: 'restrict', reasonCode: 'spam', version: 1 },
      ],
      ['POST', `/admin/ustaad/members/${id}/unban`, { reasonCode: 'mistake', version: 1 }],
      ['POST', `/admin/ustaad/members/${id}/unban/confirm`, { proposalId: id, version: 1 }],
      ['GET', '/admin/ustaad/legal', undefined],
      ['GET', '/admin/ustaad/my-actions', undefined],
      [
        'GET',
        `/admin/ustaad/moderation/reports/UR-RPR-2026-AAAAAA/media/${id}?reason=report_review`,
        undefined,
      ],
    ] as const;
    for (const [method, path, payload] of routes)
      expect((await call(null, method, path, payload)).status, `anon ${path}`).toBe(401);
    for (const p of [support, finance, marketing])
      for (const [method, path, payload] of routes)
        expect((await call(p, method, path, payload)).status, `${method} ${path}`).toBe(403);
  });

  it('capabilities: a community manager moderates in their city; ops read only; super admin everything', async () => {
    const cm = await call(cmRaipur, 'GET', '/admin/ustaad/console');
    expect(cm.status).toBe(200);
    expect(cm.body).toMatchObject({
      moderate: true,
      verify: true,
      takedown: true,
      settings: false,
      cities: ['RPR'],
    });
    const o = await call(ops, 'GET', '/admin/ustaad/console');
    expect(o.body).toMatchObject({ read: true, moderate: false, verify: false, takedown: false });
    const sa = await call(superAdmin, 'GET', '/admin/ustaad/console');
    expect(sa.body).toMatchObject({ moderate: true, settings: true, cities: null });
  });
});

describe('staff media view', () => {
  it('a moderator gets a short-lived, uncached URL and every view is audited; ops 403; city B 404', async () => {
    const { code, mediaId } = await reportedPostWithMedia();
    const path = `/admin/ustaad/moderation/reports/${code}/media/${mediaId}?reason=report_review`;
    const r = await call(cmRaipur, 'GET', path);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'image', mime: 'image/webp' });
    expect(String(r.body.url)).toMatch(/^memory:\/\/media\/.+\?ttl=120$/);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect((await call(ops, 'GET', path)).status).toBe(403);
    expect((await call(cmBilaspur, 'GET', path)).status).toBe(404);
    expect(
      (await call(cmRaipur, 'GET', `/admin/ustaad/moderation/reports/${code}/media/${mediaId}`)).status,
    ).toBe(400);
    const audits = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, mediaId));
    expect(audits.filter((a) => a.action === 'ustaad.media_view')).toHaveLength(1);
  });
});

describe('members, legal list, own actions', () => {
  it('search and detail carry no phone or email; city B sees nothing', async () => {
    const q = authorHandle.slice(0, 4);
    const r = await call(cmRaipur, 'GET', `/admin/ustaad/members?q=${q}`);
    expect(r.status).toBe(200);
    expect((r.body.items as { memberId: string }[]).map((i) => i.memberId)).toContain(authorMemberId);
    expect(JSON.stringify(r.body)).not.toMatch(/\+91|@example\.com/);
    expect((await call(cmBilaspur, 'GET', `/admin/ustaad/members?q=${q}`)).body.items).toEqual([]);
    const d = await call(ops, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.body)).not.toMatch(/\+91|@example\.com/);
    expect((await call(cmBilaspur, 'GET', `/admin/ustaad/members/${authorMemberId}`)).status).toBe(404);
    expect((await call(cmRaipur, 'GET', '/admin/ustaad/members?q=a')).status).toBe(400);
  });

  it('restrict then unban (another staff member), with versions; ops cannot act', async () => {
    const d = await call(cmRaipur, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    const version = d.body.version as number;
    expect(
      (
        await call(ops, 'POST', `/admin/ustaad/members/${authorMemberId}/sanction`, {
          action: 'restrict',
          reasonCode: 'spam',
          version,
        })
      ).status,
    ).toBe(403);
    const r = await call(cmRaipur, 'POST', `/admin/ustaad/members/${authorMemberId}/sanction`, {
      action: 'restrict',
      reasonCode: 'spam',
      version,
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('actioned');
    const after = await call(cmRaipur, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    expect(after.body.status).toBe('restricted');
    const stale = await call(cmRaipur2, 'POST', `/admin/ustaad/members/${authorMemberId}/unban`, {
      reasonCode: 'mistake',
      version,
    });
    expect(stale.status).toBe(409);
    const u = await call(cmRaipur2, 'POST', `/admin/ustaad/members/${authorMemberId}/unban`, {
      reasonCode: 'mistake',
      version: after.body.version,
    });
    expect(u.status).toBe(200);
    expect(
      (
        await call(cmRaipur2, 'POST', `/admin/ustaad/members/${authorMemberId}/unban`, {
          reasonCode: 'other',
          version: 1,
        })
      ).status,
    ).toBe(400);
  });

  it('lifting a long ban: one staff member alone only proposes; the banning staff cannot; another confirms', async () => {
    let d = await call(cmRaipur, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    const ban = await call(cmRaipur, 'POST', `/admin/ustaad/members/${authorMemberId}/sanction`, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 30,
      version: d.body.version,
    });
    expect(ban.status).toBe(200);
    const proposal = (ban.body.pendingBan as { proposalId: string }).proposalId;
    const rep = await call(cmRaipur2, 'GET', `/admin/ustaad/moderation/reports/${ban.body.code as string}`);
    expect(
      (
        await call(
          cmRaipur2,
          'POST',
          `/admin/ustaad/moderation/reports/${ban.body.code as string}/ban/confirm`,
          {
            proposalId: proposal,
            version: rep.body.version,
          },
        )
      ).status,
    ).toBe(200);
    d = await call(cmRaipur3, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    expect(d.body.status).toBe('banned');
    const byBanner = await call(cmRaipur, 'POST', `/admin/ustaad/members/${authorMemberId}/unban`, {
      reasonCode: 'mistake',
      version: d.body.version,
    });
    expect(byBanner.status).toBe(403);
    expect(byBanner.body.error.code).toBe('FOUR_EYES');
    const proposed = await call(cmRaipur3, 'POST', `/admin/ustaad/members/${authorMemberId}/unban`, {
      reasonCode: 'mistake',
      version: d.body.version,
    });
    expect(proposed.status).toBe(200);
    expect(proposed.body.status).toBe('banned');
    const pid = (proposed.body.pendingUnban as { proposalId: string }).proposalId;
    d = await call(superAdmin, 'GET', `/admin/ustaad/members/${authorMemberId}`);
    expect(d.body.pendingUnban).toMatchObject({ proposalId: pid, proposedByMe: false });
    const self = await call(cmRaipur3, 'POST', `/admin/ustaad/members/${authorMemberId}/unban/confirm`, {
      proposalId: pid,
      version: d.body.version,
    });
    expect(self.status).toBe(403);
    expect(
      (
        await call(ops, 'POST', `/admin/ustaad/members/${authorMemberId}/unban/confirm`, {
          proposalId: pid,
          version: d.body.version,
        })
      ).status,
    ).toBe(403);
    const ok = await call(superAdmin, 'POST', `/admin/ustaad/members/${authorMemberId}/unban/confirm`, {
      proposalId: pid,
      version: d.body.version,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('active');
  });

  it('legal list for takedown holders; the own audit trail', async () => {
    const legal = await call(cmRaipur, 'GET', '/admin/ustaad/legal');
    expect(legal.status).toBe(200);
    expect(legal.body).toMatchObject({ takedowns: [], holds: [] });
    expect((await call(ops, 'GET', '/admin/ustaad/legal')).status).toBe(403);
    const mine = await call(cmRaipur, 'GET', '/admin/ustaad/my-actions');
    expect(mine.status).toBe(200);
    expect((mine.body.items as { action: string }[]).some((i) => i.action === 'ustaad.restrict')).toBe(true);
    expect((mine.body.items as { action: string }[]).some((i) => i.action === 'ustaad.unban')).toBe(false);
  });
});
