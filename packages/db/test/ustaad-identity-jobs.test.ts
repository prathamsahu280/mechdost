/**
 * Ustaad identity jobs and the non-partner owner link (spec 23 § 4 flow 2, § 6.9, § 9.2–9.3, SR-6, SR-9; plan tasks
 * B4, B5): counter reconcile with drift, rolling 30-day counters, stored qualified followers from follow changes
 * (test double for D2's events), badge awards (once; never after a staff revoke), the one-time owner link (single use,
 * same 404 for unknown/used/expired, GSTIN/Udyam + distance + quarter cap) and the evidence purge.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ustaadPublicCode } from '@mechdost/shared/ustaad/public-code';
import { loadKeyring } from '../src/crypto';
import {
  awardUstaadBadges,
  decideUstaadAttestByToken,
  giveUstaadVouch,
  revokeUstaadVerification,
  ustaadVoucherLostTrust,
  issueUstaadOwnerAttestLink,
  purgeUstaadAttestationEvidence,
  reconcileUstaadCounters,
  refreshUstaadCounters30d,
  refreshUstaadQualifiedFollowers,
  requestUstaadOwnerAttestation,
  requestUstaadVerification,
  saveUstaadSetting,
  syncRbacCatalogue,
  ustaadAttestPage,
  type Tx,
  type UstaadFollowChangeSource,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
const t = () => db as unknown as Tx;
const DAY = 86_400_000;
let seq = 0;
const ring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: randomBytes(32).toString('base64'),
});
const staffActor = () => ({ userId: f.staff, role: 'community_manager', cityIds: null });

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

interface Mk {
  level?: string;
  track?: 'apprentice' | 'ustaad';
  verified?: boolean;
  ageDays?: number;
  workshopId?: string | null;
  founding?: boolean;
}
async function mkMember(o: Mk = {}): Promise<{ userId: string; memberId: string }> {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  const [u] = await db
    .insert(s.users)
    .values({
      firebaseUid: `ustj-${n}`,
      phone: `+9198444${n.padStart(5, '0')}`,
      name: `J${n}`,
      createdAt: new Date(Date.now() - (o.ageDays ?? 120) * DAY),
    })
    .returning({ id: s.users.id });
  if (!u) throw new Error('user');
  const [m] = await db
    .insert(s.ustaadMembers)
    .values({
      userId: u.id,
      handle: `ustj_${n}`,
      displayName: `Mistri ${n}`,
      track: o.track ?? 'ustaad',
      level: o.level ?? (o.track === 'apprentice' ? 'apprentice' : 'naya'),
      verificationState: (o.verified ?? true) ? 'verified' : 'unverified',
      cityId: f.raipur,
      areaLabel: 'Pandri',
      pincode: '492001',
      workPlace: 'shop',
      workshopId: o.workshopId ?? null,
      founding: o.founding ?? false,
      createdBy: u.id,
    })
    .returning({ id: s.ustaadMembers.id });
  if (!m) throw new Error('member');
  await db.insert(s.ustaadMemberCounters).values({ memberId: m.id });
  return { userId: u.id, memberId: m.id };
}

async function counters(id: string) {
  const [c] = await db.select().from(s.ustaadMemberCounters).where(eq(s.ustaadMemberCounters.memberId, id));
  if (!c) throw new Error('missing');
  return c;
}

async function mkQuestion(askerId: string, over: { segmentCode?: string; workCode?: string } = {}) {
  const [q] = await db
    .insert(s.ustaadQuestions)
    .values({
      code: ustaadPublicCode('UQ', 'RPR'),
      askerId,
      cityId: f.raipur,
      title: 'Self not working',
      segmentCode: over.segmentCode ?? 'two_wheeler',
      workCode: over.workCode ?? 'battery',
      status: 'answered',
    })
    .returning();
  if (!q) throw new Error('question');
  return q;
}

async function mkAnswer(questionId: string, authorId: string) {
  const [a] = await db
    .insert(s.ustaadAnswers)
    .values({ questionId, authorId, body: 'Check the relay', countsForLevels: true })
    .returning();
  if (!a) throw new Error('answer');
  return a;
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  await db.insert(s.ustaadReachCities).values([{ cityId: f.raipur }]);
});

afterAll(async () => {
  await client.close();
});

describe('counter reconcile (§ 6.9)', () => {
  it('fixes injected drift from source rows, records it once, and a rerun finds nothing', async () => {
    const a = await mkMember();
    const b = await mkMember();
    const c = await mkMember();
    await db.insert(s.ustaadFollows).values([
      { followerId: b.memberId, followeeId: a.memberId },
      { followerId: c.memberId, followeeId: a.memberId },
    ]);
    const q = await mkQuestion(b.memberId);
    const ans = await mkAnswer(q.id, a.memberId);
    await db.insert(s.ustaadAnswerVotes).values({ answerId: ans.id, voterId: c.memberId });
    await db
      .update(s.ustaadMemberCounters)
      .set({ followers: 99, answers: 0, helpfulVotes: 7, izzat: 5 })
      .where(eq(s.ustaadMemberCounters.memberId, a.memberId));
    const first = await reconcileUstaadCounters(t());
    expect(first.drifted).toBeGreaterThanOrEqual(1);
    expect(await counters(a.memberId)).toMatchObject({
      followers: 2,
      answers: 1,
      helpfulVotes: 1,
      helpfulAnswers: 1,
      izzat: 0,
    });
    expect((await counters(b.memberId)).following).toBe(1);
    const drift = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, a.memberId), eq(s.ustaadEvents.kind, 'counter_drift')));
    expect(drift).toHaveLength(1);
    expect((await reconcileUstaadCounters(t())).drifted).toBe(0);
  });
});

describe('rolling 30-day counters', () => {
  it('counts best answers chosen and helpful votes in the last 30 days only', async () => {
    const author = await mkMember();
    const asker = await mkMember();
    const voter = await mkMember();
    const recent = await mkQuestion(asker.memberId);
    const old = await mkQuestion(asker.memberId);
    const a1 = await mkAnswer(recent.id, author.memberId);
    const a2 = await mkAnswer(old.id, author.memberId);
    await db
      .update(s.ustaadQuestions)
      .set({ status: 'solved', bestAnswerId: a1.id })
      .where(eq(s.ustaadQuestions.id, recent.id));
    await db
      .update(s.ustaadQuestions)
      .set({ status: 'solved', bestAnswerId: a2.id })
      .where(eq(s.ustaadQuestions.id, old.id));
    await db.insert(s.ustaadEvents).values([
      { entityType: 'question', entityId: recent.id, kind: 'best_chosen', actorRole: 'member' },
      {
        entityType: 'question',
        entityId: old.id,
        kind: 'best_chosen',
        actorRole: 'member',
        occurredAt: new Date(Date.now() - 40 * DAY),
      },
    ]);
    await db.insert(s.ustaadAnswerVotes).values([
      { answerId: a1.id, voterId: voter.memberId },
      { answerId: a2.id, voterId: voter.memberId, createdAt: new Date(Date.now() - 40 * DAY) },
    ]);
    await refreshUstaadCounters30d(t());
    expect(await counters(author.memberId)).toMatchObject({ bestAnswers30d: 1, helpful30d: 1 });
    expect(await refreshUstaadCounters30d(t())).toBe(0);
  });
});

describe('qualified followers (SR-9)', () => {
  it('stores the qualified count for members named by the follow-change source', async () => {
    const workshop = await db
      .insert(s.workshops)
      .values({
        cityId: f.raipur,
        slug: 'ustj-garage',
        name: 'Garage J',
        addressLine: 'GE Road',
        area: 'Pandri',
        pincode: '492001',
        location: { lng: 81.66, lat: 21.26 },
        vehicleTypes: ['2W'],
        hours: { open: '09:00', close: '19:00', days: [1] },
      })
      .returning({ id: s.workshops.id });
    const garage = workshop[0]?.id ?? null;
    const star = await mkMember({ workshopId: garage });
    const good = await mkMember();
    const young = await mkMember({ ageDays: 5 });
    const sameGarage = await mkMember({ workshopId: garage });
    const unverified = await mkMember({ verified: false });
    await db.insert(s.ustaadFollows).values(
      [good, young, sameGarage, unverified].map((x) => ({
        followerId: x.memberId,
        followeeId: star.memberId,
      })),
    );
    const calls: (Date | null)[] = [];
    const double: UstaadFollowChangeSource = {
      changedFollowees(_tx, since) {
        calls.push(since);
        return Promise.resolve({ memberIds: [star.memberId], until: new Date() });
      },
    };
    const { memberIds } = await double.changedFollowees(t(), null, 100);
    expect(await refreshUstaadQualifiedFollowers(t(), memberIds)).toBe(1);
    expect((await counters(star.memberId)).qualifiedFollowers).toBe(1);
    expect(await refreshUstaadQualifiedFollowers(t(), memberIds)).toBe(0);
    expect(calls).toEqual([null]);
  });
});

describe('badge awards (§ 9.3)', () => {
  it('awards first-answer and founding badges once, with a notice; a staff-revoked badge is not given again', async () => {
    const m = await mkMember({ founding: true });
    const asker = await mkMember({ track: 'apprentice' });
    const q = await mkQuestion(asker.memberId);
    await mkAnswer(q.id, m.memberId);
    const first = await awardUstaadBadges(t(), m.memberId);
    expect(first.sort()).toEqual(['founding_ustaad', 'pehla_jawab']);
    expect(await awardUstaadBadges(t(), m.memberId)).toEqual([]);
    const notices = await db
      .select()
      .from(s.notifications)
      .where(and(eq(s.notifications.userId, m.userId), eq(s.notifications.kind, 'ustaad.badge_earned')));
    expect(notices).toHaveLength(2);
    await db
      .update(s.ustaadBadgeAwards)
      .set({ revokedAt: new Date(), revokedReasonCode: 'staff_review' })
      .where(
        and(eq(s.ustaadBadgeAwards.memberId, m.memberId), eq(s.ustaadBadgeAwards.badgeCode, 'pehla_jawab')),
      );
    expect(await awardUstaadBadges(t(), m.memberId)).toEqual([]);
  });

  it('a best answer on battery questions counts toward the battery tag rule', async () => {
    await db
      .update(s.ustaadBadges)
      .set({ rule: { schema_version: 1, kind: 'best_answers_with_tag', tag: 'battery', count: 1 } })
      .where(eq(s.ustaadBadges.code, 'battery_expert'));
    const m = await mkMember();
    const asker = await mkMember();
    const q = await mkQuestion(asker.memberId, { workCode: 'battery' });
    const a = await mkAnswer(q.id, m.memberId);
    await db
      .update(s.ustaadQuestions)
      .set({ status: 'solved', bestAnswerId: a.id })
      .where(eq(s.ustaadQuestions.id, q.id));
    expect(await awardUstaadBadges(t(), m.memberId)).toContain('battery_expert');
  });
});

describe('non-partner owner link (SR-6)', () => {
  async function setup(opts: { pin?: boolean; phone?: string } = {}) {
    const m = await mkMember({ verified: false, level: 'ustaad_pending' });
    await requestUstaadVerification(t(), { userId: m.userId }, { proofs: ['owner'], requestedLevel: 'naya' });
    if (opts.pin !== false)
      await db.execute(
        sql.raw(
          `insert into ustaad_locations (member_id, location, accuracy_m, source, circle_center, zone_cell, use_for_verify)
         values ('${m.memberId}', 'SRID=4326;POINT(81.6296 21.2514)', 10, 'gps', 'SRID=4326;POINT(81.63 21.25)', 'hx:1:2', true)`,
        ),
      );
    const a = await requestUstaadOwnerAttestation(
      t(),
      ring,
      { userId: m.userId },
      {
        ownerPhone: opts.phone ?? '+919876500001',
        sinceYear: 2019,
      },
    );
    return { m, a };
  }
  const near = { lat: 21.2515, lng: 81.6297, accuracyM: 15 };
  const GSTIN = '22AAAAA0000A1Z5';

  it('the member never gets a token; staff issue one, the page shows no phone, POST consumes it once', async () => {
    const { m, a } = await setup();
    expect(JSON.stringify(a)).not.toContain('9876500001');
    const link = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: a.id });
    expect(link.ownerPhone).toBe('+919876500001');
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entityId, a.id), eq(s.auditLog.action, 'ustaad.attest_owner_phone_read')));
    expect(audit).toHaveLength(1);
    const page = await ustaadAttestPage(t(), link.token);
    expect(page).toMatchObject({ memberName: expect.stringMatching(/^Mistri/) as unknown, sinceYear: 2019 });
    expect(JSON.stringify(page)).not.toMatch(/\+91|memberId|userId/);
    // Opening the page twice does not use the link up.
    await ustaadAttestPage(t(), link.token);
    expect(
      await decideUstaadAttestByToken(t(), ring, link.token, {
        decision: 'confirmed',
        businessId: GSTIN,
        shop: near,
      }),
    ).toEqual({ outcome: 'received' });
    await expectCode(ustaadAttestPage(t(), link.token), 'NOT_FOUND');
    await expectCode(decideUstaadAttestByToken(t(), ring, link.token, { decision: 'declined' }), 'NOT_FOUND');
    const [v] = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, m.memberId));
    expect(v?.status).toBe('in_review');
    const [row] = await db.select().from(s.ustaadAttestations).where(eq(s.ustaadAttestations.id, a.id));
    expect(row).toMatchObject({ status: 'confirmed', tokenHash: null, ownerBusinessId: GSTIN });
    expect(row?.ownerDistanceM).toBeLessThan(50);
  });

  it('unknown, malformed and re-issued (old) tokens are the same 404', async () => {
    const { a } = await setup();
    const first = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: a.id });
    const second = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: a.id });
    await expectCode(ustaadAttestPage(t(), first.token), 'NOT_FOUND');
    await expectCode(ustaadAttestPage(t(), 'not-a-token'), 'NOT_FOUND');
    await expectCode(ustaadAttestPage(t(), randomBytes(32).toString('hex')), 'NOT_FOUND');
    expect((await ustaadAttestPage(t(), second.token)).sinceYear).toBe(2019);
  });

  it('a confirmation needs a GSTIN/Udyam number; a failed distance check looks the same to the caller and uses up the link (no location oracle)', async () => {
    const far = { lat: 21.27, lng: 81.65, accuracyM: 10 };
    const { a } = await setup();
    const { token } = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: a.id });
    await expectCode(
      decideUstaadAttestByToken(t(), ring, token, { decision: 'confirmed', businessId: 'ABC', shop: near }),
      'ATTEST_BUSINESS_ID',
    );
    expect(
      await decideUstaadAttestByToken(t(), ring, token, {
        decision: 'confirmed',
        businessId: GSTIN,
        shop: far,
      }),
    ).toEqual({ outcome: 'received' });
    let [row] = await db.select().from(s.ustaadAttestations).where(eq(s.ustaadAttestations.id, a.id));
    expect(row).toMatchObject({ status: 'requested', ownerDistanceFailures: 1 });
    expect(row?.ownerDistanceM).toBeGreaterThan(200);
    // The second failure (setting `verify.attest_distance_tries`, default 2) closes the link; staff decide.
    expect(
      await decideUstaadAttestByToken(t(), ring, token, {
        decision: 'confirmed',
        businessId: GSTIN,
        shop: far,
      }),
    ).toEqual({ outcome: 'received' });
    [row] = await db.select().from(s.ustaadAttestations).where(eq(s.ustaadAttestations.id, a.id));
    expect(row).toMatchObject({ status: 'requested', ownerDistanceFailures: 2, tokenHash: null });
    await expectCode(ustaadAttestPage(t(), token), 'NOT_FOUND');
    await expectCode(
      decideUstaadAttestByToken(t(), ring, token, { decision: 'confirmed', businessId: GSTIN, shop: near }),
      'NOT_FOUND',
    );
    // No pin the member allowed for verification: counted as a failed check, same answer.
    const { a: noPin } = await setup({ pin: false });
    const l2 = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: noPin.id });
    expect(
      await decideUstaadAttestByToken(t(), ring, l2.token, {
        decision: 'confirmed',
        businessId: GSTIN,
        shop: near,
      }),
    ).toEqual({ outcome: 'received' });
    const [np] = await db.select().from(s.ustaadAttestations).where(eq(s.ustaadAttestations.id, noPin.id));
    expect(np).toMatchObject({ status: 'requested', ownerDistanceFailures: 1, ownerDistanceM: null });
  });

  it('quarter cap per owner phone and per GSTIN/Udyam holds when two confirmations race; the member cannot name their own phone', async () => {
    await saveUstaadSetting(t(), {
      key: 'ustaad.verify.attest_per_owner_quarter',
      value: 1,
      expectedVersion: null,
      staffUserId: f.staff,
      actorRole: 'super_admin',
    });
    const phone = '+919876500077';
    const one = await setup({ phone });
    const two = await setup({ phone });
    const l1 = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: one.a.id });
    const l2 = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: two.a.id });
    const body = { decision: 'confirmed' as const, businessId: '22BBBBB1111B1Z5', shop: near };
    const results = await Promise.allSettled([
      decideUstaadAttestByToken(t(), ring, l1.token, body),
      decideUstaadAttestByToken(t(), ring, l2.token, body),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
      code: 'ATTEST_QUARTER_CAP',
    });
    // Another phone, the same business number: capped too.
    const three = await setup({ phone: '+919876500088' });
    const l3 = await issueUstaadOwnerAttestLink(t(), ring, staffActor(), { id: three.a.id });
    await expectCode(decideUstaadAttestByToken(t(), ring, l3.token, body), 'ATTEST_QUARTER_CAP');
    const self = await mkMember({ verified: false, level: 'ustaad_pending' });
    await requestUstaadVerification(
      t(),
      { userId: self.userId },
      { proofs: ['owner'], requestedLevel: 'naya' },
    );
    const [me] = await db.select({ phone: s.users.phone }).from(s.users).where(eq(s.users.id, self.userId));
    await expectCode(
      requestUstaadOwnerAttestation(
        t(),
        ring,
        { userId: self.userId },
        { ownerPhone: me?.phone ?? '', sinceYear: null },
      ),
      'SELF_ATTESTATION',
    );
  });

  it('evidence (phone, GSTIN) is purged after the retention; the keyed hash stays; recent rows are kept', async () => {
    const { a } = await setup();
    await db
      .update(s.ustaadAttestations)
      .set({
        status: 'declined',
        decidedAt: new Date(Date.now() - 40 * DAY),
        ownerBusinessId: '22AAAAA0000A1Z5',
      })
      .where(eq(s.ustaadAttestations.id, a.id));
    const n = await purgeUstaadAttestationEvidence(t());
    expect(n).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(s.ustaadAttestations).where(eq(s.ustaadAttestations.id, a.id));
    expect(row).toMatchObject({ ownerPhoneEnc: null, ownerBusinessId: null });
    expect(row?.ownerPhoneHash).not.toBeNull();
    expect(row?.evidencePurgedAt).not.toBeNull();
    expect(await purgeUstaadAttestationEvidence(t())).toBe(0);
  });
});

describe('voucher trust (security review 2026-11-26)', () => {
  async function garage(slug: string): Promise<string> {
    const [w] = await db
      .insert(s.workshops)
      .values({
        cityId: f.raipur,
        slug,
        name: `Garage ${slug}`,
        addressLine: 'GE Road',
        area: 'Pandri',
        pincode: '492001',
        location: { lng: 81.66, lat: 21.26 },
        vehicleTypes: ['2W'],
        hours: { open: '09:00', close: '19:00', days: [1] },
      })
      .returning({ id: s.workshops.id });
    if (!w) throw new Error('workshop');
    return w.id;
  }
  const soon = () => new Date(Date.now() + 5 * DAY);
  const given = (voucherId: string, voucheeId: string, verificationId: string) => ({
    voucherId,
    voucheeId,
    relation: 'known_work',
    status: 'given',
    verificationId,
    decidedAt: new Date(),
    expiresAt: soon(),
  });

  it('a Pakka voucher who is restricted or not verified cannot give a vouch (VOUCH_NOT_TRUSTED)', async () => {
    const vouchee = await mkMember({ verified: false, level: 'ustaad_pending' });
    const restricted = await mkMember({ level: 'pakka' });
    await db
      .update(s.ustaadMembers)
      .set({ status: 'restricted' })
      .where(eq(s.ustaadMembers.id, restricted.memberId));
    const unverified = await mkMember({ level: 'pakka', verified: false });
    for (const v of [restricted, unverified]) {
      const [row] = await db
        .insert(s.ustaadVouches)
        .values({
          voucherId: v.memberId,
          voucheeId: vouchee.memberId,
          relation: 'known_work',
          expiresAt: soon(),
        })
        .returning();
      if (!row) throw new Error('vouch');
      await expectCode(
        giveUstaadVouch(t(), { userId: v.userId }, { id: row.id, expectedVersion: row.version }),
        'VOUCH_NOT_TRUSTED',
      );
    }
  });

  it('revoking a voucher: open requests expire, given vouches stop counting, a vouch-verified member goes back to staff', async () => {
    const ga = await garage('ustj-va');
    const gb = await garage('ustj-vb');
    const v1 = await mkMember({ level: 'pakka', workshopId: ga });
    const v2 = await mkMember({ level: 'pakka', workshopId: gb });
    const e = await mkMember({ level: 'naya' });
    const x = await mkMember({ verified: false, level: 'ustaad_pending' });
    const [ev] = await db
      .insert(s.ustaadVerifications)
      .values({
        memberId: e.memberId,
        status: 'approved',
        grantedLevel: 'naya',
        proofKinds: ['vouch'],
        decidedBy: f.staff,
        decidedAt: new Date(),
      })
      .returning();
    if (!ev) throw new Error('verification');
    await db
      .insert(s.ustaadVouches)
      .values([
        given(v1.memberId, e.memberId, ev.id),
        given(v2.memberId, e.memberId, ev.id),
        { voucherId: v1.memberId, voucheeId: x.memberId, relation: 'known_work', expiresAt: soon() },
      ]);
    // v1's own verification, approved by another staff member, revoked by the fixture's staff member (four-eyes).
    const [other] = await db
      .insert(s.users)
      .values({ firebaseUid: 'ustj-staff-b', phone: '+919844499999', name: 'Ops B' })
      .returning({ id: s.users.id });
    const [v1v] = await db
      .insert(s.ustaadVerifications)
      .values({
        memberId: v1.memberId,
        status: 'approved',
        grantedLevel: 'pakka',
        requestedLevel: 'pakka',
        proofKinds: ['owner'],
        decidedBy: other?.id ?? null,
        decidedAt: new Date(),
      })
      .returning();
    if (!v1v) throw new Error('v1 verification');
    await revokeUstaadVerification(
      t(),
      { userId: f.staff },
      { id: v1v.id, expectedVersion: v1v.version, reasonCode: 'proofs_mismatch', note: null },
    );
    const v1Vouches = await db
      .select()
      .from(s.ustaadVouches)
      .where(eq(s.ustaadVouches.voucherId, v1.memberId));
    expect(v1Vouches.find((v) => v.voucheeId === x.memberId)?.status).toBe('expired');
    expect(v1Vouches.find((v) => v.voucheeId === e.memberId)).toMatchObject({
      status: 'revoked',
      revokedReasonCode: 'voucher_untrusted',
    });
    const eRows = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, e.memberId));
    expect(eRows.find((r) => r.status === 'in_review')).toMatchObject({ requestedLevel: 'naya' });
    const recheck = await db
      .select()
      .from(s.ustaadEvents)
      .where(
        and(eq(s.ustaadEvents.kind, 'recheck_queued'), eq(s.ustaadEvents.reasonCode, 'voucher_untrusted')),
      );
    expect(recheck.length).toBeGreaterThanOrEqual(1);
  });

  it('a ban (F calls the same function) leaves a member whose owner confirmed them untouched', async () => {
    const ga = await garage('ustj-vc');
    const banned = await mkMember({ level: 'pakka', workshopId: ga });
    const e = await mkMember({ level: 'naya' });
    const [ev] = await db
      .insert(s.ustaadVerifications)
      .values({
        memberId: e.memberId,
        status: 'approved',
        grantedLevel: 'naya',
        proofKinds: ['owner', 'vouch'],
        decidedBy: f.staff,
        decidedAt: new Date(),
      })
      .returning();
    if (!ev) throw new Error('verification');
    await db.insert(s.ustaadAttestations).values({
      verificationId: ev.id,
      memberId: e.memberId,
      workshopId: ga,
      status: 'confirmed',
      decidedAt: new Date(),
      expiresAt: soon(),
    });
    await db.insert(s.ustaadVouches).values(given(banned.memberId, e.memberId, ev.id));
    expect(await ustaadVoucherLostTrust(t(), banned.memberId, 'banned', f.staff)).toEqual([]);
    const rows = await db
      .select()
      .from(s.ustaadVerifications)
      .where(
        and(eq(s.ustaadVerifications.memberId, e.memberId), eq(s.ustaadVerifications.status, 'in_review')),
      );
    expect(rows).toHaveLength(0);
  });
});
