/**
 * Community manager console repositories (spec 23 § 3, § 7, § 13; SR-18, SR-38, SR-39; plan task G2): `keep` on a
 * held item runs the publish side effects once (answer → question answered, Izzat, asker notice; question → Ustaad
 * notices; comment → counter + reply notice; message → released, last message time, request notice), held posts,
 * stories, comments and messages reach the queue, the queue filters (holds, reason, surface) and four-eyes flags,
 * the audited staff media view (blurred in the UI; refused for evidence, quarantine and legal holds), members for
 * staff (search, history, restrict, ban with four-eyes, unban, frozen accounts), the legal list and the staff
 * member's own audit trail.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  actOnUstaadReport,
  answerUstaadQuestion,
  askUstaadQuestion,
  commentOnUstaadPost,
  confirmUstaadBan,
  confirmUstaadUnban,
  createUstaadPost,
  createUstaadReport,
  ensureUser,
  executeUstaadTakedown,
  joinUstaad,
  listUstaadLegalCases,
  listUstaadModerationQueue,
  listUstaadStaffOwnActions,
  sanctionUstaadMember,
  searchUstaadMembersForStaff,
  staffUstaadMediaView,
  startUstaadThread,
  syncRbacCatalogue,
  unbanUstaadMember,
  ustaadMemberForStaff,
  ustaadReportDetail,
  type Tx,
  type UstaadStaff,
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
let otherCityId = '';

async function member(opts: { verified?: boolean; cityId?: string; level?: string } = {}): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-con-${id}`,
    phone: `+9197200${id.padStart(5, '0')}`,
    email: `ustaad-con-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler'] as never,
      displayName: `Karigar ${id}`,
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
      level: opts.level ?? 'pakka',
      verificationState: opts.verified === false ? 'unverified' : 'verified',
      joinedAt: new Date(Date.now() - 120 * 86_400_000),
      ...(opts.cityId ? { cityId: opts.cityId } : {}),
    })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

async function staffUser(name: string): Promise<string> {
  const u = await ensureUser(db, {
    firebaseUid: `ustaad-con-staff-${name}`,
    phone: `+91972999${String(n++).padStart(4, '0')}`,
    email: `ustaad-con-staff-${name}@example.com`,
    emailVerified: true,
  });
  return u.id;
}

async function media(owner: string, set: Partial<typeof s.ustaadMedia.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(s.ustaadMedia)
    .values({
      ownerMemberId: owner,
      host: 'supabase',
      bucket: 'media',
      kind: 'image',
      status: 'verified',
      declaredBytes: 40_000,
      declaredMime: 'image/webp',
      sha256: 'c'.repeat(64),
      objectKey: `m/${owner}/${randomUUID()}.webp`,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
      ...set,
    })
    .returning();
  if (!row) throw new Error('media');
  return row.id;
}

const key = () => `k${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const UPI = 'Pehle 200 rupay ramesh@ybl pe bhejo';
const FEE = 'Job ke liye registration fee 500 jama karo';
let asker: M;
let answerer: M;
let other: M;
let cmA: UstaadStaff;
let cmA2: UstaadStaff;
let cmA3: UstaadStaff;
let cmA4: UstaadStaff;
let cmB: UstaadStaff;

const noticesOf = (userId: string, kind: string) =>
  db
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), eq(s.notifications.kind, kind)));

const reportFor = async (targetId: string) => {
  const [r] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.targetId, targetId));
  if (!r) throw new Error('no report');
  return r;
};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  const [state] = await db.select().from(s.states).limit(1);
  const [city] = await db
    .insert(s.cities)
    .values({ stateId: state?.id ?? '', code: 'BLP', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
    .returning();
  otherCityId = city?.id ?? '';
  asker = await member();
  answerer = await member();
  other = await member();
  cmA = { userId: await staffUser('a'), scope: { all: false, cityIds: [f.raipur] } };
  cmA2 = { userId: await staffUser('a2'), scope: { all: false, cityIds: [f.raipur] } };
  cmA3 = { userId: await staffUser('a3'), scope: { all: false, cityIds: [f.raipur] } };
  cmA4 = { userId: await staffUser('a4'), scope: { all: false, cityIds: [f.raipur] } };
  cmB = { userId: await staffUser('b'), scope: { all: false, cityIds: [otherCityId] } };
});

afterAll(async () => {
  await client.close();
});

async function ask(by: M, title = 'Splendor self nahi chal raha') {
  return askUstaadQuestion(t(), by, {
    title,
    correction: 'none',
    segmentCode: 'two_wheeler',
    workCode: 'engine',
    reach: 'city',
    hideGarage: true,
    idemKey: key(),
  });
}

describe('keep on a held item runs the publish side effects (F2 not-done item)', () => {
  it('a held answer: keep → visible, question answered, Izzat once, the asker told', async () => {
    const q = await ask(asker);
    const a = await answerUstaadQuestion(t(), answerer, q.code, {
      body: UPI,
      correction: 'none',
      idemKey: key(),
    });
    expect(a.status).toBe('held');
    expect(await noticesOf(asker.userId, 'ustaad.answer_received')).toHaveLength(0);
    const r = await reportFor(a.id);
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    const [ans] = await db.select().from(s.ustaadAnswers).where(eq(s.ustaadAnswers.id, a.id));
    expect(ans?.status).toBe('visible');
    const [question] = await db.select().from(s.ustaadQuestions).where(eq(s.ustaadQuestions.id, q.id));
    expect(question?.status).toBe('answered');
    const izzat = await db
      .select()
      .from(s.ustaadIzzatLedger)
      .where(eq(s.ustaadIzzatLedger.idemKey, `answer:${a.id}`));
    expect(izzat).toHaveLength(1);
    expect(await noticesOf(asker.userId, 'ustaad.answer_received')).toHaveLength(1);
  });

  it('an answer hidden by an NCII complaint and then kept is not published twice', async () => {
    const q = await ask(asker, 'Activa start problem');
    const a = await answerUstaadQuestion(t(), answerer, q.code, {
      body: 'Plug saaf karo',
      correction: 'none',
      idemKey: key(),
    });
    expect(a.status).toBe('visible');
    const before = (await noticesOf(asker.userId, 'ustaad.answer_received')).length;
    const rep = await createUstaadReport(t(), other, {
      targetType: 'answer',
      targetId: a.id,
      reasonCode: 'ncii_impersonation',
    });
    const [held] = await db.select().from(s.ustaadAnswers).where(eq(s.ustaadAnswers.id, a.id));
    expect(held?.status).toBe('held');
    const r = await ustaadReportDetail(t(), cmA, rep.code);
    await actOnUstaadReport(t(), cmA, rep.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    expect(await noticesOf(asker.userId, 'ustaad.answer_received')).toHaveLength(before);
    const izzat = await db
      .select()
      .from(s.ustaadIzzatLedger)
      .where(eq(s.ustaadIzzatLedger.idemKey, `answer:${a.id}`));
    expect(izzat).toHaveLength(1);
  });

  it('a held question: keep sends the Ustaad notices it skipped', async () => {
    const q = await ask(asker, 'Paisa bhejo ramesh@ybl phir batata hoon');
    const r = await reportFor(q.id);
    expect(r.source).toBe('auto_scam');
    expect(await noticesOf(answerer.userId, 'ustaad.question_waiting')).toHaveLength(
      (await noticesOf(answerer.userId, 'ustaad.question_waiting')).length,
    );
    const waitingBefore = (await db.select().from(s.notifications)).filter(
      (x) => x.kind === 'ustaad.question_waiting' && x.entityId === q.id,
    );
    expect(waitingBefore).toHaveLength(0);
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    const waiting = (await db.select().from(s.notifications)).filter(
      (x) => x.kind === 'ustaad.question_waiting' && x.entityId === q.id,
    );
    expect(waiting.length).toBeGreaterThan(0);
  });

  it('a held comment reaches the queue; keep counts it and tells the post author', async () => {
    const p = await createUstaadPost(t(), asker, {
      kind: 'text',
      body: 'Aaj clutch plate badli',
      correction: 'none',
      media: [],
      tags: [],
      idemKey: key(),
    } as never);
    const c = await commentOnUstaadPost(t(), other, p.id, {
      body: UPI,
      correction: 'none',
      idemKey: key(),
    } as never);
    expect(c.status).toBe('held');
    const r = await reportFor(c.id);
    expect(r).toMatchObject({ targetType: 'comment', source: 'auto_scam', status: 'open' });
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    const [counter] = await db
      .select()
      .from(s.ustaadPostCounters)
      .where(eq(s.ustaadPostCounters.postId, p.id));
    expect(counter?.comments).toBe(1);
    const replies = (await noticesOf(asker.userId, 'ustaad.reply')).filter((x) => x.entityId === p.id);
    expect(replies).toHaveLength(1);
  });

  it('a held post reaches the queue; keep clears its held reason', async () => {
    const p = await createUstaadPost(t(), asker, {
      kind: 'text',
      body: UPI,
      correction: 'none',
      media: [],
      tags: [],
      idemKey: key(),
    } as never);
    expect(p.status).toBe('held');
    const r = await reportFor(p.id);
    expect(r.targetType).toBe('post');
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    const [row] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(row).toMatchObject({ status: 'visible', heldReasonCode: null });
  });

  it('a held message reaches the queue; keep releases it, moves the thread time and sends the request notice', async () => {
    const th = await startUstaadThread(t(), asker, { memberId: answerer.memberId, text: FEE });
    expect(th.pending).toBe(true);
    const r = await reportFor(th.messageId);
    expect(r).toMatchObject({ targetType: 'message', source: 'auto_scam', status: 'open' });
    expect(await noticesOf(answerer.userId, 'ustaad.message_request')).toHaveLength(0);
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'keep',
      reasonCode: 'not_violating',
      version: r.version,
    });
    const [msg] = await db.select().from(s.ustaadMessages).where(eq(s.ustaadMessages.id, th.messageId));
    expect(msg?.heldReasonCode).toBeNull();
    const [thread] = await db.select().from(s.ustaadThreads).where(eq(s.ustaadThreads.id, th.threadId));
    expect(thread?.lastMessageAt?.toISOString()).toBe(msg?.createdAt.toISOString());
    expect(await noticesOf(answerer.userId, 'ustaad.message_request')).toHaveLength(1);
  });

  it('remove on a held message deletes it for both and never notifies', async () => {
    const th = await startUstaadThread(t(), other, { memberId: answerer.memberId, text: FEE });
    const r = await reportFor(th.messageId);
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'remove',
      reasonCode: 'job_scam',
      version: r.version,
    });
    const [msg] = await db.select().from(s.ustaadMessages).where(eq(s.ustaadMessages.id, th.messageId));
    expect(msg?.deletedAt).not.toBeNull();
    const reqs = (await noticesOf(answerer.userId, 'ustaad.message_request')).filter(
      (x) => x.entityId === th.threadId,
    );
    expect(reqs).toHaveLength(0);
  });
});

describe('queue filters and four-eyes flags', () => {
  it('holds = automatic sources only; reason and surface narrow the queue', async () => {
    const p = await createUstaadPost(t(), other, {
      kind: 'text',
      body: 'Engine oil 20W40 sahi hai',
      correction: 'none',
      media: [],
      tags: [],
      idemKey: key(),
    } as never);
    await createUstaadReport(t(), asker, { targetType: 'post', targetId: p.id, reasonCode: 'spam' });
    await createUstaadPost(t(), other, {
      kind: 'text',
      body: UPI,
      correction: 'none',
      media: [],
      tags: [],
      idemKey: key(),
    } as never);
    const held = await listUstaadModerationQueue(t(), cmA, { queue: 'held', cityId: null });
    expect(held.items.length).toBeGreaterThan(0);
    expect(held.items.every((i) => i.source.startsWith('auto_'))).toBe(true);
    const spam = await listUstaadModerationQueue(t(), cmA, { queue: 'open', cityId: null, reason: 'spam' });
    expect(spam.items.map((i) => i.targetId)).toContain(p.id);
    expect(spam.items.every((i) => i.reasonCode === 'spam')).toBe(true);
    const msgs = await listUstaadModerationQueue(t(), cmA, {
      queue: 'open',
      cityId: null,
      target: 'message',
    });
    expect(msgs.items.every((i) => i.targetType === 'message')).toBe(true);
    // Another city's manager sees none of it.
    const b = await listUstaadModerationQueue(t(), cmB, { queue: 'held', cityId: null });
    expect(b.items).toHaveLength(0);
  });

  it('a proposed ban shows as waiting, with who may confirm it', async () => {
    const p = await createUstaadPost(t(), other, {
      kind: 'text',
      body: 'Gaali wala post',
      correction: 'none',
      media: [],
      tags: [],
      idemKey: key(),
    } as never);
    const rep = await createUstaadReport(t(), asker, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    const d = await ustaadReportDetail(t(), cmA, rep.code);
    const out = await actOnUstaadReport(t(), cmA, rep.code, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 30,
      version: d.version,
    });
    expect(out.pendingBan).toBeDefined();
    const q = await listUstaadModerationQueue(t(), cmA, { queue: 'open', cityId: null, reason: 'abuse' });
    const row = q.items.find((i) => i.code === rep.code);
    expect(row).toMatchObject({ banWaiting: true, proposedByMe: true });
    const q2 = await listUstaadModerationQueue(t(), cmA2, { queue: 'open', cityId: null, reason: 'abuse' });
    expect(q2.items.find((i) => i.code === rep.code)).toMatchObject({
      banWaiting: true,
      proposedByMe: false,
    });
    const d1 = await ustaadReportDetail(t(), cmA, rep.code);
    expect(d1.pendingBan?.proposedByMe).toBe(true);
    const d2 = await ustaadReportDetail(t(), cmA2, rep.code);
    expect(d2.pendingBan?.proposedByMe).toBe(false);
    await confirmUstaadBan(t(), cmA2, rep.code, {
      proposalId: out.pendingBan?.proposalId ?? '',
      version: d2.version,
    });
    const decided = await ustaadReportDetail(t(), cmA2, rep.code);
    expect(decided.decidedByMe).toBe(true);
    expect((await ustaadReportDetail(t(), cmA, rep.code)).decidedByMe).toBe(false);
    // Lift it again for the later tests.
    await db
      .update(s.ustaadMembers)
      .set({ status: 'active', bannedUntil: null })
      .where(eq(s.ustaadMembers.id, other.memberId));
  });
});

describe('staff media view (blurred in the UI, every view audited)', () => {
  async function reportedPostWith(mediaSet: Partial<typeof s.ustaadMedia.$inferInsert> = {}) {
    const mediaId = await media(asker.memberId, mediaSet);
    const [p] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: asker.memberId, cityId: f.raipur, kind: 'photo', body: 'Photo' })
      .returning();
    await db.insert(s.ustaadPostMedia).values({ postId: p?.id ?? '', mediaId, position: 0 });
    const rep = await createUstaadReport(t(), other, {
      targetType: 'post',
      targetId: p?.id ?? '',
      reasonCode: 'spam',
    });
    return { mediaId, code: rep.code };
  }

  it('returns the file of the reported item and writes an audit row per view', async () => {
    const { mediaId, code } = await reportedPostWith();
    const v = await staffUstaadMediaView(t(), cmA, { code, mediaId, reason: 'report_review' });
    expect(v).toMatchObject({ id: mediaId, bucket: 'media', kind: 'image' });
    await staffUstaadMediaView(t(), cmA, { code, mediaId, reason: 'report_review' });
    const audits = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.action, 'ustaad.media_view'), eq(s.auditLog.entityId, mediaId)));
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ actorUserId: cmA.userId, reason: 'report_review' });
  });

  it('404 for media not on the reported item, and for another city', async () => {
    const { code } = await reportedPostWith();
    const stray = await media(asker.memberId);
    await expect(
      staffUstaadMediaView(t(), cmA, { code, mediaId: stray, reason: 'report_review' }),
    ).rejects.toMatchObject({
      status: 404,
    });
    const { mediaId, code: c2 } = await reportedPostWith();
    await expect(
      staffUstaadMediaView(t(), cmB, { code: c2, mediaId, reason: 'report_review' }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses evidence, quarantine, legal holds and rejected files', async () => {
    for (const set of [
      { bucket: 'evidence' },
      { bucket: 'quarantine', status: 'uploaded' },
      { status: 'removed_archived', legalHold: 'pocso' },
      { status: 'rejected', rejectReasonCode: 'safety_block' },
    ] as const) {
      const { mediaId, code } = await reportedPostWith(set);
      await expect(
        staffUstaadMediaView(t(), cmA, { code, mediaId, reason: 'report_review' }),
      ).rejects.toMatchObject({ code: 'USTAAD_MEDIA_RESTRICTED' });
    }
  });

  it('message media only through the thread read, never here', async () => {
    const th = await startUstaadThread(t(), asker, { memberId: other.memberId, text: FEE });
    const mediaId = await media(asker.memberId);
    await db.update(s.ustaadMessages).set({ mediaId }).where(eq(s.ustaadMessages.id, th.messageId));
    const r = await reportFor(th.messageId);
    await expect(
      staffUstaadMediaView(t(), cmA, { code: r.code, mediaId, reason: 'report_review' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('members for staff', () => {
  it('search by handle prefix is city scoped and carries no phone or email', async () => {
    const [row] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, asker.memberId));
    const prefix = (row?.handle ?? '').slice(0, 4);
    const out = await searchUstaadMembersForStaff(t(), cmA, { q: prefix });
    expect(out.items.map((i) => i.memberId)).toContain(asker.memberId);
    expect(JSON.stringify(out)).not.toMatch(/\+91|@example\.com/);
    expect((await searchUstaadMembersForStaff(t(), cmB, { q: prefix })).items).toHaveLength(0);
  });

  it('detail: status, strikes and the sanctions history; 404 in another city', async () => {
    const d = await ustaadMemberForStaff(t(), cmA, other.memberId);
    expect(d).toMatchObject({ memberId: other.memberId, status: 'active' });
    expect(d.history.some((h) => h.action === 'ban')).toBe(true);
    expect(d.activeStrikes).toBeGreaterThan(0);
    expect(JSON.stringify(d)).not.toMatch(/\+91|@example\.com/);
    await expect(ustaadMemberForStaff(t(), cmB, other.memberId)).rejects.toMatchObject({ status: 404 });
  });

  it('restrict applies at once with a staff report; unban lifts it with a reason', async () => {
    const target = await member();
    const d = await ustaadMemberForStaff(t(), cmA, target.memberId);
    const out = await sanctionUstaadMember(t(), cmA, target.memberId, {
      action: 'restrict',
      reasonCode: 'spam',
      version: d.version,
    });
    expect(out.status).toBe('actioned');
    const [rep] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, out.code));
    expect(rep).toMatchObject({ source: 'staff', targetType: 'member', reporterId: null });
    const after = await ustaadMemberForStaff(t(), cmA, target.memberId);
    expect(after.status).toBe('restricted');
    // The staff member who restricted may not lift it alone.
    await expect(
      unbanUstaadMember(t(), cmA, target.memberId, { reasonCode: 'mistake', version: after.version }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    await unbanUstaadMember(t(), cmA2, target.memberId, {
      reasonCode: 'sanction_served',
      version: after.version,
    });
    expect((await ustaadMemberForStaff(t(), cmA, target.memberId)).status).toBe('active');
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ustaad.unban'));
    expect(audit.some((a) => a.entityId === target.memberId)).toBe(true);
  });

  it('a long ban waits for a second staff member (four-eyes)', async () => {
    const target = await member();
    const d = await ustaadMemberForStaff(t(), cmA, target.memberId);
    const out = await sanctionUstaadMember(t(), cmA, target.memberId, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 30,
      version: d.version,
    });
    expect(out.pendingBan).toBeDefined();
    expect((await ustaadMemberForStaff(t(), cmA, target.memberId)).status).toBe('active');
    const det = await ustaadReportDetail(t(), cmA2, out.code);
    await expect(
      confirmUstaadBan(t(), cmA, out.code, {
        proposalId: out.pendingBan?.proposalId ?? '',
        version: det.version,
      }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    await confirmUstaadBan(t(), cmA2, out.code, {
      proposalId: out.pendingBan?.proposalId ?? '',
      version: det.version,
    });
    expect((await ustaadMemberForStaff(t(), cmA, target.memberId)).status).toBe('banned');
  });

  it('unban of a four-eyes ban: refused alone, refused for anyone who took part, lifted when a second staff member confirms', async () => {
    const target = await member();
    const d = await ustaadMemberForStaff(t(), cmA, target.memberId);
    const out = await sanctionUstaadMember(t(), cmA, target.memberId, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 30,
      version: d.version,
    });
    const det = await ustaadReportDetail(t(), cmA2, out.code);
    await confirmUstaadBan(t(), cmA2, out.code, {
      proposalId: out.pendingBan?.proposalId ?? '',
      version: det.version,
    });
    const banned = await ustaadMemberForStaff(t(), cmA3, target.memberId);
    expect(banned.status).toBe('banned');
    // The proposer and the confirmer of the ban may not even propose lifting it.
    for (const who of [cmA, cmA2])
      await expect(
        unbanUstaadMember(t(), who, target.memberId, { reasonCode: 'mistake', version: banned.version }),
      ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    // A third staff member proposes: nothing is lifted yet, the UI shows "waiting for approval".
    const proposed = await unbanUstaadMember(t(), cmA3, target.memberId, {
      reasonCode: 'mistake',
      version: banned.version,
    });
    expect(proposed.pendingUnban).toBeDefined();
    const waiting = await ustaadMemberForStaff(t(), cmA3, target.memberId);
    expect(waiting.status).toBe('banned');
    expect(waiting.pendingUnban).toMatchObject({ proposedByMe: true });
    expect((await ustaadMemberForStaff(t(), cmA4, target.memberId)).pendingUnban).toMatchObject({
      proposedByMe: false,
    });
    // Neither the proposer nor anyone involved in the ban confirms.
    for (const who of [cmA3, cmA, cmA2])
      await expect(
        confirmUstaadUnban(t(), who, target.memberId, {
          proposalId: proposed.pendingUnban?.proposalId ?? '',
          version: waiting.version,
        }),
      ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    await confirmUstaadUnban(t(), cmA4, target.memberId, {
      proposalId: proposed.pendingUnban?.proposalId ?? '',
      version: waiting.version,
    });
    const lifted = await ustaadMemberForStaff(t(), cmA, target.memberId);
    expect(lifted.status).toBe('active');
    expect(lifted.pendingUnban).toBeNull();
    expect(lifted.activeStrikes).toBe(0);
    const [action] = await db
      .select()
      .from(s.ustaadModerationActions)
      .where(
        and(
          eq(s.ustaadModerationActions.targetId, target.memberId),
          eq(s.ustaadModerationActions.action, 'unban'),
        ),
      );
    expect(action).toMatchObject({ actorId: cmA3.userId, secondActorId: cmA4.userId });
  });

  it('lifting a ban keeps a restriction that stands on another report', async () => {
    const target = await member();
    let d = await ustaadMemberForStaff(t(), cmA, target.memberId);
    await sanctionUstaadMember(t(), cmA, target.memberId, {
      action: 'restrict',
      reasonCode: 'spam',
      version: d.version,
    });
    d = await ustaadMemberForStaff(t(), cmA2, target.memberId);
    // A short ban (below the four-eyes threshold) from another report.
    await sanctionUstaadMember(t(), cmA2, target.memberId, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 3,
      version: d.version,
    });
    d = await ustaadMemberForStaff(t(), cmA3, target.memberId);
    expect(d.status).toBe('banned');
    const out = await unbanUstaadMember(t(), cmA3, target.memberId, {
      reasonCode: 'mistake',
      version: d.version,
    });
    expect(out.pendingUnban).toBeUndefined();
    expect((await ustaadMemberForStaff(t(), cmA3, target.memberId)).status).toBe('restricted');
  });

  it('staff never sanction themselves; a frozen (child-safety review) account is never unbanned here', async () => {
    const selfUser = await member();
    const me: UstaadStaff = { userId: selfUser.userId, scope: { all: true } };
    const d = await ustaadMemberForStaff(t(), me, selfUser.memberId);
    await expect(
      sanctionUstaadMember(t(), me, selfUser.memberId, {
        action: 'restrict',
        reasonCode: 'spam',
        version: d.version,
      }),
    ).rejects.toMatchObject({ code: 'SELF_MODERATION' });
    const frozen = await member();
    await db
      .update(s.ustaadMembers)
      .set({ status: 'restricted', restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, frozen.memberId));
    const fd = await ustaadMemberForStaff(t(), cmA, frozen.memberId);
    await expect(
      unbanUstaadMember(t(), cmA, frozen.memberId, { reasonCode: 'mistake', version: fd.version }),
    ).rejects.toMatchObject({ code: 'USTAAD_MEMBER_FROZEN' });
  });
});

describe('legal list and own audit trail', () => {
  it('takedowns and legal holds, city scoped', async () => {
    const [p] = await db
      .insert(s.ustaadPosts)
      .values({ authorId: asker.memberId, cityId: f.raipur, kind: 'text', body: 'Court order post' })
      .returning();
    const out = await executeUstaadTakedown(t(), cmA, {
      targetType: 'post',
      targetId: p?.id ?? '',
      basis: 'court_order',
      reference: 'WP 123/2026',
    });
    const legal = await listUstaadLegalCases(t(), cmA);
    expect(legal.takedowns.find((x) => x.code === out.code)).toMatchObject({
      source: 'legal_order',
      clock: 'legal_3h',
      status: 'actioned',
    });
    expect(legal.holds.find((h) => h.targetId === p?.id)).toMatchObject({ legalHold: 'legal_order' });
    const b = await listUstaadLegalCases(t(), cmB);
    expect(b.takedowns.find((x) => x.code === out.code)).toBeUndefined();
    expect(b.holds.find((h) => h.targetId === p?.id)).toBeUndefined();
  });

  it("a staff member's own actions only", async () => {
    const mine = await listUstaadStaffOwnActions(t(), cmA2.userId, {});
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((i) => i.action.startsWith('ustaad.'))).toBe(true);
    const ids = new Set(mine.items.map((i) => i.id));
    const theirs = await listUstaadStaffOwnActions(t(), cmA.userId, {});
    expect(theirs.items.some((i) => ids.has(i.id))).toBe(false);
  });
});
