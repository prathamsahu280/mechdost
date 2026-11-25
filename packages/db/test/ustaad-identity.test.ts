/**
 * Ustaad identity repositories (spec 23 § 4 flow 2, § 7.1–7.3, § 9, § 14; plan tasks B2, B4, B5): Izzat ledger,
 * level recompute (qualified followers, staff review for Bada/Master), verification with staff final approval (CAS,
 * self-approval and four-eyes), vouches (SR-7), partner-workshop attestations (SR-6, foreign id 404), ring detection
 * (SR-10) and tutorial progress.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  approveUstaadVerification,
  confirmUstaadAttestation,
  decideUstaadVouch,
  getUstaadOnboarding,
  giveUstaadVouch,
  listUstaadAttestationsForWorkshops,
  listUstaadVerifications,
  recomputeUstaadLevel,
  recordIzzat,
  rejectUstaadVerification,
  requestUstaadAttestation,
  requestUstaadVerification,
  requestUstaadVouch,
  resetUstaadOnboarding,
  revokeUstaadVerification,
  runUstaadRingDetect,
  saveUstaadOnboarding,
  syncRbacCatalogue,
  ustaadVerificationStatus,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';
import { seedServiceFixture, type Fixture } from './service-fixture';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
let f: Fixture;
let staff2: string;
let workshopA: string;
let workshopB: string;
const t = () => db as unknown as Tx;
const DAY = 86_400_000;
let seq = 0;

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

interface Mk {
  level?: string;
  track?: 'apprentice' | 'ustaad';
  verified?: boolean;
  ageDays?: number;
  workshopId?: string | null;
  verifiedYears?: number;
}
async function mkMember(o: Mk = {}): Promise<{ userId: string; memberId: string }> {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  const created = new Date(Date.now() - (o.ageDays ?? 120) * DAY);
  const [u] = await db
    .insert(s.users)
    .values({
      firebaseUid: `ustb-${n}`,
      phone: `+9198222${n.padStart(5, '0')}`,
      name: `M${n}`,
      createdAt: created,
    })
    .returning({ id: s.users.id });
  if (!u) throw new Error('user');
  const [m] = await db
    .insert(s.ustaadMembers)
    .values({
      userId: u.id,
      handle: `ustb_${n}`,
      displayName: `Mistri ${n}`,
      track: o.track ?? 'ustaad',
      level: o.level ?? 'naya',
      verificationState: (o.verified ?? true) ? 'verified' : 'unverified',
      cityId: f.raipur,
      areaLabel: 'Pandri',
      pincode: '492001',
      workPlace: 'shop',
      workshopId: o.workshopId ?? null,
      yearsClaimed: 5,
      verifiedYears: o.verifiedYears ?? null,
      createdBy: u.id,
    })
    .returning({ id: s.ustaadMembers.id });
  if (!m) throw new Error('member');
  await db.insert(s.ustaadMemberCounters).values({ memberId: m.id });
  await db.insert(s.ustaadMemberOnboarding).values({ memberId: m.id });
  return { userId: u.id, memberId: m.id };
}

async function memberRow(id: string) {
  const [m] = await db.select().from(s.ustaadMembers).where(eq(s.ustaadMembers.id, id));
  if (!m) throw new Error('missing');
  return m;
}
async function counters(id: string) {
  const [c] = await db.select().from(s.ustaadMemberCounters).where(eq(s.ustaadMemberCounters.memberId, id));
  if (!c) throw new Error('missing');
  return c;
}

async function mkWorkshop(slug: string): Promise<string> {
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

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await syncRbacCatalogue(t());
  f = await seedServiceFixture(db);
  const [u] = await db
    .insert(s.users)
    .values({ firebaseUid: 'ustb-staff2', phone: '+919822299999', name: 'Ops 2' })
    .returning({ id: s.users.id });
  if (!u) throw new Error('staff2');
  staff2 = u.id;
  workshopA = await mkWorkshop('ustb-a');
  workshopB = await mkWorkshop('ustb-b');
});

afterAll(async () => {
  await client.close();
});

describe('Izzat ledger (§ 9.1)', () => {
  it('writes the setting points once per idem key and bumps the counter; a replay writes nothing', async () => {
    const m = await mkMember();
    const input = {
      memberId: m.memberId,
      reason: 'best_answer' as const,
      source: { type: 'answer', id: null },
      idemKey: `best:${m.memberId}`,
    };
    expect(await recordIzzat(t(), { userId: null }, input)).toBe(10);
    expect(await recordIzzat(t(), { userId: null }, input)).toBe(0);
    expect((await counters(m.memberId)).izzat).toBe(10);
  });

  it('video_completed is 0 by default → no ledger row; a reversal writes a negative row', async () => {
    const m = await mkMember();
    expect(
      await recordIzzat(
        t(),
        { userId: null },
        {
          memberId: m.memberId,
          reason: 'video_completed',
          source: { type: 'learning_resource', id: null },
          idemKey: `video:${m.memberId}`,
        },
      ),
    ).toBe(0);
    expect(
      await recordIzzat(
        t(),
        { userId: null },
        {
          memberId: m.memberId,
          reason: 'reversal',
          delta: -1,
          source: { type: 'follow', id: null },
          idemKey: `unfollow:${m.memberId}`,
        },
      ),
    ).toBe(-1);
    const rows = await db
      .select()
      .from(s.ustaadIzzatLedger)
      .where(eq(s.ustaadIzzatLedger.memberId, m.memberId));
    expect(rows.map((r) => r.reasonCode)).toEqual(['reversal']);
    expect((await counters(m.memberId)).izzat).toBe(-1);
  });
});

async function follow(followerId: string, followeeId: string, at = new Date()) {
  await db.insert(s.ustaadFollows).values({ followerId, followeeId, createdAt: at });
}

describe('level recompute (§ 9.2, SR-8, SR-9)', () => {
  it('AT-LEVEL-1: followers from young or same-garage accounts are not qualified → no Pakka', async () => {
    const star = await mkMember({ workshopId: workshopA });
    await db
      .update(s.ustaadMemberCounters)
      .set({ followers: 6, bestAnswers: 30 })
      .where(eq(s.ustaadMemberCounters.memberId, star.memberId));
    for (let i = 0; i < 3; i += 1) await follow((await mkMember({ ageDays: 5 })).memberId, star.memberId);
    for (let i = 0; i < 3; i += 1)
      await follow((await mkMember({ workshopId: workshopA })).memberId, star.memberId);
    const r = await recomputeUstaadLevel(t(), star.memberId);
    expect(r).toEqual({ level: 'naya', reviewQueued: false });
  });

  it('enough qualified followers + best answers → Pakka, with a level event; Bada queues a staff review instead', async () => {
    const rules = await db.select().from(s.ustaadLevelRules);
    expect(rules).toHaveLength(0); // the engine falls back to the founder's demo rules
    // Lower Pakka to 2 followers for the test through the admin table.
    await db.insert(s.ustaadLevelRules).values([
      {
        level: 'naya',
        ruleGroup: 'A',
        minVerifiedYears: 3,
        nameEn: 'Naya Ustaad',
        nameHi: 'नया उस्ताद',
        position: 2,
      },
      {
        level: 'pakka',
        ruleGroup: 'A',
        minFollowers: 2,
        minBestAnswers: 1,
        nameEn: 'Pakka',
        nameHi: 'पक्का',
        position: 3,
      },
      {
        level: 'bada',
        ruleGroup: 'A',
        minFollowers: 2,
        minBestAnswers: 1,
        needsStaffReview: true,
        nameEn: 'Bada',
        nameHi: 'बड़ा',
        position: 4,
      },
    ]);
    const star = await mkMember();
    await db
      .update(s.ustaadMemberCounters)
      .set({ bestAnswers: 1 })
      .where(eq(s.ustaadMemberCounters.memberId, star.memberId));
    await follow((await mkMember()).memberId, star.memberId);
    await follow((await mkMember()).memberId, star.memberId);
    const r = await recomputeUstaadLevel(t(), star.memberId);
    expect(r).toEqual({ level: 'pakka', reviewQueued: true });
    expect((await memberRow(star.memberId)).level).toBe('pakka');
    const [review] = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, star.memberId));
    expect(review).toMatchObject({ requestedLevel: 'bada', status: 'in_review' });
    // A second recompute never duplicates the review (one open per member).
    expect(await recomputeUstaadLevel(t(), star.memberId)).toEqual({ level: 'pakka', reviewQueued: true });
    await db.delete(s.ustaadLevelRules);
  });

  it('a Chhotu who meets Naya without a verification gets a verification request, not a promotion', async () => {
    const c = await mkMember({ level: 'apprentice', track: 'apprentice', verified: false, verifiedYears: 5 });
    expect(await recomputeUstaadLevel(t(), c.memberId)).toEqual({ level: 'apprentice', reviewQueued: false });
    const rows = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, c.memberId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestedLevel: 'naya', status: 'requested' });
  });
});

describe('verification with staff final approval (§ 7.1, SR-8)', () => {
  it('request → staff approve (pulls in) → verified + Naya; a double approve with the old version → 409', async () => {
    const m = await mkMember({ level: 'ustaad_pending', verified: false });
    const v = await requestUstaadVerification(
      t(),
      { userId: m.userId },
      { proofs: ['owner'], requestedLevel: 'naya' },
    );
    expect(v.status).toBe('requested');
    await expectCode(
      requestUstaadVerification(t(), { userId: m.userId }, { proofs: ['owner'], requestedLevel: 'naya' }),
      'USTAAD_VERIFICATION_OPEN',
    );
    const listed = await listUstaadVerifications(t(), { status: 'requested', cityIds: null });
    expect(listed.items.some((x) => x.id === v.id)).toBe(true);
    const ok = await approveUstaadVerification(
      t(),
      { userId: f.staff },
      {
        id: v.id,
        expectedVersion: v.version,
        grantedLevel: 'naya',
      },
    );
    expect(ok.status).toBe('approved');
    const row = await memberRow(m.memberId);
    expect(row).toMatchObject({ verificationState: 'verified', level: 'naya' });
    expect(row.verifiedAt).not.toBeNull();
    await expectCode(
      approveUstaadVerification(
        t(),
        { userId: f.staff },
        { id: v.id, expectedVersion: v.version, grantedLevel: 'naya' },
      ),
      'STALE_VERIFICATION',
    );
    const audit = await db
      .select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.entity, 'ustaad_verification'), eq(s.auditLog.entityId, v.id)));
    expect(audit.map((a) => a.action)).toContain('ustaad.verification.approved');
    expect(await ustaadVerificationStatus(t(), { userId: m.userId })).toMatchObject({ status: 'approved' });
  });

  it('granted level above the requested level is refused; staff cannot approve their own request', async () => {
    const m = await mkMember({ level: 'ustaad_pending', verified: false });
    const v = await requestUstaadVerification(
      t(),
      { userId: m.userId },
      { proofs: ['vouch'], requestedLevel: 'naya' },
    );
    await expectCode(
      approveUstaadVerification(
        t(),
        { userId: f.staff },
        { id: v.id, expectedVersion: v.version, grantedLevel: 'pakka' },
      ),
      'USTAAD_LEVEL_ABOVE_REQUEST',
    );
    await expectCode(
      approveUstaadVerification(
        t(),
        { userId: m.userId },
        { id: v.id, expectedVersion: v.version, grantedLevel: 'naya' },
      ),
      'SELF_MODERATION',
    );
    const r = await rejectUstaadVerification(
      t(),
      { userId: f.staff },
      {
        id: v.id,
        expectedVersion: v.version,
        reasonCode: 'proofs_mismatch',
        note: null,
      },
    );
    expect(r.status).toBe('rejected');
  });

  it('approving flips counts_for_levels on earlier answers with an idempotent Izzat back-fill', async () => {
    const asker = await mkMember();
    const m = await mkMember({ level: 'ustaad_pending', verified: false });
    const [q] = await db
      .insert(s.ustaadQuestions)
      .values({
        code: 'UQ-RPR-2026-BFILLA',
        askerId: asker.memberId,
        cityId: f.raipur,
        title: 'Splendor start nahi ho rahi',
      })
      .returning({ id: s.ustaadQuestions.id });
    if (!q) throw new Error('q');
    await db
      .insert(s.ustaadAnswers)
      .values({ questionId: q.id, authorId: m.memberId, body: 'Plug check karo' });
    // Security review 2026-11-26: a removed answer never starts counting and earns nothing.
    await db
      .insert(s.ustaadAnswers)
      .values({ questionId: q.id, authorId: m.memberId, body: 'Spam', status: 'removed' });
    const v = await requestUstaadVerification(
      t(),
      { userId: m.userId },
      { proofs: ['owner'], requestedLevel: 'naya' },
    );
    await approveUstaadVerification(
      t(),
      { userId: f.staff },
      { id: v.id, expectedVersion: v.version, grantedLevel: 'naya' },
    );
    const answers = await db.select().from(s.ustaadAnswers).where(eq(s.ustaadAnswers.authorId, m.memberId));
    expect(answers.filter((a) => a.countsForLevels).map((a) => a.status)).toEqual(['visible']);
    expect((await counters(m.memberId)).izzat).toBe(2);
  });

  it('revoke needs a second staff member (four-eyes)', async () => {
    const m = await mkMember({ level: 'ustaad_pending', verified: false });
    const v = await requestUstaadVerification(
      t(),
      { userId: m.userId },
      { proofs: ['owner'], requestedLevel: 'naya' },
    );
    const a = await approveUstaadVerification(
      t(),
      { userId: f.staff },
      {
        id: v.id,
        expectedVersion: v.version,
        grantedLevel: 'naya',
      },
    );
    await expectCode(
      revokeUstaadVerification(
        t(),
        { userId: f.staff },
        { id: v.id, expectedVersion: a.version, reasonCode: 'other', note: 'x' },
      ),
      'FOUR_EYES',
    );
    const r = await revokeUstaadVerification(
      t(),
      { userId: staff2 },
      {
        id: v.id,
        expectedVersion: a.version,
        reasonCode: 'duplicate_account',
        note: null,
      },
    );
    expect(r.status).toBe('revoked');
    expect((await memberRow(m.memberId)).verificationState).toBe('revoked');
  });
});

describe('vouches (SR-7)', () => {
  it('a Naya or a young account cannot vouch; two Pakka vouchers from two garages move the request to review', async () => {
    const vouchee = await mkMember({ level: 'ustaad_pending', verified: false });
    await requestUstaadVerification(
      t(),
      { userId: vouchee.userId },
      { proofs: ['vouch'], requestedLevel: 'naya' },
    );
    const naya = await mkMember({ level: 'naya' });
    const young = await mkMember({ level: 'pakka', ageDays: 20 });
    const p1 = await mkMember({ level: 'pakka', workshopId: workshopA });
    const p2 = await mkMember({ level: 'pakka', workshopId: workshopB });

    const ask = (voucher: string) =>
      requestUstaadVouch(
        t(),
        { userId: vouchee.userId },
        { voucherId: voucher, relation: 'worked_together' },
      );
    const v0 = await ask(naya.memberId);
    await expectCode(
      giveUstaadVouch(t(), { userId: naya.userId }, { id: v0.id, expectedVersion: v0.version }),
      'VOUCH_LEVEL',
    );
    const v1 = await ask(young.memberId);
    await expectCode(
      giveUstaadVouch(t(), { userId: young.userId }, { id: v1.id, expectedVersion: v1.version }),
      'VOUCH_ACCOUNT_AGE',
    );
    // Somebody else cannot give a vouch addressed to p1 (404).
    const v2 = await ask(p1.memberId);
    await expectCode(
      giveUstaadVouch(t(), { userId: p2.userId }, { id: v2.id, expectedVersion: v2.version }),
      'NOT_FOUND',
    );
    await giveUstaadVouch(t(), { userId: p1.userId }, { id: v2.id, expectedVersion: v2.version });
    expect((await ustaadVerificationStatus(t(), { userId: vouchee.userId }))?.status).toBe('requested');
    const v3 = await ask(p2.memberId);
    await giveUstaadVouch(t(), { userId: p2.userId }, { id: v3.id, expectedVersion: v3.version });
    expect((await ustaadVerificationStatus(t(), { userId: vouchee.userId }))?.status).toBe('in_review');
    expect((await counters(vouchee.memberId)).recommendations).toBe(2);
  });

  it('reciprocal vouches are refused', async () => {
    const a = await mkMember({ level: 'pakka' });
    const b = await mkMember({ level: 'pakka' });
    const ab = await requestUstaadVouch(
      t(),
      { userId: b.userId },
      { voucherId: a.memberId, relation: 'known_work' },
    );
    await giveUstaadVouch(t(), { userId: a.userId }, { id: ab.id, expectedVersion: ab.version });
    const ba = await requestUstaadVouch(
      t(),
      { userId: a.userId },
      { voucherId: b.memberId, relation: 'known_work' },
    );
    await expectCode(
      giveUstaadVouch(t(), { userId: b.userId }, { id: ba.id, expectedVersion: ba.version }),
      'VOUCH_RECIPROCAL',
    );
  });

  // Security review 2026-11-26 (MEDIUM): revoking must not reset the monthly cap or the reciprocity check.
  it('a revoked vouch still counts for the monthly cap and for reciprocity', async () => {
    const voucher = await mkMember({ level: 'pakka' });
    const others = [await mkMember(), await mkMember(), await mkMember(), await mkMember()];
    for (const o of others.slice(0, 3)) {
      const v = await requestUstaadVouch(
        t(),
        { userId: o.userId },
        { voucherId: voucher.memberId, relation: 'known_work' },
      );
      const g = await giveUstaadVouch(
        t(),
        { userId: voucher.userId },
        { id: v.id, expectedVersion: v.version },
      );
      await decideUstaadVouch(
        t(),
        { userId: voucher.userId },
        { id: g.id, expectedVersion: g.version, to: 'revoked', reasonCode: 'mistake' },
      );
    }
    const fourth = others[3];
    if (!fourth) throw new Error('seed');
    const v4 = await requestUstaadVouch(
      t(),
      { userId: fourth.userId },
      { voucherId: voucher.memberId, relation: 'known_work' },
    );
    await expectCode(
      giveUstaadVouch(t(), { userId: voucher.userId }, { id: v4.id, expectedVersion: v4.version }),
      'VOUCH_MONTHLY_CAP',
    );

    const a = await mkMember({ level: 'pakka' });
    const b = await mkMember({ level: 'pakka' });
    const ab = await requestUstaadVouch(
      t(),
      { userId: b.userId },
      { voucherId: a.memberId, relation: 'known_work' },
    );
    const g = await giveUstaadVouch(t(), { userId: a.userId }, { id: ab.id, expectedVersion: ab.version });
    await decideUstaadVouch(
      t(),
      { userId: a.userId },
      { id: g.id, expectedVersion: g.version, to: 'revoked', reasonCode: 'mistake' },
    );
    const ba = await requestUstaadVouch(
      t(),
      { userId: a.userId },
      { voucherId: b.memberId, relation: 'known_work' },
    );
    await expectCode(
      giveUstaadVouch(t(), { userId: b.userId }, { id: ba.id, expectedVersion: ba.version }),
      'VOUCH_RECIPROCAL',
    );
  });

  it('an expired vouch request cannot be given', async () => {
    const vouchee = await mkMember();
    const voucher = await mkMember({ level: 'pakka' });
    const v = await requestUstaadVouch(
      t(),
      { userId: vouchee.userId },
      { voucherId: voucher.memberId, relation: 'known_work' },
    );
    await db
      .update(s.ustaadVouches)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(s.ustaadVouches.id, v.id));
    const [row] = await db.select().from(s.ustaadVouches).where(eq(s.ustaadVouches.id, v.id));
    await expectCode(
      giveUstaadVouch(t(), { userId: voucher.userId }, { id: v.id, expectedVersion: row?.version ?? 0 }),
      'VOUCH_EXPIRED',
    );
  });

  it('revoking a vouch that completed the evidence flags the request for staff', async () => {
    const vouchee = await mkMember({ level: 'ustaad_pending', verified: false });
    await requestUstaadVerification(
      t(),
      { userId: vouchee.userId },
      { proofs: ['vouch'], requestedLevel: 'naya' },
    );
    const p1 = await mkMember({ level: 'pakka', workshopId: workshopA });
    const p2 = await mkMember({ level: 'pakka', workshopId: workshopB });
    const given = [];
    for (const p of [p1, p2]) {
      const v = await requestUstaadVouch(
        t(),
        { userId: vouchee.userId },
        { voucherId: p.memberId, relation: 'worked_together' },
      );
      given.push(await giveUstaadVouch(t(), { userId: p.userId }, { id: v.id, expectedVersion: v.version }));
    }
    const status = await ustaadVerificationStatus(t(), { userId: vouchee.userId });
    expect(status?.status).toBe('in_review');
    const g = given[0];
    if (!g || !status) throw new Error('seed');
    await decideUstaadVouch(
      t(),
      { userId: p1.userId },
      { id: g.id, expectedVersion: g.version, to: 'revoked', reasonCode: 'no_longer_know' },
    );
    const flags = await db
      .select()
      .from(s.ustaadEvents)
      .where(and(eq(s.ustaadEvents.entityId, status.id), eq(s.ustaadEvents.kind, 'evidence_withdrawn')));
    expect(flags).toHaveLength(1);
    expect(await ustaadVerificationStatus(t(), { userId: vouchee.userId })).toMatchObject({
      vouchesGiven: 1,
    });
  });
});

describe('attestations from a MechDost workshop (SR-6)', () => {
  it('only that workshop sees and confirms it (foreign id 404); confirming moves the request to review', async () => {
    const m = await mkMember({ level: 'ustaad_pending', verified: false });
    await requestUstaadVerification(t(), { userId: m.userId }, { proofs: ['owner'], requestedLevel: 'naya' });
    const a = await requestUstaadAttestation(
      t(),
      { userId: m.userId },
      { workshopId: workshopA, sinceYear: 2020 },
    );
    expect((await listUstaadAttestationsForWorkshops(t(), [workshopB])).length).toBe(0);
    const mine = await listUstaadAttestationsForWorkshops(t(), [workshopA]);
    expect(mine.map((x) => x.id)).toContain(a.id);
    expect(JSON.stringify(mine)).not.toContain('+91');
    await expectCode(
      confirmUstaadAttestation(
        t(),
        { userId: f.other, workshopIds: [workshopB] },
        {
          id: a.id,
          expectedVersion: a.version,
          decision: 'confirmed',
        },
      ),
      'NOT_FOUND',
    );
    await confirmUstaadAttestation(
      t(),
      { userId: f.other, workshopIds: [workshopA] },
      {
        id: a.id,
        expectedVersion: a.version,
        decision: 'confirmed',
      },
    );
    expect((await ustaadVerificationStatus(t(), { userId: m.userId }))?.status).toBe('in_review');
    expect((await memberRow(m.memberId)).workshopId).toBe(workshopA);
  });

  // Security review 2026-11-26 (MEDIUM): nobody attests for themselves (SR-6).
  it('an owner or staff member of the workshop cannot ask it to confirm them, nor confirm themselves', async () => {
    const owner = await mkMember({ level: 'ustaad_pending', verified: false });
    await db.insert(s.userRoles).values({
      userId: owner.userId,
      roleId:
        (await db.select({ id: s.roles.id }).from(s.roles).where(eq(s.roles.key, 'workshop_owner')))[0]?.id ??
        '',
      workshopId: workshopB,
    });
    await requestUstaadVerification(
      t(),
      { userId: owner.userId },
      { proofs: ['owner'], requestedLevel: 'naya' },
    );
    await expectCode(
      requestUstaadAttestation(t(), { userId: owner.userId }, { workshopId: workshopB, sinceYear: null }),
      'SELF_ATTESTATION',
    );
    // A row created some other way is still refused at confirm time.
    const [open] = await db
      .select()
      .from(s.ustaadVerifications)
      .where(eq(s.ustaadVerifications.memberId, owner.memberId));
    if (!open) throw new Error('seed');
    const [a] = await db
      .insert(s.ustaadAttestations)
      .values({
        verificationId: open.id,
        memberId: owner.memberId,
        workshopId: workshopB,
        expiresAt: new Date(Date.now() + DAY),
      })
      .returning();
    if (!a) throw new Error('seed');
    await expectCode(
      confirmUstaadAttestation(
        t(),
        { userId: owner.userId, workshopIds: [workshopB] },
        { id: a.id, expectedVersion: a.version, decision: 'confirmed' },
      ),
      'SELF_ATTESTATION',
    );
  });
});

describe('ring detection (§ 14, SR-10, AT-VOUCH-1)', () => {
  it('a dense mutual-follow cluster has its follows marked not counted and the members flagged', async () => {
    const ring = [await mkMember(), await mkMember(), await mkMember(), await mkMember()];
    const now = new Date();
    for (const x of ring) for (const y of ring) if (x !== y) await follow(x.memberId, y.memberId, now);
    const r = await runUstaadRingDetect(t(), new Date(now.getTime() + 1000));
    expect(r.flagged).toBeGreaterThanOrEqual(4);
    const rows = await db
      .select()
      .from(s.ustaadFollows)
      .where(eq(s.ustaadFollows.followeeId, ring[0]?.memberId ?? ''));
    expect(rows.every((x) => !x.counted)).toBe(true);
    const flags = await db
      .select()
      .from(s.ustaadEvents)
      .where(
        and(eq(s.ustaadEvents.kind, 'ring_flagged'), eq(s.ustaadEvents.entityId, ring[0]?.memberId ?? '')),
      );
    expect(flags).toHaveLength(1);
    // A second run does not flag the same members again (their follows no longer count).
    const again = await runUstaadRingDetect(t(), new Date(now.getTime() + 2000));
    expect(again.flagged).toBe(0);
  });
});

describe('tutorial progress (flow 15)', () => {
  it('records the last card, skip, completion and coach-marks; reset clears them', async () => {
    const m = await mkMember();
    await saveUstaadOnboarding(t(), { userId: m.userId }, { event: 'card', card: 2 });
    await saveUstaadOnboarding(t(), { userId: m.userId }, { event: 'skipped', card: 3 });
    await saveUstaadOnboarding(t(), { userId: m.userId }, { event: 'coachmark', target: 'mic' });
    await saveUstaadOnboarding(t(), { userId: m.userId }, { event: 'coachmark', target: 'mic' });
    let o = await getUstaadOnboarding(t(), { userId: m.userId });
    expect(o).toMatchObject({ lastCard: 3, coachmarksSeen: ['mic'], completed: false, skipped: true });
    await saveUstaadOnboarding(t(), { userId: m.userId }, { event: 'completed', card: 6 });
    o = await getUstaadOnboarding(t(), { userId: m.userId });
    expect(o.completed).toBe(true);
    await resetUstaadOnboarding(t(), { userId: m.userId });
    o = await getUstaadOnboarding(t(), { userId: m.userId });
    expect(o).toMatchObject({ lastCard: null, coachmarksSeen: [], completed: false, skipped: false });
  });
});
