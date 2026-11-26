/**
 * Another member's profile and posts (spec 23 § 5 `/ustaad/u/[handle]`; workstream D web, 2026-11-26): the card by
 * handle (case-blind), specialities, public counts (followers only when `feed.show_follower_counts` is on), the
 * caller's relationship, and the member's posts newest first with the feed's visibility rule. 404 for a handle that
 * does not exist, a member who left or is restricted, and when either side blocked the other (SR-35). No phone ever.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  blockUstaadMember,
  createUstaadPost,
  ensureUser,
  followUstaadMember,
  joinUstaad,
  listUstaadMemberPosts,
  muteUstaadMember,
  syncRbacCatalogue,
  ustaadProfileByHandle,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;

interface M {
  userId: string;
  memberId: string;
  handle: string;
}
let n = 0;
const DAY = 86_400_000;

async function member(): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-profile-view-${id}`,
    phone: `+9195600${id.padStart(5, '0')}`,
    email: `ustaad-profile-view-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler', 'battery'] as never,
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
    .set({ joinedAt: new Date(Date.now() - 60 * DAY) })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id, handle: m.handle };
}

async function setSetting(key: string, value: unknown) {
  await db.delete(s.settings).where(and(eq(s.settings.key, key), sql`${s.settings.cityId} is null`));
  await db.insert(s.settings).values({ key, cityId: null, value });
}

async function err(p: Promise<unknown>): Promise<{ status?: number; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { status?: number; code?: string };
  }
  throw new Error('expected a refusal');
}

const post = (m: M, body: string) =>
  createUstaadPost(t(), m, {
    kind: 'text',
    body,
    correction: 'none',
    media: [],
    tags: [],
    idemKey: `k${randomUUID().replace(/-/g, '').slice(0, 20)}`,
  });

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  const f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.delete(s.settings).where(sql`${s.settings.key} like 'ustaad.%'`);
  await setSetting('ustaad.posts.per_day', 100);
});

describe('profile by handle', () => {
  it('shows the card, specialities, counts and the relationship; the handle is matched case-blind', async () => {
    const a = await member();
    const b = await member();
    await followUstaadMember(t(), a, b.memberId);
    await setSetting('ustaad.feed.show_follower_counts', true);
    const v = await ustaadProfileByHandle(t(), a, b.handle.toUpperCase());
    expect(v.member.id).toBe(b.memberId);
    expect(v.mine).toBe(false);
    expect(v.specialities.sort()).toEqual(['battery', 'two_wheeler']);
    expect(v.followers).toBe(1);
    expect(v.relationship?.following).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/\+91/);
  });

  it('hides follower counts when the setting is off; my own profile has no relationship', async () => {
    const a = await member();
    await setSetting('ustaad.feed.show_follower_counts', false);
    const v = await ustaadProfileByHandle(t(), a, a.handle);
    expect(v.mine).toBe(true);
    expect(v.followers).toBeNull();
    expect(v.following).toBeNull();
    expect(v.relationship).toBeNull();
  });

  it('answers 404 for an unknown handle, a member who left, a restricted member and a block either way', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const d = await member();
    expect((await err(ustaadProfileByHandle(t(), a, 'nobody_here'))).status).toBe(404);
    await db
      .update(s.ustaadMembers)
      .set({ status: 'left', leftAt: new Date() })
      .where(eq(s.ustaadMembers.id, b.memberId));
    expect((await err(ustaadProfileByHandle(t(), a, b.handle))).status).toBe(404);
    await db
      .update(s.ustaadMembers)
      .set({ restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, c.memberId));
    expect((await err(ustaadProfileByHandle(t(), a, c.handle))).status).toBe(404);
    await blockUstaadMember(t(), d, a.memberId);
    expect((await err(ustaadProfileByHandle(t(), a, d.handle))).status).toBe(404);
    expect((await err(ustaadProfileByHandle(t(), d, a.handle))).status).toBe(404);
  });
});

describe('member posts', () => {
  it('lists the member posts newest first with a keyset cursor', async () => {
    const a = await member();
    const b = await member();
    for (let i = 0; i < 3; i += 1) await post(b, `Kaam number ${String(i)}`);
    const first = await listUstaadMemberPosts(t(), a, b.memberId, { limit: 2 });
    expect(first.items.map((p) => p.body)).toEqual(['Kaam number 2', 'Kaam number 1']);
    expect(first.nextCursor).not.toBeNull();
    const second = await listUstaadMemberPosts(t(), a, b.memberId, {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((p) => p.body)).toEqual(['Kaam number 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('a muted member still shows on their own profile; a block either way answers 404', async () => {
    const a = await member();
    const b = await member();
    await post(b, 'Clutch plate badli');
    await muteUstaadMember(t(), a, b.memberId, true);
    expect((await listUstaadMemberPosts(t(), a, b.memberId, { limit: 20 })).items).toHaveLength(1);
    await blockUstaadMember(t(), b, a.memberId);
    expect((await err(listUstaadMemberPosts(t(), a, b.memberId, { limit: 20 }))).status).toBe(404);
  });
});
