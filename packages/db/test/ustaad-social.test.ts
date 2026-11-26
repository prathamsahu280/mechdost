/**
 * Ustaad graph, messages, Discover and promotions (spec 23 § 4 flows 7–8, § 6.2, § 6.9, § 7.9, § 9.4, SR-33–37,
 * SR-41; workstream D2). Follow/unfollow (idempotent, counters by conditional increments, no self-follow, daily cap),
 * connect (one row per pair, double accept / crossed requests), block (mutual invisibility, removes follows and the
 * connection, forces the thread to blocked and ends mentorships in one transaction; unblock restores, never opens a
 * request), request-only messages (account age, daily cap, no link, masked phone/UPI, scam hold, no media before
 * accept, read receipts, per-thread mute), staff read only through an open report (audited), Discover (helpfulness,
 * opt-out, blocked hidden, 20 per page, daily profile cap), promotions (label, window, slot switch, daily cap, first
 * day, hides, internal links only).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  blockUstaadMember,
  clickUstaadPromotion,
  discoverUstaadPeople,
  discoverUstaadTags,
  ensureUser,
  followUstaadMember,
  hideUstaadPromotion,
  joinUstaad,
  listUstaadBlocks,
  listUstaadConnections,
  listUstaadFollows,
  listUstaadThreads,
  markUstaadThreadRead,
  moveUstaadConnection,
  moveUstaadThread,
  muteUstaadMember,
  muteUstaadThread,
  readableUstaadMedia,
  removeUstaadFollower,
  requestUstaadConnection,
  sendUstaadMessage,
  serveUstaadPromotion,
  staffReadUstaadThread,
  startUstaadThread,
  syncRbacCatalogue,
  unblockUstaadMember,
  unfollowUstaadMember,
  ustaadMessageReportTarget,
  ustaadRelationship,
  ustaadThreadMessages,
  ustaadTopPosts,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;

interface M {
  userId: string;
  memberId: string;
}
let n = 0;
const DAY = 86_400_000;

async function member(opts: { track?: 'apprentice' | 'ustaad'; level?: string; ageDays?: number } = {}) {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-social-${id}`,
    phone: `+9195500${id.padStart(5, '0')}`,
    email: `ustaad-social-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: opts.track ?? 'ustaad',
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
    .set({
      joinedAt: new Date(Date.now() - (opts.ageDays ?? 60) * DAY),
      ...(opts.level ? { level: opts.level } : {}),
    })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

async function setSetting(key: string, value: unknown) {
  await db.delete(s.settings).where(and(eq(s.settings.key, key), sql`${s.settings.cityId} is null`));
  await db.insert(s.settings).values({ key, cityId: null, value: value as never });
}

async function counters(m: M) {
  const [c] = await db
    .select()
    .from(s.ustaadMemberCounters)
    .where(eq(s.ustaadMemberCounters.memberId, m.memberId));
  return c;
}

async function err(p: Promise<unknown>): Promise<{ status?: number; code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as { status?: number; code?: string };
  }
  throw new Error('expected a refusal');
}

async function media(owner: M, kind: 'image' | 'audio') {
  const [row] = await db
    .insert(s.ustaadMedia)
    .values({
      ownerMemberId: owner.memberId,
      host: 'supabase',
      bucket: 'media',
      kind,
      status: 'verified',
      declaredBytes: 40_000,
      declaredMime: kind === 'image' ? 'image/webp' : 'audio/webm',
      sha256: 'a'.repeat(64),
      durationMs: kind === 'audio' ? 20_000 : null,
      objectKey: `m/${owner.memberId}/${randomUUID()}.${kind === 'image' ? 'webp' : 'webm'}`,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  if (!row) throw new Error('media');
  return row.id;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
});

afterAll(async () => {
  await client.close();
});

describe('follow (spec 23 flow 7, § 6.9, AT-RATE-1)', () => {
  it('is idempotent: a double tap counts once; unfollow twice never goes below zero', async () => {
    const a = await member();
    const b = await member();
    const [one, two] = await Promise.all([
      followUstaadMember(t(), a, b.memberId),
      followUstaadMember(t(), a, b.memberId),
    ]);
    expect(one.following && two.following).toBe(true);
    expect((await counters(b))?.followers).toBe(1);
    expect((await counters(a))?.following).toBe(1);
    await Promise.all([unfollowUstaadMember(t(), a, b.memberId), unfollowUstaadMember(t(), a, b.memberId)]);
    expect((await counters(b))?.followers).toBe(0);
    expect((await counters(a))?.following).toBe(0);
  });

  it('refuses self-follow and follows of a member who left (404)', async () => {
    const a = await member();
    expect((await err(followUstaadMember(t(), a, a.memberId))).code).toBe('USTAAD_SELF_FOLLOW');
    const gone = await member();
    await db
      .update(s.ustaadMembers)
      .set({ status: 'left', leftAt: new Date() })
      .where(eq(s.ustaadMembers.id, gone.memberId));
    expect((await err(followUstaadMember(t(), a, gone.memberId))).status).toBe(404);
  });

  it('writes the follow event for level counting and the follower Izzat once per pair (no farming)', async () => {
    const a = await member();
    const b = await member();
    await followUstaadMember(t(), a, b.memberId);
    await unfollowUstaadMember(t(), a, b.memberId);
    await followUstaadMember(t(), a, b.memberId);
    const events = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, b.memberId), eq(s.ustaadEvents.entityType, 'member')));
    expect(events.filter((e) => e.kind === 'followed')).toHaveLength(2);
    expect(events.filter((e) => e.kind === 'unfollowed')).toHaveLength(1);
    const ledger = await db
      .select()
      .from(s.ustaadIzzatLedger)
      .where(
        and(
          eq(s.ustaadIzzatLedger.memberId, b.memberId),
          eq(s.ustaadIzzatLedger.reasonCode, 'follower_gained'),
        ),
      );
    expect(ledger.length).toBeLessThanOrEqual(1);
    const notices = await db.select().from(s.notifications).where(eq(s.notifications.userId, b.userId));
    expect(notices.filter((x) => x.kind === 'ustaad.follow')).toHaveLength(1);
  });

  it('the daily follow cap (limits.follows_per_day) refuses the next follow with 429', async () => {
    await setSetting('ustaad.limits.follows_per_day', 5);
    const a = await member();
    for (let i = 0; i < 5; i += 1) await followUstaadMember(t(), a, (await member()).memberId);
    const refused = await err(followUstaadMember(t(), a, (await member()).memberId));
    expect(refused.status).toBe(429);
    expect(refused.code).toBe('USTAAD_DAILY_CAP');
    await setSetting('ustaad.limits.follows_per_day', 20);
  });

  it('lists followers and following with cards that carry no phone; remove follower works', async () => {
    const a = await member();
    const b = await member();
    await followUstaadMember(t(), a, b.memberId);
    const list = await listUstaadFollows(t(), b, { kind: 'followers' });
    expect(list.items.map((m) => m.id)).toEqual([a.memberId]);
    expect(JSON.stringify(list)).not.toMatch(/\+91|phone/);
    expect((await removeUstaadFollower(t(), b, a.memberId)).removed).toBe(true);
    expect((await counters(b))?.followers).toBe(0);
    expect((await ustaadRelationship(t(), a, b.memberId)).following).toBe(false);
  });
});

describe('connect (spec 23 § 6.2, § 7.9)', () => {
  it('request → accept; a second accept is refused; crossed requests become one connection', async () => {
    const a = await member();
    const b = await member();
    const req = await requestUstaadConnection(t(), a, b.memberId);
    expect(req.status).toBe('requested');
    const [x, y] = await Promise.allSettled([
      moveUstaadConnection(t(), b, req.id, 'accept'),
      moveUstaadConnection(t(), b, req.id, 'accept'),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect((await listUstaadConnections(t(), a, { box: 'connected' })).items).toHaveLength(1);

    const c = await member();
    const d = await member();
    await requestUstaadConnection(t(), c, d.memberId);
    const crossed = await requestUstaadConnection(t(), d, c.memberId);
    expect(crossed.status).toBe('accepted');
    const rows = await db.select().from(s.ustaadConnections).where(eq(s.ustaadConnections.id, crossed.id));
    expect(rows).toHaveLength(1);
  });

  it('only the receiver accepts or declines (others 404); the requester withdraws; a declined requester cannot re-ask', async () => {
    const a = await member();
    const b = await member();
    const stranger = await member();
    const req = await requestUstaadConnection(t(), a, b.memberId);
    expect((await err(moveUstaadConnection(t(), a, req.id, 'accept'))).status).toBe(404);
    expect((await err(moveUstaadConnection(t(), stranger, req.id, 'accept'))).status).toBe(404);
    await moveUstaadConnection(t(), b, req.id, 'decline');
    expect((await err(requestUstaadConnection(t(), a, b.memberId))).code).toBe('USTAAD_CONNECT_DECLINED');
    // The one who declined may ask later.
    expect((await requestUstaadConnection(t(), b, a.memberId)).status).toBe('requested');
    const c = await member();
    const r2 = await requestUstaadConnection(t(), c, a.memberId);
    expect((await moveUstaadConnection(t(), c, r2.id, 'withdraw')).status).toBe('removed');
  });
});

describe('block and mute (SR-35, § 7.9)', () => {
  it('removes follows and the connection both ways, ends mentorships, blocks the thread, in one call', async () => {
    const a = await member();
    const b = await member({ track: 'apprentice' });
    await followUstaadMember(t(), a, b.memberId);
    await followUstaadMember(t(), b, a.memberId);
    const conn = await requestUstaadConnection(t(), a, b.memberId);
    await moveUstaadConnection(t(), b, conn.id, 'accept');
    await db
      .insert(s.ustaadMentorships)
      .values({ ustaadId: a.memberId, shagirdId: b.memberId, status: 'active' });
    const thread = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste bhai' });
    await blockUstaadMember(t(), b, a.memberId);

    expect((await counters(a))?.followers).toBe(0);
    expect((await counters(b))?.followers).toBe(0);
    const [c] = await db.select().from(s.ustaadConnections).where(eq(s.ustaadConnections.id, conn.id));
    expect(c?.status).toBe('removed');
    const [m] = await db
      .select()
      .from(s.ustaadMentorships)
      .where(eq(s.ustaadMentorships.shagirdId, b.memberId));
    expect(m?.status).toBe('ended');
    expect(m?.endedReasonCode).toBe('blocked');
    const [th] = await db.select().from(s.ustaadThreads).where(eq(s.ustaadThreads.id, thread.threadId));
    expect(th?.status).toBe('blocked');
    expect(th?.blockedFrom).toBe('open'); // connected members' threads open at once

    // Mutual invisibility: neither can follow, connect, message or open the other's thread.
    expect((await err(followUstaadMember(t(), a, b.memberId))).status).toBe(404);
    expect((await err(followUstaadMember(t(), b, a.memberId))).status).toBe(404);
    expect((await err(requestUstaadConnection(t(), a, b.memberId))).status).toBe(404);
    expect((await err(startUstaadThread(t(), a, { memberId: b.memberId, text: 'suno' }))).status).toBe(404);
    expect((await err(ustaadThreadMessages(t(), a, thread.threadId, {}))).status).toBe(404);
    expect((await listUstaadBlocks(t(), b)).blocked.map((x) => x.id)).toEqual([a.memberId]);
  });

  it('unblock restores the thread to its earlier state: a request never becomes open', async () => {
    const a = await member();
    const b = await member();
    const thread = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste' });
    await blockUstaadMember(t(), a, b.memberId);
    await blockUstaadMember(t(), b, a.memberId);
    await unblockUstaadMember(t(), a, b.memberId);
    let [th] = await db.select().from(s.ustaadThreads).where(eq(s.ustaadThreads.id, thread.threadId));
    expect(th?.status).toBe('blocked'); // b still blocks a
    await unblockUstaadMember(t(), b, a.memberId);
    [th] = await db.select().from(s.ustaadThreads).where(eq(s.ustaadThreads.id, thread.threadId));
    expect(th?.status).toBe('requested');
    expect(th?.blockedFrom).toBeNull();
  });

  it('mute is one row, idempotent, and listed', async () => {
    const a = await member();
    const b = await member();
    await muteUstaadMember(t(), a, b.memberId, true);
    await muteUstaadMember(t(), a, b.memberId, true);
    expect((await listUstaadBlocks(t(), a)).muted.map((x) => x.id)).toEqual([b.memberId]);
    expect((await ustaadRelationship(t(), a, b.memberId)).muted).toBe(true);
    await muteUstaadMember(t(), a, b.memberId, false);
    expect((await listUstaadBlocks(t(), a)).muted).toHaveLength(0);
  });
});

describe('request-only messages (SR-33, SR-34, AT-DM-1)', () => {
  it('an account younger than 7 days cannot start a thread (403)', async () => {
    const young = await member({ ageDays: 2 });
    const b = await member();
    const e = await err(startUstaadThread(t(), young, { memberId: b.memberId, text: 'namaste' }));
    expect(e.status).toBe(403);
    expect(e.code).toBe('USTAAD_DM_TOO_NEW');
  });

  it('a link in the first message is refused; phone and UPI are masked; the receiver gets a request', async () => {
    const a = await member();
    const b = await member();
    expect(
      (await err(startUstaadThread(t(), a, { memberId: b.memberId, text: 'dekho https://x.example/y' })))
        .code,
    ).toBe('USTAAD_DM_LINK');
    const th = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'call 9876543210, sahu@ybl' });
    expect(th.status).toBe('requested');
    const page = await ustaadThreadMessages(t(), b, th.threadId, {});
    expect(page.items[0]?.text).not.toMatch(/9876543210|sahu@ybl/);
    const reqs = await listUstaadThreads(t(), b, { box: 'requests' });
    expect(reqs.items.map((x) => x.id)).toContain(th.threadId);
    const notices = await db.select().from(s.notifications).where(eq(s.notifications.userId, b.userId));
    expect(notices.some((x) => x.kind === 'ustaad.message_request')).toBe(true);
  });

  it('no second message and no media before acceptance; after accept media and receipts work', async () => {
    const a = await member();
    const b = await member();
    const th = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste' });
    expect((await err(sendUstaadMessage(t(), a, th.threadId, { kind: 'text', text: 'hello?' }))).code).toBe(
      'USTAAD_DM_PENDING',
    );
    const photo = await media(a, 'image');
    expect((await err(sendUstaadMessage(t(), a, th.threadId, { kind: 'photo', mediaId: photo }))).code).toBe(
      'USTAAD_DM_PENDING',
    );
    const [one, two] = await Promise.allSettled([
      moveUstaadThread(t(), b, th.threadId, 'accept'),
      moveUstaadThread(t(), b, th.threadId, 'accept'),
    ]);
    expect([one.status, two.status].sort()).toEqual(['fulfilled', 'rejected']);
    // Accepting reads the request.
    let mine = await ustaadThreadMessages(t(), a, th.threadId, {});
    expect(mine.items.every((x) => x.read)).toBe(true);
    const sent = await sendUstaadMessage(t(), a, th.threadId, { kind: 'photo', mediaId: photo });
    const foreign = await media(b, 'image');
    expect(
      (await err(sendUstaadMessage(t(), a, th.threadId, { kind: 'photo', mediaId: foreign }))).code,
    ).toBe('USTAAD_MEDIA_INVALID');
    mine = await ustaadThreadMessages(t(), a, th.threadId, {});
    expect(mine.items.find((x) => x.id === sent.messageId)?.read).toBe(false);
    expect(
      (await listUstaadThreads(t(), b, { box: 'inbox' })).items.find((x) => x.id === th.threadId)?.unread,
    ).toBe(true);
    await markUstaadThreadRead(t(), b, th.threadId);
    mine = await ustaadThreadMessages(t(), a, th.threadId, {});
    expect(mine.items.filter((x) => x.mine).every((x) => x.read)).toBe(true);
  });

  it('dm_mode nobody refuses; everyone and connections open the thread at once', async () => {
    const a = await member();
    const closed = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'nobody' }).where(eq(s.ustaadMembers.id, closed.memberId));
    expect((await err(startUstaadThread(t(), a, { memberId: closed.memberId, text: 'hi' }))).code).toBe(
      'USTAAD_DM_NOT_ALLOWED',
    );
    const open = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'everyone' }).where(eq(s.ustaadMembers.id, open.memberId));
    expect((await startUstaadThread(t(), a, { memberId: open.memberId, text: 'hi' })).status).toBe('open');
    const friend = await member();
    const c = await requestUstaadConnection(t(), a, friend.memberId);
    await moveUstaadConnection(t(), friend, c.id, 'accept');
    expect((await startUstaadThread(t(), a, { memberId: friend.memberId, text: 'hi' })).status).toBe('open');
  });

  it('a scam message is held: the receiver never sees it and gets no notice; the sender sees it pending', async () => {
    const a = await member();
    const b = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'everyone' }).where(eq(s.ustaadMembers.id, b.memberId));
    const th = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste' });
    const before = (await db.select().from(s.notifications).where(eq(s.notifications.userId, b.userId)))
      .length;
    const sent = await sendUstaadMessage(t(), a, th.threadId, {
      kind: 'text',
      text: 'registration fee 500 bhejo sahu@ybl',
    });
    expect(sent.pending).toBe(true);
    const theirs = await ustaadThreadMessages(t(), b, th.threadId, {});
    expect(theirs.items.some((x) => x.text?.includes('fee'))).toBe(false);
    const mine = await ustaadThreadMessages(t(), a, th.threadId, {});
    expect(mine.items.find((x) => x.id === sent.messageId)?.pending).toBe(true);
    const after = (await db.select().from(s.notifications).where(eq(s.notifications.userId, b.userId)))
      .length;
    expect(after).toBe(before);
  });

  it('the photo of a held message is not readable by the receiver (signed URL refused), only by the sender', async () => {
    const a = await member();
    const b = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'everyone' }).where(eq(s.ustaadMembers.id, b.memberId));
    const th = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste' });
    const photo = await media(a, 'image');
    const sent = await sendUstaadMessage(t(), a, th.threadId, {
      kind: 'photo',
      mediaId: photo,
      text: 'joining fee 200 paytm karo',
    });
    expect(sent.pending).toBe(true);
    expect(await readableUstaadMedia(t(), { mediaId: photo, viewerMemberId: b.memberId })).toBeNull();
    expect(await readableUstaadMedia(t(), { mediaId: photo, viewerMemberId: a.memberId })).not.toBeNull();
  });

  it('the new-thread daily cap answers 429; a muted thread sends no notice', async () => {
    await setSetting('ustaad.limits.new_threads_per_day', 5);
    const a = await member();
    for (let i = 0; i < 5; i += 1)
      await startUstaadThread(t(), a, { memberId: (await member()).memberId, text: 'namaste' });
    const e = await err(startUstaadThread(t(), a, { memberId: (await member()).memberId, text: 'namaste' }));
    expect(e.status).toBe(429);
    await setSetting('ustaad.limits.new_threads_per_day', 20);

    const x = await member();
    const y = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'everyone' }).where(eq(s.ustaadMembers.id, y.memberId));
    const th = await startUstaadThread(t(), x, { memberId: y.memberId, text: 'namaste' });
    await muteUstaadThread(t(), y, th.threadId, true);
    const before = (await db.select().from(s.notifications).where(eq(s.notifications.userId, y.userId)))
      .length;
    await sendUstaadMessage(t(), x, th.threadId, { kind: 'text', text: 'kal aana' });
    const after = (await db.select().from(s.notifications).where(eq(s.notifications.userId, y.userId)))
      .length;
    expect(after).toBe(before);
    expect(
      (await listUstaadThreads(t(), y, { box: 'inbox' })).items.find((i) => i.id === th.threadId)?.muted,
    ).toBe(true);
  });

  it('staff read a thread only through an open report on one of its messages, and every read is audited', async () => {
    const a = await member();
    const b = await member();
    await db.update(s.ustaadMembers).set({ dmMode: 'everyone' }).where(eq(s.ustaadMembers.id, b.memberId));
    const th = await startUstaadThread(t(), a, { memberId: b.memberId, text: 'namaste' });
    const target = await ustaadMessageReportTarget(t(), b.memberId, th.messageId);
    expect(target.threadId).toBe(th.threadId);
    expect((await err(ustaadMessageReportTarget(t(), (await member()).memberId, th.messageId))).status).toBe(
      404,
    );
    const code = 'UR-RPR-2026-ABCDEF';
    expect(
      (
        await err(
          staffReadUstaadThread(
            t(),
            { userId: f.staff, cityIds: null },
            { reportCode: code, reason: 'report_review' },
          ),
        )
      ).status,
    ).toBe(404);
    await db.insert(s.ustaadReports).values({
      code,
      targetType: 'message',
      targetId: th.messageId,
      reporterId: b.memberId,
      cityId: f.raipur,
      reasonCode: 'abuse',
      dueAt: new Date(Date.now() + DAY),
    });
    // A manager of another city gets 404.
    expect(
      (
        await err(
          staffReadUstaadThread(
            t(),
            { userId: f.staff, cityIds: [f.bhilai] },
            { reportCode: code, reason: 'report_review' },
          ),
        )
      ).status,
    ).toBe(404);
    const view = await staffReadUstaadThread(
      t(),
      { userId: f.staff, cityIds: [f.raipur] },
      { reportCode: code, reason: 'report_review' },
    );
    expect(view.messages).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/\+91/);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ustaad.dm_read'));
    expect(audit).toHaveLength(1);
    await db.update(s.ustaadReports).set({ status: 'actioned' }).where(eq(s.ustaadReports.code, code));
    expect(
      (
        await err(
          staffReadUstaadThread(
            t(),
            { userId: f.staff, cityIds: null },
            { reportCode: code, reason: 'report_review' },
          ),
        )
      ).status,
    ).toBe(404);
  });
});

describe('Discover (spec 23 § 9.4, SR-37)', () => {
  let viewer: M;
  let helper: M;
  let famous: M;
  let hidden: M;
  let blocker: M;

  beforeAll(async () => {
    viewer = await member();
    helper = await member({ level: 'pakka' });
    famous = await member({ level: 'naya' });
    hidden = await member({ level: 'pakka' });
    blocker = await member({ level: 'pakka' });
    await db
      .update(s.ustaadMemberCounters)
      .set({ answers: 40, helpfulAnswers: 35, bestAnswers: 12, bestAnswers30d: 4 })
      .where(eq(s.ustaadMemberCounters.memberId, helper.memberId));
    await db
      .update(s.ustaadMemberCounters)
      .set({ followers: 5000 })
      .where(eq(s.ustaadMemberCounters.memberId, famous.memberId));
    await db.update(s.ustaadMembers).set({ suggestMe: false }).where(eq(s.ustaadMembers.id, hidden.memberId));
    await blockUstaadMember(t(), blocker, viewer.memberId);
  });

  it('ranks by helpfulness, not followers; opted-out and blocked members are not suggested; no phone', async () => {
    const page = await discoverUstaadPeople(t(), viewer, {});
    const ids = page.items.map((p) => p.id);
    expect(ids.indexOf(helper.memberId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(helper.memberId)).toBeLessThan(ids.indexOf(famous.memberId));
    expect(ids).not.toContain(hidden.memberId);
    expect(ids).not.toContain(blocker.memberId);
    expect(ids).not.toContain(viewer.memberId);
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(page)).not.toMatch(/\+91|phone|total/);
  });

  it('a name search still finds an opted-out member; filters by work code', async () => {
    const [h] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, hidden.memberId));
    const found = await discoverUstaadPeople(t(), viewer, { q: h?.displayName ?? '' });
    expect(found.items.map((p) => p.id)).toContain(hidden.memberId);
    const none = await discoverUstaadPeople(t(), viewer, { work: 'ac' });
    expect(none.items).toHaveLength(0);
  });

  it('the daily profile cap (discover.profiles_per_day) answers 429 once reached', async () => {
    await setSetting('ustaad.discover.profiles_per_day', 50);
    const v = await member();
    await db.insert(s.ustaadDailyCounters).values({
      memberId: v.memberId,
      kind: 'profiles_served',
      day: sql`(now() at time zone 'Asia/Kolkata')::date` as never,
      n: 50,
    });
    const e = await err(discoverUstaadPeople(t(), v, {}));
    expect(e.status).toBe(429);
    await setSetting('ustaad.discover.profiles_per_day', 200);
  });

  it('tags and top posts are read-only views that never show blocked authors', async () => {
    const [tag] = await db
      .insert(s.ustaadTags)
      .values({ slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'part' })
      .returning();
    const [post] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: helper.memberId, cityId: f.raipur, kind: 'text', body: 'Tip', status: 'visible' })
      .returning();
    const [bad] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: blocker.memberId, cityId: f.raipur, kind: 'text', body: 'x', status: 'visible' })
      .returning();
    if (!tag || !post || !bad) throw new Error('seed');
    await db.insert(s.ustaadPostCounters).values([
      { postId: post.id, likes: 5, saves: 3 },
      { postId: bad.id, likes: 50, saves: 30 },
    ]);
    await db.insert(s.ustaadPostTags).values({ postId: post.id, tagId: tag.id });
    const tags = await discoverUstaadTags(t(), viewer);
    expect(tags.items.find((x) => x.slug === 'battery')?.uses).toBe(1);
    const top = await ustaadTopPosts(t(), viewer, {});
    expect(top.items.map((p) => p.id)).toContain(post.id);
    expect(top.items.map((p) => p.id)).not.toContain(bad.id);
  });
});

describe('promotions (SR-41, § 9.5, § 15)', () => {
  let promoId = '';
  const live = (over: Partial<typeof s.ustaadPromotions.$inferInsert> = {}) => ({
    slot: 'feed',
    titleEn: 'Batteries at trade price',
    titleHi: 'बैटरी पर खास दाम',
    target: 'category',
    targetId: 'batteries',
    startsAt: new Date(Date.now() - DAY),
    endsAt: new Date(Date.now() + DAY),
    status: 'live',
    ...over,
  });

  beforeEach(async () => {
    await db.delete(s.ustaadPromotions);
    await setSetting('ustaad.promo.daily_cap_per_member', 3);
    await setSetting('ustaad.promo.enabled', true);
    await setSetting('ustaad.promo.place.feed', true);
    const [p] = await db.insert(s.ustaadPromotions).values(live()).returning();
    promoId = p?.id ?? '';
  });

  it('serves a live promotion with the locked label and an internal link; clicks return the same link', async () => {
    const m = await member();
    const p = await serveUstaadPromotion(t(), m, 'feed');
    expect(p?.label).toEqual({ en: 'Sponsored', hi: 'प्रायोजित' });
    expect(p?.href).toBe('/shop?category=batteries');
    expect((await clickUstaadPromotion(t(), m, promoId)).href).toBe('/shop?category=batteries');
  });

  it('never on a member’s first day, never when the slot is off, never outside the window or in drafts', async () => {
    const fresh = await member({ ageDays: 0 });
    expect(await serveUstaadPromotion(t(), fresh, 'feed')).toBeNull();
    const m = await member();
    await setSetting('ustaad.promo.place.feed', false);
    expect(await serveUstaadPromotion(t(), m, 'feed')).toBeNull();
    await setSetting('ustaad.promo.place.feed', true);
    await db.delete(s.ustaadPromotions);
    await db
      .insert(s.ustaadPromotions)
      .values([
        live({ status: 'draft' }),
        live({ startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 2 * DAY) }),
      ]);
    expect(await serveUstaadPromotion(t(), m, 'feed')).toBeNull();
  });

  it('the per-member daily cap holds under parallel serves', async () => {
    const m = await member();
    const served = await Promise.all(Array.from({ length: 6 }, () => serveUstaadPromotion(t(), m, 'feed')));
    expect(served.filter(Boolean)).toHaveLength(3);
  });

  it('a hidden promotion is not served again; city and speciality targeting apply', async () => {
    const m = await member();
    await hideUstaadPromotion(t(), m, promoId, 'not_relevant');
    expect(await serveUstaadPromotion(t(), m, 'feed')).toBeNull();
    await db.delete(s.ustaadPromotions);
    await db.insert(s.ustaadPromotions).values(live({ cityIds: [f.bhilai] }));
    expect(await serveUstaadPromotion(t(), await member(), 'feed')).toBeNull();
    await db.delete(s.ustaadPromotions);
    await db.insert(s.ustaadPromotions).values(live({ segmentCodes: ['truck_bus'] }));
    expect(await serveUstaadPromotion(t(), await member(), 'feed')).toBeNull();
  });

  it('a click on a promotion that is not live is 404', async () => {
    const m = await member();
    await db.update(s.ustaadPromotions).set({ status: 'ended' }).where(eq(s.ustaadPromotions.id, promoId));
    expect((await err(clickUstaadPromotion(t(), m, promoId))).status).toBe(404);
  });
});
