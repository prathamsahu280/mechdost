/**
 * Ustaad reports and moderation repositories (spec 23 § 3, § 7.6, § 13; SR-18, SR-36, SR-38, SR-39; plan task F2):
 * the real screen in Q&A (block / hold → auto report), member reports (idempotent, self 422, message only for its
 * thread, ncii hides at once, minor report restricts only from a qualified reporter), the queue sorted by clock with
 * city scope, remove + archive + media refused (AT-TAKEDOWN-1 for the parts that exist), self-moderation, four-eyes
 * bans, appeals by another staff member, false-report strikes, the takedown fast path, audited DM reads, the evidence
 * vault (AT-UP-9 DB half), the clock / purge / reminder / sanction jobs.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  actOnUstaadReport,
  answerUstaadQuestion,
  askUstaadQuestion,
  confirmUstaadBan,
  createUstaadReport,
  decideUstaadAppeal,
  ensureUser,
  executeUstaadTakedown,
  fileUstaadAppeal,
  joinUstaad,
  listUstaadModerationQueue,
  openUstaadAppeal,
  purgeUstaadRemovedArchive,
  readableUstaadMedia,
  readUstaadReportedThread,
  runUstaadReportClock,
  sealUstaadMediaEvidence,
  sendUstaadRulesReminders,
  setUstaadArchiveHold,
  syncRbacCatalogue,
  ustaadMyStanding,
  ustaadReportDetail,
  type Tx,
  type UstaadStaff,
} from '../src/repo';
import { EMAIL_TEMPLATES } from '@mechdost/shared/email-templates';
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

async function member(opts: { verified?: boolean; ageDays?: number; cityId?: string } = {}): Promise<M> {
  n += 1;
  const id = String(n).padStart(4, '0');
  const user = await ensureUser(db, {
    firebaseUid: `ustaad-mod-${id}`,
    phone: `+9197100${id.padStart(5, '0')}`,
    email: `ustaad-mod-${id}@example.com`,
    emailVerified: true,
  });
  const m = await joinUstaad(
    t(),
    { userId: user.id },
    {
      track: 'ustaad',
      specialities: ['two_wheeler'] as never,
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
      level: 'naya',
      verificationState: opts.verified ? 'verified' : 'unverified',
      joinedAt: new Date(Date.now() - (opts.ageDays ?? 90) * 86_400_000),
      ...(opts.cityId ? { cityId: opts.cityId } : {}),
    })
    .where(eq(s.ustaadMembers.id, m.id));
  return { userId: user.id, memberId: m.id };
}

async function staffUser(name: string): Promise<string> {
  const u = await ensureUser(db, {
    firebaseUid: `ustaad-mod-staff-${name}`,
    phone: `+91971999${String(n++).padStart(4, '0')}`,
    email: `ustaad-mod-staff-${name}@example.com`,
    emailVerified: true,
  });
  return u.id;
}

async function media(owner: string): Promise<string> {
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
      sha256: 'b'.repeat(64),
      objectKey: `m/${owner}/${randomUUID()}.webp`,
      uploadExpiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  if (!row) throw new Error('media');
  return row.id;
}

async function post(author: M, withMedia = true): Promise<{ id: string; mediaId: string | null }> {
  const [p] = await db
    .insert(s.ustaadPosts)
    .values({ authorId: author.memberId, cityId: f.raipur, kind: 'photo', body: 'Clutch plate badla' })
    .returning();
  if (!p) throw new Error('post');
  let mediaId: string | null = null;
  if (withMedia) {
    mediaId = await media(author.memberId);
    await db.insert(s.ustaadPostMedia).values({ postId: p.id, mediaId, position: 0 });
  }
  return { id: p.id, mediaId };
}

const key = () => `k${randomUUID().replace(/-/g, '').slice(0, 20)}`;
let author: M;
let reporter: M; // verified, 90 days
let newbie: M; // unverified, 3 days
let viewer: M;
let cmA: UstaadStaff; // community manager, Raipur
let cmA2: UstaadStaff; // a second Raipur manager
let cmB: UstaadStaff; // community manager, another city
let admin: UstaadStaff; // super admin (all cities)

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values({ cityId: f.raipur });
  const [state] = await db.select().from(s.states).limit(1);
  const [other] = await db
    .insert(s.cities)
    .values({ stateId: state?.id ?? '', code: 'BLP', slug: 'bilaspur', name: 'Bilaspur', status: 'live' })
    .returning();
  otherCityId = other?.id ?? '';
  author = await member();
  reporter = await member({ verified: true, ageDays: 90 });
  newbie = await member({ ageDays: 3 });
  viewer = await member();
  cmA = { userId: await staffUser('a'), scope: { all: false, cityIds: [f.raipur] } };
  cmA2 = { userId: await staffUser('a2'), scope: { all: false, cityIds: [f.raipur] } };
  cmB = { userId: await staffUser('b'), scope: { all: false, cityIds: [otherCityId] } };
  admin = { userId: await staffUser('admin'), scope: { all: true } };
});

afterAll(async () => {
  await client.close();
});

describe('screen in Q&A (F2 replaces the stub)', () => {
  it('SIM-P15: a phone number in a question is refused with its own code (USTAAD_CONTENT_PHONE)', async () => {
    await expect(
      askUstaadQuestion(t(), author, {
        title: 'Call me on 98765 43210',
        correction: 'none',
        segmentCode: 'two_wheeler',
        workCode: 'engine',
        reach: 'city',
        hideGarage: true,
        idemKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_CONTENT_PHONE' });
  });

  it('SIM-P15: a number plate in a question is refused with its own code (USTAAD_CONTENT_PLATE)', async () => {
    await expect(
      askUstaadQuestion(t(), author, {
        title: 'Ye gaadi CG04AB1234 nahi chal rahi',
        correction: 'none',
        segmentCode: 'two_wheeler',
        workCode: 'engine',
        reach: 'city',
        hideGarage: true,
        idemKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_CONTENT_PLATE' });
  });

  it('a UPI id in an answer holds it and opens an auto report in the queue with a clock', async () => {
    const q = await askUstaadQuestion(t(), viewer, {
      title: 'Splendor self nahi chal raha',
      correction: 'none',
      segmentCode: 'two_wheeler',
      workCode: 'engine',
      reach: 'city',
      hideGarage: true,
      idemKey: key(),
    });
    const a = await answerUstaadQuestion(t(), author, q.code, {
      body: 'Pehle 200 rupay ramesh@ybl pe bhejo',
      correction: 'none',
      idemKey: key(),
    });
    expect(a.status).toBe('held');
    const [r] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.targetId, a.id));
    expect(r).toMatchObject({ source: 'auto_scam', reporterId: null, status: 'open', clock: 'standard_24h' });
  });
});

describe('member reports', () => {
  it('creates a report once (idempotent), refuses self-reports and an inactive reason', async () => {
    const p = await post(author);
    const first = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    const again = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    expect(again.code).toBe(first.code);
    await expect(
      createUstaadReport(t(), author, { targetType: 'post', targetId: p.id, reasonCode: 'spam' }),
    ).rejects.toMatchObject({ code: 'USTAAD_REPORT_SELF' });
    await db
      .update(s.ustaadReportReasons)
      .set({ active: false })
      .where(eq(s.ustaadReportReasons.code, 'fake'));
    await expect(
      createUstaadReport(t(), reporter, { targetType: 'post', targetId: p.id, reasonCode: 'fake' }),
    ).rejects.toMatchObject({ code: 'USTAAD_REASON_OFF' });
    await db
      .update(s.ustaadReportReasons)
      .set({ active: true })
      .where(eq(s.ustaadReportReasons.code, 'fake'));
  });

  it('a message is reportable only by a member of its thread (404 for anyone else)', async () => {
    const [low, high] = [author.memberId, viewer.memberId].sort();
    const [th] = await db
      .insert(s.ustaadThreads)
      .values({ lowId: low ?? '', highId: high ?? '', requestedBy: author.memberId, status: 'open' })
      .returning();
    const [msg] = await db
      .insert(s.ustaadMessages)
      .values({ threadId: th?.id ?? '', senderId: author.memberId, body: 'Mera number 98765 43210 hai' })
      .returning();
    await expect(
      createUstaadReport(t(), reporter, {
        targetType: 'message',
        targetId: msg?.id ?? '',
        reasonCode: 'abuse',
      }),
    ).rejects.toMatchObject({ status: 404 });
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'message',
      targetId: msg?.id ?? '',
      reasonCode: 'abuse',
    });
    // DM content only through the audited route; the detail never carries it.
    const d = await ustaadReportDetail(t(), cmA, r.code);
    expect(d.text).toBeNull();
    const thread = await readUstaadReportedThread(t(), cmA, r.code, 'report_review');
    expect(thread.messages.find((m) => m.reported)?.body).toContain('[phone]');
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'ustaad.dm_read'));
    expect(audits).toHaveLength(1);
    // Another city's manager: 404 on the report and on the thread.
    await expect(readUstaadReportedThread(t(), cmB, r.code, 'report_review')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('ncii_impersonation runs on the 2 h clock; it hides the item at once only from a qualified reporter', async () => {
    const p = await post(author);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'ncii_impersonation',
    });
    const [row] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, r.code));
    expect(row?.clock).toBe('intimate_2h');
    expect((row?.dueAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBe(2 * 3_600_000);
    // An unverified reporter only queues it (security review fix 5): the post stays up until a manager decides.
    let [p2] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(p2?.status).toBe('visible');
    await createUstaadReport(t(), reporter, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'ncii_impersonation',
    });
    [p2] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(p2?.status).toBe('held');
  });

  it('dismissed ncii reports count toward the false_report strike', async () => {
    const liar = await member({ verified: true, ageDays: 90 });
    for (let i = 0; i < 3; i += 1) {
      const p = await post(await member(), false);
      const r = await createUstaadReport(t(), liar, {
        targetType: 'post',
        targetId: p.id,
        reasonCode: i === 0 ? 'minor' : 'ncii_impersonation',
      });
      const d = await ustaadReportDetail(t(), cmA, r.code);
      await actOnUstaadReport(t(), cmA, r.code, {
        action: 'keep',
        reasonCode: 'no_violation',
        version: d.version,
      });
    }
    const strikes = await db
      .select()
      .from(s.ustaadStrikes)
      .where(
        and(eq(s.ustaadStrikes.memberId, liar.memberId), eq(s.ustaadStrikes.reasonCode, 'false_report')),
      );
    expect(strikes).toHaveLength(1);
  });

  it('a minor report from a verified ≥30-day reporter restricts the account; from anyone else it does not', async () => {
    const target = await member();
    const p = await post(target, false);
    await createUstaadReport(t(), newbie, { targetType: 'post', targetId: p.id, reasonCode: 'minor' });
    let [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, target.memberId));
    expect(m?.restrictedMode).toBe('none');
    await createUstaadReport(t(), reporter, { targetType: 'post', targetId: p.id, reasonCode: 'minor' });
    [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, target.memberId));
    expect(m?.restrictedMode).toBe('minor_report');
    // Minor reports sit at the top of the queue.
    const q = await listUstaadModerationQueue(t(), cmA, { queue: 'open', cityId: null });
    expect(q.items[0]?.minor).toBe(true);
  });
});

describe('queue and city scope', () => {
  it('is sorted by clock within a priority, scoped by city; a city-B manager sees nothing of Raipur', async () => {
    const q = await listUstaadModerationQueue(t(), cmA, { queue: 'open', cityId: null });
    expect(q.items.length).toBeGreaterThan(0);
    const normal = q.items.filter((i) => !i.minor).map((i) => i.dueAt);
    expect([...normal].sort()).toEqual(normal);
    const b = await listUstaadModerationQueue(t(), cmB, { queue: 'open', cityId: null });
    expect(b.items).toHaveLength(0);
    const code = q.items[0]?.code ?? '';
    await expect(ustaadReportDetail(t(), cmB, code)).rejects.toMatchObject({ status: 404 });
    const all = await listUstaadModerationQueue(t(), admin, { queue: 'open', cityId: null });
    expect(all.items.length).toBe(q.items.length);
  });
});

describe('decisions', () => {
  it('remove: content removed, archived with an evidence row, media refused at once (AT-TAKEDOWN-1, existing surfaces)', async () => {
    const p = await post(author);
    expect(
      await readableUstaadMedia(t(), { mediaId: p.mediaId ?? '', viewerMemberId: viewer.memberId }),
    ).not.toBeNull();
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    const d = await ustaadReportDetail(t(), cmA, r.code);
    const out = await actOnUstaadReport(t(), cmA, r.code, {
      action: 'remove',
      reasonCode: 'abuse',
      version: d.version,
    });
    expect(out.status).toBe('actioned');
    expect(out.media.map((m) => m.mediaId)).toEqual([p.mediaId]);
    const [p2] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(p2?.status).toBe('removed');
    expect(
      await readableUstaadMedia(t(), { mediaId: p.mediaId ?? '', viewerMemberId: viewer.memberId }),
    ).toBeNull();
    const archive = await db
      .select()
      .from(s.ustaadRemovedArchive)
      .where(eq(s.ustaadRemovedArchive.targetId, p.id));
    expect(archive).toHaveLength(1);
    const actions = await db
      .select()
      .from(s.ustaadModerationActions)
      .where(eq(s.ustaadModerationActions.targetId, p.id));
    expect(actions.map((a) => a.action)).toEqual(['remove']);
  });

  it('self-moderation is refused (403 SELF_MODERATION)', async () => {
    const staffMember = await member();
    const me: UstaadStaff = { userId: staffMember.userId, scope: { all: true } };
    const p = await post(staffMember, false);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await expect(
      actOnUstaadReport(t(), me, r.code, { action: 'remove', reasonCode: 'spam', version: 1 }),
    ).rejects.toMatchObject({ code: 'SELF_MODERATION' });
  });

  it('a ban under the four-eyes limit applies at once; from 7 days it waits for a different staff member', async () => {
    const bad = await member();
    const p1 = await post(bad, false);
    const r1 = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p1.id,
      reasonCode: 'abuse',
    });
    const short = await actOnUstaadReport(t(), cmA, r1.code, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 3,
      version: 1,
    });
    expect(short.status).toBe('actioned');
    let [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, bad.memberId));
    expect(m?.status).toBe('banned');

    const worse = await member();
    const p2 = await post(worse, false);
    const r2 = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p2.id,
      reasonCode: 'abuse',
    });
    const proposed = await actOnUstaadReport(t(), cmA, r2.code, {
      action: 'ban',
      reasonCode: 'abuse',
      days: 30,
      version: 1,
    });
    expect(proposed.pendingBan).toBeDefined();
    [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, worse.memberId));
    expect(m?.status).toBe('active');
    const d = await ustaadReportDetail(t(), cmA, r2.code);
    const proposalId = proposed.pendingBan?.proposalId ?? '';
    await expect(
      confirmUstaadBan(t(), cmA, r2.code, { proposalId, version: d.version }),
    ).rejects.toMatchObject({
      code: 'FOUR_EYES',
    });
    await expect(
      confirmUstaadBan(t(), cmB, r2.code, { proposalId, version: d.version }),
    ).rejects.toMatchObject({
      status: 404,
    });
    const done = await confirmUstaadBan(t(), cmA2, r2.code, { proposalId, version: d.version });
    expect(done.status).toBe('actioned');
    [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, worse.memberId));
    expect(m?.status).toBe('banned');
    const [ban] = await db
      .select()
      .from(s.ustaadModerationActions)
      .where(and(eq(s.ustaadModerationActions.targetId, p2.id), eq(s.ustaadModerationActions.action, 'ban')));
    expect(ban).toMatchObject({ actorId: cmA.userId, secondActorId: cmA2.userId, days: 30 });
    // SIM-B16: the second approver has an audit row of their own (Admin → Audit log and their My actions).
    const confirmRows = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.actorUserId, cmA2.userId), eq(s.auditLog.action, 'ustaad.ban_confirmed')));
    expect(confirmRows).toHaveLength(1);
    expect(confirmRows[0]).toMatchObject({ entity: 'ustaad_post', entityId: p2.id });
    // SIM-B13: the proposer (decidedBy is the confirmer) also took part, so the console hides appeal / lift forms.
    expect((await ustaadReportDetail(t(), cmA, r2.code)).decidedByMe).toBe(true);
    expect((await ustaadReportDetail(t(), cmA2, r2.code)).decidedByMe).toBe(true);
    expect((await ustaadReportDetail(t(), cmB, r2.code).catch(() => null))?.decidedByMe ?? false).toBe(false);
  });

  it('appeal: linked to the author ticket, decided by another staff member; overturned restores post and media', async () => {
    const p = await post(author);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'abuse', version: 1 });
    const [ticket] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-7K3Q9X',
        userId: author.userId,
        kind: 'other',
        slaAckDue: new Date(Date.now() + 86_400_000),
        slaResolveDue: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    let d = await ustaadReportDetail(t(), cmA, r.code);
    await openUstaadAppeal(t(), cmA2, r.code, { ticketCode: ticket?.code ?? '', version: d.version });
    d = await ustaadReportDetail(t(), cmA, r.code);
    expect(d.status).toBe('appealed');
    await expect(
      decideUstaadAppeal(t(), cmA, r.code, { outcome: 'overturned', version: d.version }),
    ).rejects.toMatchObject({ code: 'FOUR_EYES' });
    const out = await decideUstaadAppeal(t(), cmA2, r.code, { outcome: 'overturned', version: d.version });
    expect(out.status).toBe('overturned');
    const [p2] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(p2?.status).toBe('visible');
    expect(
      await readableUstaadMedia(t(), { mediaId: p.mediaId ?? '', viewerMemberId: viewer.memberId }),
    ).not.toBeNull();
    // SIM-P26: the appellant hears the appeal's outcome, never the reporter's "your report was checked".
    const kinds = await db
      .select({ kind: s.notifications.kind, title: s.notifications.title })
      .from(s.notifications)
      .where(eq(s.notifications.userId, author.userId));
    expect(kinds.map((k) => k.kind)).toContain('ustaad.appeal_overturned');
    expect(kinds.map((k) => k.kind)).not.toContain('ustaad.report_outcome');
  });

  it('SIM-P26: an upheld appeal tells the appellant it was upheld (en + hi texts exist)', async () => {
    const p = await post(author);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    const [ticket] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-7K3Q9Y',
        userId: author.userId,
        kind: 'other',
        slaAckDue: new Date(Date.now() + 86_400_000),
        slaResolveDue: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    let d = await ustaadReportDetail(t(), cmA, r.code);
    await openUstaadAppeal(t(), cmA2, r.code, { ticketCode: ticket?.code ?? '', version: d.version });
    d = await ustaadReportDetail(t(), cmA, r.code);
    await decideUstaadAppeal(t(), cmA2, r.code, { outcome: 'upheld', version: d.version });
    const rows = await db
      .select({ kind: s.notifications.kind, body: s.notifications.body })
      .from(s.notifications)
      .where(
        and(eq(s.notifications.userId, author.userId), eq(s.notifications.kind, 'ustaad.appeal_upheld')),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).not.toMatch(/thank you/i);
  });

  it('appeal upheld: the decider is in audit_log (QA 2026-11-27 — an upheld appeal left no audit row)', async () => {
    const p = await post(author);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'abuse', version: 1 });
    const [ticket] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-7K3QUP',
        userId: author.userId,
        kind: 'other',
        slaAckDue: new Date(Date.now() + 86_400_000),
        slaResolveDue: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    let d = await ustaadReportDetail(t(), cmA, r.code);
    await openUstaadAppeal(t(), cmA2, r.code, { ticketCode: ticket?.code ?? '', version: d.version });
    d = await ustaadReportDetail(t(), cmA, r.code);
    const out = await decideUstaadAppeal(t(), cmA2, r.code, { outcome: 'upheld', version: d.version });
    expect(out.status).toBe('upheld');
    const rows = await db
      .select()
      .from(s.auditLog)
      .where(
        and(
          eq(s.auditLog.action, 'ustaad.appeal_upheld'),
          eq(s.auditLog.actorUserId, cmA2.userId),
          sql`${s.auditLog.after}->>'report' = ${r.code}`,
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorRole: 'staff', entity: 'ustaad_report', reason: 'upheld' });
  });

  it('repeated dismissed minor reports earn a false_report strike', async () => {
    const liar = await member({ verified: true, ageDays: 90 });
    for (let i = 0; i < 3; i += 1) {
      const target = await member();
      const p = await post(target, false);
      const r = await createUstaadReport(t(), liar, {
        targetType: 'post',
        targetId: p.id,
        reasonCode: 'minor',
      });
      const d = await ustaadReportDetail(t(), cmA, r.code);
      await actOnUstaadReport(t(), cmA, r.code, {
        action: 'keep',
        reasonCode: 'no_violation',
        version: d.version,
      });
      const [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, target.memberId));
      expect(m?.restrictedMode).toBe('none');
    }
    const strikes = await db
      .select()
      .from(s.ustaadStrikes)
      .where(
        and(eq(s.ustaadStrikes.memberId, liar.memberId), eq(s.ustaadStrikes.reasonCode, 'false_report')),
      );
    expect(strikes).toHaveLength(1);
    // A reporter with an active false_report strike no longer restricts anyone at once.
    const target = await member();
    const p = await post(target, false);
    await createUstaadReport(t(), liar, { targetType: 'post', targetId: p.id, reasonCode: 'minor' });
    const [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, target.memberId));
    expect(m?.restrictedMode).toBe('none');
  });
});

describe('takedown fast path', () => {
  it('a court order: one call opens a 3 h report, removes the post and refuses its media; city B cannot', async () => {
    const p = await post(author);
    await expect(
      executeUstaadTakedown(t(), cmB, {
        targetType: 'post',
        targetId: p.id,
        basis: 'court_order',
        reference: 'W.P.(C) 1/2026',
      }),
    ).rejects.toMatchObject({ status: 404 });
    const out = await executeUstaadTakedown(t(), cmA, {
      targetType: 'post',
      targetId: p.id,
      basis: 'court_order',
      reference: 'W.P.(C) 1/2026',
    });
    expect(out.status).toBe('actioned');
    const [r] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, out.code));
    expect(r).toMatchObject({ source: 'legal_order', clock: 'legal_3h' });
    expect(
      await readableUstaadMedia(t(), { mediaId: p.mediaId ?? '', viewerMemberId: viewer.memberId }),
    ).toBeNull();
    const [arch] = await db
      .select()
      .from(s.ustaadRemovedArchive)
      .where(eq(s.ustaadRemovedArchive.targetId, p.id));
    expect(arch?.legalHold).toBe('legal_order');
  });

  it('a removal grievance runs on the 36 h clock', async () => {
    const p = await post(author, false);
    const out = await executeUstaadTakedown(t(), admin, {
      targetType: 'post',
      targetId: p.id,
      basis: 'grievance_removal',
      reference: 'REQ-RPR-2026-ABCDEF',
    });
    const [r] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, out.code));
    expect(r?.clock).toBe('removal_36h');
    expect((r?.dueAt.getTime() ?? 0) - (r?.createdAt.getTime() ?? 0)).toBe(36 * 3_600_000);
  });
});

describe('evidence vault (AT-UP-9, DB half)', () => {
  it('a hash match seals the file, freezes the account and opens a 2 h auto_safety report', async () => {
    const owner = await member();
    const [m] = await db
      .insert(s.ustaadMedia)
      .values({
        ownerMemberId: owner.memberId,
        host: 'supabase',
        bucket: 'quarantine',
        kind: 'image',
        status: 'uploaded',
        declaredBytes: 1_000,
        declaredMime: 'image/jpeg',
        sha256: 'c'.repeat(64),
        objectKey: `q/${owner.memberId}/${randomUUID()}.jpg`,
        uploadExpiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning();
    const evidenceKey = `e/${owner.memberId}/${randomUUID()}.jpg`;
    const out = await sealUstaadMediaEvidence(t(), { mediaId: m?.id ?? '', evidenceKey });
    const [sealed] = await db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, m?.id ?? ''));
    expect(sealed).toMatchObject({
      status: 'rejected',
      rejectReasonCode: 'safety_block',
      bucket: 'evidence',
      legalHold: 'pocso',
    });
    const [frozen] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, owner.memberId));
    expect(frozen).toMatchObject({ status: 'restricted', restrictedMode: 'review', restrictedUntil: null });
    const [r] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, out.reportCode));
    expect(r).toMatchObject({ source: 'auto_safety', clock: 'intimate_2h' });
  });
});

describe('jobs', () => {
  it('report clock: overdue notices at 50 % and 100 %, once per stage', async () => {
    const p = await post(author, false);
    const r = await createUstaadReport(t(), reporter, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    const [row] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, r.code));
    const created = row?.createdAt ?? new Date();
    const countOverdue = async () =>
      (
        await db
          .select()
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.kind, 'staff.ustaad_report_overdue'),
              eq(s.notifications.userId, cmA.userId),
            ),
          )
      ).filter((x) => (x.dedupeKey ?? '').includes(row?.id ?? 'x')).length;
    // The managers need the permission for staffRecipients: grant the Raipur role.
    const { grantRole } = await import('../src/repo');
    await grantRole(db, { userId: cmA.userId, role: 'community_manager', cityId: f.raipur, grantedBy: null });
    await runUstaadReportClock(t(), new Date(created.getTime() + 13 * 3_600_000));
    expect(await countOverdue()).toBe(1);
    await runUstaadReportClock(t(), new Date(created.getTime() + 14 * 3_600_000));
    expect(await countOverdue()).toBe(1);
    await runUstaadReportClock(t(), new Date(created.getTime() + 25 * 3_600_000));
    expect(await countOverdue()).toBe(2);
  });

  it('archive purge after 180 days unless on legal hold', async () => {
    const p1 = await post(author);
    const p2 = await post(author);
    for (const p of [p1, p2]) {
      const r = await createUstaadReport(t(), viewer, {
        targetType: 'post',
        targetId: p.id,
        reasonCode: 'spam',
      });
      await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    }
    await setUstaadArchiveHold(t(), { targetType: 'post', targetId: p2.id, hold: 'police_request' });
    const later = new Date(Date.now() + 181 * 86_400_000);
    const purged = await purgeUstaadRemovedArchive(t(), later);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(
      await db.select().from(s.ustaadRemovedArchive).where(eq(s.ustaadRemovedArchive.targetId, p1.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(s.ustaadRemovedArchive).where(eq(s.ustaadRemovedArchive.targetId, p2.id)),
    ).toHaveLength(1);
    const [m1] = await db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, p1.mediaId ?? ''));
    expect(m1?.purgeAfter).not.toBeNull();
  });

  it('rules reminder is idempotent within a period', async () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const first = await sendUstaadRulesReminders(t(), { now, batch: 1000 });
    expect(first.sent).toBeGreaterThan(0);
    const again = await sendUstaadRulesReminders(t(), { now, batch: 1000 });
    expect(again.sent).toBe(0);
  });

  it('expired bans end on the clock run', async () => {
    const m = await member();
    await db
      .update(s.ustaadMembers)
      .set({ status: 'banned', bannedUntil: new Date(Date.now() - 1000) })
      .where(eq(s.ustaadMembers.id, m.memberId));
    const out = await runUstaadReportClock(t());
    expect(out.lifted).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, m.memberId));
    expect(row?.status).toBe('active');
  });

  it('moderation actions are append-only', async () => {
    await expect(db.update(s.ustaadModerationActions).set({ note: 'x' })).rejects.toThrow();
  });
});

describe('security review fixes (2026-11-26)', () => {
  let tk = 0;
  const ticketFor = async (userId: string) => {
    tk += 1;
    const [row] = await db
      .insert(s.supportTickets)
      .values({
        code: `REQ-RPR-2026-SEC${String(tk).padStart(3, '0')}`,
        userId,
        kind: 'other',
        slaAckDue: new Date(Date.now() + 86_400_000),
        slaResolveDue: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    return row?.code ?? '';
  };
  const reportOn = async (m: M) => {
    const p = await post(m, false);
    return createUstaadReport(t(), viewer, { targetType: 'post', targetId: p.id, reasonCode: 'abuse' });
  };
  const memberRow = async (m: M) =>
    (await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, m.memberId)))[0];

  it('fix 1: a short ban never replaces a permanent or longer one; a restriction never dates a frozen account', async () => {
    const perm = await member();
    await db
      .update(s.ustaadMembers)
      .set({ status: 'banned', bannedUntil: null })
      .where(eq(s.ustaadMembers.id, perm.memberId));
    const r = await reportOn(perm);
    await actOnUstaadReport(t(), cmA, r.code, { action: 'ban', reasonCode: 'abuse', days: 3, version: 1 });
    expect(await memberRow(perm)).toMatchObject({ status: 'banned', bannedUntil: null });

    const frozen = await member();
    await db
      .update(s.ustaadMembers)
      .set({ status: 'restricted', restrictedUntil: null, restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, frozen.memberId));
    const r2 = await reportOn(frozen);
    await actOnUstaadReport(t(), cmA, r2.code, { action: 'restrict', reasonCode: 'abuse', version: 1 });
    expect(await memberRow(frozen)).toMatchObject({
      status: 'restricted',
      restrictedUntil: null,
      restrictedMode: 'review',
    });

    const longBan = await member();
    const r3 = await reportOn(longBan);
    await actOnUstaadReport(t(), cmA, r3.code, { action: 'ban', reasonCode: 'abuse', days: 5, version: 1 });
    const until = (await memberRow(longBan))?.bannedUntil?.getTime() ?? 0;
    const r4 = await reportOn(longBan);
    await actOnUstaadReport(t(), cmA, r4.code, { action: 'ban', reasonCode: 'abuse', days: 2, version: 1 });
    expect((await memberRow(longBan))?.bannedUntil?.getTime()).toBe(until);
  });

  it('fix 2: an overturned appeal lifts only its own sanction; POCSO review mode is never lifted', async () => {
    const m = await member();
    const r1 = await reportOn(m);
    await actOnUstaadReport(t(), cmA, r1.code, { action: 'ban', reasonCode: 'abuse', days: 2, version: 1 });
    const r2 = await reportOn(m);
    await actOnUstaadReport(t(), cmA, r2.code, { action: 'ban', reasonCode: 'abuse', days: 5, version: 1 });
    const longUntil = (await memberRow(m))?.bannedUntil?.getTime() ?? 0;
    let d = await ustaadReportDetail(t(), cmA, r2.code);
    await openUstaadAppeal(t(), cmA2, r2.code, { ticketCode: await ticketFor(m.userId), version: d.version });
    d = await ustaadReportDetail(t(), cmA, r2.code);
    await decideUstaadAppeal(t(), cmA2, r2.code, { outcome: 'overturned', version: d.version });
    const after = await memberRow(m);
    expect(after?.status).toBe('banned');
    expect(after?.bannedUntil?.getTime() ?? 0).toBeLessThan(longUntil);

    const frozen = await member();
    const r3 = await reportOn(frozen);
    await actOnUstaadReport(t(), cmA, r3.code, { action: 'restrict', reasonCode: 'abuse', version: 1 });
    await db
      .update(s.ustaadMembers)
      .set({ status: 'restricted', restrictedUntil: null, restrictedMode: 'review' })
      .where(eq(s.ustaadMembers.id, frozen.memberId));
    d = await ustaadReportDetail(t(), cmA, r3.code);
    await openUstaadAppeal(t(), cmA2, r3.code, {
      ticketCode: await ticketFor(frozen.userId),
      version: d.version,
    });
    d = await ustaadReportDetail(t(), cmA, r3.code);
    await decideUstaadAppeal(t(), cmA2, r3.code, { outcome: 'overturned', version: d.version });
    expect(await memberRow(frozen)).toMatchObject({
      status: 'restricted',
      restrictedMode: 'review',
      restrictedUntil: null,
    });
  });

  it('fix 3: a legal takedown is overturned only with ustaad:takedown, never while on legal hold', async () => {
    const p = await post(author);
    const out = await executeUstaadTakedown(t(), cmA, {
      targetType: 'post',
      targetId: p.id,
      basis: 'gov_intimation',
      reference: 'MeitY 1/2026',
    });
    let d = await ustaadReportDetail(t(), cmA, out.code);
    await openUstaadAppeal(t(), cmA2, out.code, {
      ticketCode: await ticketFor(author.userId),
      version: d.version,
    });
    d = await ustaadReportDetail(t(), cmA, out.code);
    await expect(
      decideUstaadAppeal(t(), cmA2, out.code, { outcome: 'overturned', version: d.version }),
    ).rejects.toMatchObject({ code: 'USTAAD_LEGAL_HOLD' });
    await expect(
      decideUstaadAppeal(t(), { ...cmA2, canTakedown: true }, out.code, {
        outcome: 'overturned',
        version: d.version,
      }),
    ).rejects.toMatchObject({ code: 'USTAAD_LEGAL_HOLD' });
    const [p2] = await db.select().from(s.ustaadPosts).where(eq(s.ustaadPosts.id, p.id));
    expect(p2?.status).toBe('removed');
  });

  it('fix 4: a later legal hold covers media already archived, and the purge skips media of held rows', async () => {
    const p = await post(author);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    await executeUstaadTakedown(t(), cmA, {
      targetType: 'post',
      targetId: p.id,
      basis: 'court_order',
      reference: 'Cr. 9/2026',
    });
    let [m] = await db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, p.mediaId ?? ''));
    expect(m).toMatchObject({ status: 'removed_archived', legalHold: 'legal_order', purgeAfter: null });
    // Even if the media row's own hold were cleared, the held archive row keeps the file from the purge.
    await db
      .update(s.ustaadMedia)
      .set({ legalHold: null })
      .where(eq(s.ustaadMedia.id, p.mediaId ?? ''));
    await purgeUstaadRemovedArchive(t(), new Date(Date.now() + 181 * 86_400_000));
    [m] = await db
      .select()
      .from(s.ustaadMedia)
      .where(eq(s.ustaadMedia.id, p.mediaId ?? ''));
    expect(m?.purgeAfter).toBeNull();
  });
});

describe('advisor review follow-ups', () => {
  it('restrict on a minor-reported author applies a dated restriction (the decision is the review)', async () => {
    const target = await member();
    const p = await post(target, false);
    const r = await createUstaadReport(t(), reporter, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'minor',
    });
    const d = await ustaadReportDetail(t(), cmA, r.code);
    await actOnUstaadReport(t(), cmA, r.code, {
      action: 'restrict',
      reasonCode: 'minor',
      version: d.version,
    });
    const [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, target.memberId));
    expect(m?.status).toBe('restricted');
    expect(m?.restrictedMode).toBe('none');
    expect(m?.restrictedUntil).not.toBeNull();
  });

  it('the queue pages with its cursor across more than 20 reports, no item twice', async () => {
    for (let i = 0; i < 22; i += 1) {
      const p = await post(author, false);
      await createUstaadReport(t(), viewer, { targetType: 'post', targetId: p.id, reasonCode: 'spam' });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const q = await listUstaadModerationQueue(t(), admin, { queue: 'open', cityId: null, cursor });
      seen.push(...q.items.map((i) => i.code));
      if (!q.nextCursor) break;
      cursor = q.nextCursor;
    }
    expect(seen.length).toBeGreaterThan(22);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('overdue notices reach every moderator of the city once', async () => {
    const { grantRole } = await import('../src/repo');
    await grantRole(db, {
      userId: cmA2.userId,
      role: 'community_manager',
      cityId: f.raipur,
      grantedBy: null,
    });
    const p = await post(author, false);
    const r = await createUstaadReport(t(), reporter, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    const [row] = await db.select().from(s.ustaadReports).where(eq(s.ustaadReports.code, r.code));
    const at = new Date((row?.createdAt.getTime() ?? 0) + 13 * 3_600_000);
    await runUstaadReportClock(t(), at);
    await runUstaadReportClock(t(), at);
    for (const userId of [cmA.userId, cmA2.userId]) {
      const rows = (
        await db
          .select()
          .from(s.notifications)
          .where(
            and(eq(s.notifications.kind, 'staff.ustaad_report_overdue'), eq(s.notifications.userId, userId)),
          )
      ).filter((x) => (x.dedupeKey ?? '').includes(row?.id ?? 'x'));
      expect(rows).toHaveLength(1);
    }
  });

  it("the reporter's note is masked for staff", async () => {
    const p = await post(author, false);
    const r = await createUstaadReport(t(), reporter, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'other',
      note: 'isne mujhe 98765 43210 se call kiya',
    });
    const d = await ustaadReportDetail(t(), cmA, r.code);
    expect(d.note).toContain('[phone]');
    expect(d.note).not.toContain('98765');
  });
});

describe('member standing and appeal (SIM-P19 / SIM-P24)', () => {
  it('the author sees each decision with its reason code and appeal state; never the reporter', async () => {
    const who = await member();
    const p = await post(who);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    const standing = await ustaadMyStanding(t(), { userId: who.userId });
    expect(standing.status).toBe('active');
    expect(standing.items).toEqual([
      expect.objectContaining({ reportCode: r.code, action: 'remove', reasonCode: 'spam', appeal: 'can' }),
    ]);
    expect(JSON.stringify(standing)).not.toContain(viewer.memberId);
    expect((await ustaadMyStanding(t(), { userId: viewer.userId })).items).toEqual([]);
  });

  it('a restricted member sees the end date; filing the appeal opens one ustaad_appeal ticket', async () => {
    const who = await member();
    const p = await post(who);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'abuse',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'restrict', reasonCode: 'abuse', version: 1 });
    const before = await ustaadMyStanding(t(), { userId: who.userId });
    expect(before.status).toBe('restricted');
    expect(before.restrictedUntil).not.toBeNull();
    expect(before.items[0]?.action).toBe('restrict');
    expect(typeof before.items[0]?.endsAt).toBe('string');
    // Another member cannot appeal it (404, no oracle).
    await expect(
      fileUstaadAppeal(
        t(),
        { userId: viewer.userId },
        { reportCode: r.code, note: 'This was not me at all.' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const filed = await fileUstaadAppeal(
      t(),
      { userId: who.userId },
      { reportCode: r.code, note: 'I only asked about brake oil.' },
    );
    expect(filed.ticketCode).toMatch(/^REQ-/);
    const [ticket] = await db
      .select()
      .from(s.supportTickets)
      .where(eq(s.supportTickets.code, filed.ticketCode));
    expect(ticket?.kind).toBe('ustaad_appeal');
    expect((await ustaadReportDetail(t(), cmA, r.code)).status).toBe('appealed');
    expect((await ustaadMyStanding(t(), { userId: who.userId })).items[0]?.appeal).toBe('pending');
    await expect(
      fileUstaadAppeal(t(), { userId: who.userId }, { reportCode: r.code, note: 'Again, please check.' }),
    ).rejects.toMatchObject({ code: 'USTAAD_APPEAL_CLOSED' });
  });

  it('a banned member can still read their standing and appeal the ban', async () => {
    const who = await member();
    const p = await post(who);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'job_scam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'ban', days: 3, reasonCode: 'job_scam', version: 1 });
    const standing = await ustaadMyStanding(t(), { userId: who.userId });
    expect(standing.status).toBe('banned');
    expect(standing.bannedUntil).not.toBeNull();
    const filed = await fileUstaadAppeal(
      t(),
      { userId: who.userId },
      { reportCode: r.code, note: 'The job was real, here is the garage.' },
    );
    expect(filed.ticketCode).toMatch(/^REQ-/);
  });
});

// SIM-F1 (live QA 2026-11-27): spec 23 § 12 promises bell + email for removals, strikes, bans and appeal outcomes;
// the network only wrote bell rows, so a member who never opened the bell was never told.
describe('SIM-F1: moderation decisions also email the member (outbox, en + hi, preferences)', () => {
  const emails = async (userId: string) =>
    (
      await db
        .select({ key: s.notificationOutbox.templateKey })
        .from(s.notificationOutbox)
        .where(
          and(eq(s.notificationOutbox.recipientUserId, userId), eq(s.notificationOutbox.channel, 'email')),
        )
    ).map((r) => r.key);

  it('a removal queues the content-removed email; a ban queues the ban bell and email', async () => {
    const who = await member();
    const p = await post(who, false);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    expect(await emails(who.userId)).toContain('ustaad_content_removed');

    const p2 = await post(who, false);
    const r2 = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p2.id,
      reasonCode: 'abuse',
    });
    await actOnUstaadReport(t(), cmA, r2.code, { action: 'ban', reasonCode: 'abuse', days: 3, version: 1 });
    expect(await emails(who.userId)).toContain('ustaad_banned');
    const bells = await db
      .select({ kind: s.notifications.kind })
      .from(s.notifications)
      .where(eq(s.notifications.userId, who.userId));
    expect(bells.map((b) => b.kind)).toContain('ustaad.banned');
  });

  it('an appeal outcome is emailed to the appellant', async () => {
    const who = await member();
    const p = await post(who, false);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    const [ticket] = await db
      .insert(s.supportTickets)
      .values({
        code: 'REQ-RPR-2026-F1APPL',
        userId: who.userId,
        kind: 'other',
        slaAckDue: new Date(Date.now() + 86_400_000),
        slaResolveDue: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();
    let d = await ustaadReportDetail(t(), cmA, r.code);
    await openUstaadAppeal(t(), cmA2, r.code, { ticketCode: ticket?.code ?? '', version: d.version });
    d = await ustaadReportDetail(t(), cmA, r.code);
    await decideUstaadAppeal(t(), cmA2, r.code, { outcome: 'upheld', version: d.version });
    expect(await emails(who.userId)).toContain('ustaad_appeal_upheld');
  });

  it('a member who switched transactional email off gets the bell only', async () => {
    const who = await member();
    await db
      .insert(s.notificationPreferences)
      .values({ userId: who.userId, channel: 'email', category: 'transactional', enabled: false });
    const p = await post(who, false);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    expect(await emails(who.userId)).toEqual([]);
  });
});

// SIM-F2 (live QA 2026-11-27): the "We got your request" email of an appeal opened /account/support?ticket=…, which a
// shop-owner member cannot use (portal notice, no request). The appeal receipt is its own email and opens the
// member's standing page (appeal state + decision), which every member can open whatever their account kind.
describe('SIM-F2: the appeal receipt email opens the standing page', () => {
  it('filing an appeal queues ustaad_appeal_received (not the generic ticket_received)', async () => {
    const who = await member();
    const p = await post(who, false);
    const r = await createUstaadReport(t(), viewer, {
      targetType: 'post',
      targetId: p.id,
      reasonCode: 'spam',
    });
    await actOnUstaadReport(t(), cmA, r.code, { action: 'remove', reasonCode: 'spam', version: 1 });
    await fileUstaadAppeal(
      t(),
      { userId: who.userId },
      { reportCode: r.code, note: 'It was a real job post.' },
    );
    const rows = await db
      .select({ key: s.notificationOutbox.templateKey, payload: s.notificationOutbox.payload })
      .from(s.notificationOutbox)
      .where(
        and(eq(s.notificationOutbox.recipientUserId, who.userId), eq(s.notificationOutbox.channel, 'email')),
      );
    const keys = rows.map((x) => x.key);
    expect(keys).toContain('ustaad_appeal_received');
    expect(keys).not.toContain('ticket_received');
    expect(EMAIL_TEMPLATES.ustaad_appeal_received.button?.({})).toBe('/ustaad/me/standing');
  });
});
