/**
 * Ustaad verification (spec 23 § 4 flow 2, § 7.1–7.2, SR-6–SR-8; plan task B4): requests, vouches, partner-workshop
 * attestations and the staff decision. Staff final approval is locked on: only a staff member (`ustaad:verify`, checked
 * in the API) moves a request to `approved`, writing `decided_by` (the DB CHECK refuses an approval without it), an
 * `audit_log` row and an `ustaad_events` row in one transaction. Every move is `machine.assert` + a conditional
 * UPDATE on (id, status, version). Bada/Master level reviews ride on the same table (`requested_level` bada/master).
 *
 * Not built yet (report): the non-partner owner path (one-time token link, GSTIN/Udyam + shop photo ≤ 200 m, public
 * attest page) and the evidence-retention purge. `attestationRefusal()` already encodes the SR-6 rules for it.
 */
import { and, count, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import {
  ustaadAttestationMachine,
  ustaadLevelMachine,
  ustaadVerificationMachine,
  ustaadVouchMachine,
  type UstaadVerificationStatus,
} from '@mechdost/shared/state';
import type { UstaadLevel } from '@mechdost/shared/ustaad/codes';
import type {
  AttestationView,
  RejectVerification,
  RequestVerification,
  VerificationQueueItem,
  VerificationView,
  VouchView,
} from '@mechdost/shared/ustaad/dto/verification';
import { EARNED_LEVELS, levelAtLeast, levelRank } from '@mechdost/shared/ustaad/levels';
import { attestationRefusal, vouchesSufficient, vouchRefusal } from '@mechdost/shared/ustaad/verify';
import {
  auditLog,
  cities,
  users,
  ustaadAnswers,
  ustaadAttestations,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadVerifications,
  ustaadVouches,
  workshops,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import { recordIzzat } from './izzat';
import { recomputeUstaadLevel } from './levels';
import { notifyUstaad } from './notify';
import { readUstaadSettingValues } from './settings';

type VerificationRow = typeof ustaadVerifications.$inferSelect;
type MemberRow = typeof ustaadMembers.$inferSelect;

const DAY_MS = 86_400_000;
const ATTEST_TTL_MS = 7 * DAY_MS;
const VOUCH_TTL_MS = 14 * DAY_MS;

async function activeMemberOfUser(tx: Tx, userId: string): Promise<MemberRow> {
  const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.userId, userId)).limit(1);
  if (!m || m.status === 'left') throw new NotFoundError('Not a member');
  if (m.status === 'banned') throw new ForbiddenError('This account cannot use the network', 'USTAAD_BANNED');
  return m;
}

async function openVerification(tx: Tx, memberId: string): Promise<VerificationRow | undefined> {
  const [v] = await tx
    .select()
    .from(ustaadVerifications)
    .where(
      and(
        eq(ustaadVerifications.memberId, memberId),
        inArray(ustaadVerifications.status, ['requested', 'in_review']),
      ),
    )
    .limit(1);
  return v;
}

async function viewOf(tx: Tx, v: VerificationRow): Promise<VerificationView> {
  const s = await readUstaadSettingValues(tx, ['ustaad.verify.vouches_needed']);
  const [att] = await tx
    .select({ status: ustaadAttestations.status })
    .from(ustaadAttestations)
    .where(eq(ustaadAttestations.verificationId, v.id))
    .orderBy(desc(ustaadAttestations.createdAt))
    .limit(1);
  const [given] = await tx
    .select({ n: count() })
    .from(ustaadVouches)
    .where(and(eq(ustaadVouches.verificationId, v.id), eq(ustaadVouches.status, 'given')));
  return {
    id: v.id,
    memberId: v.memberId,
    requestedLevel: v.requestedLevel as VerificationView['requestedLevel'],
    grantedLevel: v.grantedLevel as VerificationView['grantedLevel'],
    status: v.status as VerificationView['status'],
    proofKinds: v.proofKinds as VerificationView['proofKinds'],
    reasonCode: v.reasonCode as VerificationView['reasonCode'],
    attestation: (att?.status ?? null) as VerificationView['attestation'],
    vouchesGiven: given?.n ?? 0,
    vouchesNeeded: Number(s['ustaad.verify.vouches_needed']),
    createdAt: v.createdAt.toISOString(),
    decidedAt: v.decidedAt?.toISOString() ?? null,
    version: v.version,
  };
}

/** Member: open a verification request (Get verified). One open request per member (partial unique index). */
export async function requestUstaadVerification(
  db: Tx,
  actor: { userId: string },
  input: RequestVerification,
): Promise<VerificationView> {
  return db.transaction(async (tx) => {
    const m = await activeMemberOfUser(tx, actor.userId);
    const s = await readUstaadSettingValues(tx, [
      'ustaad.verify.owner_enabled',
      'ustaad.verify.vouch_enabled',
      'ustaad.verify.certificate_enabled',
    ]);
    const on = {
      owner: s['ustaad.verify.owner_enabled'],
      vouch: s['ustaad.verify.vouch_enabled'],
      certificate: s['ustaad.verify.certificate_enabled'],
    };
    for (const p of input.proofs)
      if (on[p] !== true) throw new ValidationError(`The ${p} proof is not available`, 'USTAAD_METHOD_OFF');
    const [row] = await tx
      .insert(ustaadVerifications)
      .values({
        memberId: m.id,
        requestedLevel: input.requestedLevel,
        proofKinds: [...new Set(input.proofs)],
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('You already have an open request', 'USTAAD_VERIFICATION_OPEN');
    if (m.verificationState === 'unverified')
      await tx
        .update(ustaadMembers)
        .set({ verificationState: 'pending_verification' })
        .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.verificationState, 'unverified')));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'verification',
        entityId: row.id,
        kind: 'requested',
        toStatus: 'requested',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: m.cityId,
        props: { proofs: row.proofKinds, level: row.requestedLevel },
      },
      {
        name: 'ustaad_verification_requested',
        memberId: m.id,
        userId: actor.userId,
        props: { memberId: m.id, proofs: [...new Set(input.proofs)] },
      },
    );
    return viewOf(tx, row);
  });
}

/** Member: withdraw the open request. */
export async function withdrawUstaadVerification(
  db: Tx,
  actor: { userId: string },
  input: { id: string; expectedVersion: number },
): Promise<VerificationView> {
  return db.transaction(async (tx) => {
    const m = await activeMemberOfUser(tx, actor.userId);
    const [v] = await tx
      .select()
      .from(ustaadVerifications)
      .where(and(eq(ustaadVerifications.id, input.id), eq(ustaadVerifications.memberId, m.id)))
      .limit(1);
    if (!v) throw new NotFoundError('Request not found');
    ustaadVerificationMachine.assert(v.status as UstaadVerificationStatus, 'withdrawn', 'member');
    const [row] = await tx
      .update(ustaadVerifications)
      .set({ status: 'withdrawn' })
      .where(cas(v, input.expectedVersion))
      .returning();
    if (!row) throw stale();
    await recordUstaadEvent(tx, {
      entityType: 'verification',
      entityId: v.id,
      kind: 'withdrawn',
      fromStatus: v.status,
      toStatus: 'withdrawn',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: m.cityId,
    });
    return viewOf(tx, row);
  });
}

const cas = (v: VerificationRow, expectedVersion: number) =>
  and(
    eq(ustaadVerifications.id, v.id),
    eq(ustaadVerifications.status, v.status),
    eq(ustaadVerifications.version, expectedVersion),
  );
const stale = () =>
  new ConflictError('This request changed meanwhile; reload and try again', 'STALE_VERIFICATION');

/** The member's latest verification (for `/partners/status` and Me › Get verified), or null. */
export async function ustaadVerificationStatus(
  tx: Tx,
  actor: { userId: string },
): Promise<VerificationView | null> {
  const m = await activeMemberOfUser(tx, actor.userId);
  const [v] = await tx
    .select()
    .from(ustaadVerifications)
    .where(eq(ustaadVerifications.memberId, m.id))
    .orderBy(desc(ustaadVerifications.createdAt), desc(ustaadVerifications.id))
    .limit(1);
  return v ? viewOf(tx, v) : null;
}

/** Evidence complete → `requested → in_review` (system). Called after a vouch is given or an attestation confirmed. */
async function maybeToReview(tx: Tx, memberId: string): Promise<void> {
  const v = await openVerification(tx, memberId);
  if (v?.status !== 'requested') return;
  const s = await readUstaadSettingValues(tx, ['ustaad.verify.vouches_needed']);
  const [confirmed] = await tx
    .select({ id: ustaadAttestations.id })
    .from(ustaadAttestations)
    .where(and(eq(ustaadAttestations.verificationId, v.id), eq(ustaadAttestations.status, 'confirmed')))
    .limit(1);
  const given = await tx
    .select({ voucherWorkshopId: ustaadMembers.workshopId })
    .from(ustaadVouches)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadVouches.voucherId))
    .where(and(eq(ustaadVouches.verificationId, v.id), eq(ustaadVouches.status, 'given')));
  if (!confirmed && !vouchesSufficient(given, Number(s['ustaad.verify.vouches_needed']))) return;
  ustaadVerificationMachine.assert('requested', 'in_review', 'system');
  const [row] = await tx
    .update(ustaadVerifications)
    .set({ status: 'in_review' })
    .where(cas(v, v.version))
    .returning({ id: ustaadVerifications.id });
  if (row)
    await recordUstaadEvent(tx, {
      entityType: 'verification',
      entityId: v.id,
      kind: 'evidence_complete',
      fromStatus: 'requested',
      toStatus: 'in_review',
      actorId: null,
      actorRole: 'system',
    });
}

// ── Vouches (SR-7) ────────────────────────────────────────────────────────────────────────────────────────────

const vouchView = (v: typeof ustaadVouches.$inferSelect): VouchView => ({
  id: v.id,
  voucherId: v.voucherId,
  voucheeId: v.voucheeId,
  relation: v.relation as VouchView['relation'],
  status: v.status as VouchView['status'],
  version: v.version,
});

/** Member (vouchee): ask a member to vouch for them. The voucher's eligibility is checked when they give it. */
export async function requestUstaadVouch(
  db: Tx,
  actor: { userId: string },
  input: { voucherId: string; relation: VouchView['relation'] },
): Promise<VouchView> {
  return db.transaction(async (tx) => {
    const me = await activeMemberOfUser(tx, actor.userId);
    if (me.id === input.voucherId) throw new ValidationError('You cannot vouch for yourself', 'VOUCH_SELF');
    const [voucher] = await tx
      .select({ id: ustaadMembers.id, status: ustaadMembers.status })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.id, input.voucherId))
      .limit(1);
    if (voucher?.status !== 'active') throw new NotFoundError('Member not found');
    const open = await openVerification(tx, me.id);
    const [row] = await tx
      .insert(ustaadVouches)
      .values({
        voucherId: input.voucherId,
        voucheeId: me.id,
        relation: input.relation,
        verificationId: open?.id ?? null,
        expiresAt: new Date(Date.now() + VOUCH_TTL_MS),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('You already asked this member', 'VOUCH_EXISTS');
    return vouchView(row);
  });
}

/** Voucher: give a requested vouch (SR-7 checks), then move the vouchee's request to review if evidence is complete. */
export async function giveUstaadVouch(
  db: Tx,
  actor: { userId: string },
  input: { id: string; expectedVersion: number },
): Promise<VouchView> {
  return db.transaction(async (tx) => {
    const me = await activeMemberOfUser(tx, actor.userId);
    const [v] = await tx
      .select()
      .from(ustaadVouches)
      .where(and(eq(ustaadVouches.id, input.id), eq(ustaadVouches.voucherId, me.id)))
      .limit(1);
    if (!v) throw new NotFoundError('Vouch not found');
    ustaadVouchMachine.assert(v.status as VouchView['status'], 'given', 'member');
    const s = await readUstaadSettingValues(tx, [
      'ustaad.verify.vouch_min_level',
      'ustaad.verify.vouch_min_account_days',
      'ustaad.verify.vouch_per_month',
    ]);
    const [acct] = await tx.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, me.userId));
    const [reciprocal] = await tx
      .select({ id: ustaadVouches.id })
      .from(ustaadVouches)
      .where(
        and(
          eq(ustaadVouches.voucherId, v.voucheeId),
          eq(ustaadVouches.voucheeId, me.id),
          eq(ustaadVouches.status, 'given'),
        ),
      )
      .limit(1);
    const monthAgo = new Date(Date.now() - 30 * DAY_MS);
    const [month] = await tx
      .select({ n: count() })
      .from(ustaadVouches)
      .where(
        and(
          eq(ustaadVouches.voucherId, me.id),
          eq(ustaadVouches.status, 'given'),
          gte(ustaadVouches.decidedAt, monthAgo),
        ),
      );
    const refusal = vouchRefusal({
      voucher: { level: me.level as UstaadLevel, accountCreatedAt: acct?.createdAt ?? new Date() },
      reciprocal: reciprocal !== undefined,
      vouchesThisMonth: month?.n ?? 0,
      now: new Date(),
      minLevel: s['ustaad.verify.vouch_min_level'] as UstaadLevel,
      minAccountDays: Number(s['ustaad.verify.vouch_min_account_days']),
      perMonth: Number(s['ustaad.verify.vouch_per_month']),
    });
    if (refusal) throw new ValidationError('You cannot vouch right now', refusal);
    const open = await openVerification(tx, v.voucheeId);
    const [row] = await tx
      .update(ustaadVouches)
      .set({ status: 'given', decidedAt: new Date(), verificationId: v.verificationId ?? open?.id ?? null })
      .where(
        and(
          eq(ustaadVouches.id, v.id),
          eq(ustaadVouches.status, v.status),
          eq(ustaadVouches.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('This vouch changed meanwhile', 'STALE_VOUCH');
    // "Recommendation" = a vouch given by a Pakka+ Ustaad (§ 9.2 group B).
    if (levelAtLeast(me.level as UstaadLevel, 'pakka'))
      await tx
        .update(ustaadMemberCounters)
        .set({ recommendations: sql`${ustaadMemberCounters.recommendations} + 1` })
        .where(eq(ustaadMemberCounters.memberId, v.voucheeId));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'vouch',
        entityId: v.id,
        kind: 'given',
        fromStatus: v.status,
        toStatus: 'given',
        actorId: actor.userId,
        actorRole: 'member',
        cityId: me.cityId,
      },
      {
        name: 'ustaad_vouch_given',
        memberId: me.id,
        userId: actor.userId,
        props: { voucherId: me.id, voucheeId: v.voucheeId },
      },
    );
    await maybeToReview(tx, v.voucheeId);
    await recomputeUstaadLevel(tx, v.voucheeId);
    return vouchView(row);
  });
}

/** Voucher: decline a request, or take back a given vouch (reason code). */
export async function decideUstaadVouch(
  db: Tx,
  actor: { userId: string },
  input: { id: string; expectedVersion: number; to: 'declined' | 'revoked'; reasonCode?: string },
): Promise<VouchView> {
  return db.transaction(async (tx) => {
    const me = await activeMemberOfUser(tx, actor.userId);
    const [v] = await tx
      .select()
      .from(ustaadVouches)
      .where(and(eq(ustaadVouches.id, input.id), eq(ustaadVouches.voucherId, me.id)))
      .limit(1);
    if (!v) throw new NotFoundError('Vouch not found');
    ustaadVouchMachine.assert(v.status as VouchView['status'], input.to, 'member');
    const [row] = await tx
      .update(ustaadVouches)
      .set({
        status: input.to,
        decidedAt: new Date(),
        revokedReasonCode: input.to === 'revoked' ? (input.reasonCode ?? 'other') : null,
      })
      .where(
        and(
          eq(ustaadVouches.id, v.id),
          eq(ustaadVouches.status, v.status),
          eq(ustaadVouches.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('This vouch changed meanwhile', 'STALE_VOUCH');
    if (input.to === 'revoked' && levelAtLeast(me.level as UstaadLevel, 'pakka'))
      await tx
        .update(ustaadMemberCounters)
        .set({ recommendations: sql`${ustaadMemberCounters.recommendations} - 1` })
        .where(
          and(
            eq(ustaadMemberCounters.memberId, v.voucheeId),
            sql`${ustaadMemberCounters.recommendations} > 0`,
          ),
        );
    await recordUstaadEvent(tx, {
      entityType: 'vouch',
      entityId: v.id,
      kind: input.to,
      fromStatus: v.status,
      toStatus: input.to,
      reasonCode: row.revokedReasonCode,
      actorId: actor.userId,
      actorRole: 'member',
      cityId: me.cityId,
    });
    return vouchView(row);
  });
}

// ── Attestations by a MechDost workshop (SR-6, partner path) ──────────────────────────────────────────────────

/** Member: ask a MechDost workshop's owner to confirm they work there (bell to the workshop's portal). */
export async function requestUstaadAttestation(
  db: Tx,
  actor: { userId: string },
  input: { workshopId: string; sinceYear: number | null },
): Promise<AttestationView> {
  return db.transaction(async (tx) => {
    const m = await activeMemberOfUser(tx, actor.userId);
    const [w] = await tx
      .select({ id: workshops.id, status: workshops.status })
      .from(workshops)
      .where(eq(workshops.id, input.workshopId))
      .limit(1);
    if (w?.status !== 'approved') throw new NotFoundError('Workshop not found');
    const open = await openVerification(tx, m.id);
    if (!open) throw new ValidationError('Ask for verification first', 'USTAAD_NO_REQUEST');
    const [row] = await tx
      .insert(ustaadAttestations)
      .values({
        verificationId: open.id,
        memberId: m.id,
        workshopId: w.id,
        sinceYear: input.sinceYear,
        expiresAt: new Date(Date.now() + ATTEST_TTL_MS),
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictError('A confirmation is already waiting', 'ATTEST_OPEN');
    await recordUstaadEvent(tx, {
      entityType: 'attestation',
      entityId: row.id,
      kind: 'requested',
      toStatus: 'requested',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: m.cityId,
    });
    return attestationView(row, m);
  });
}

const attestationView = (
  a: typeof ustaadAttestations.$inferSelect,
  m: { displayName: string; handle: string },
): AttestationView => ({
  id: a.id,
  memberId: a.memberId,
  memberName: m.displayName,
  memberHandle: m.handle,
  workshopId: a.workshopId,
  sinceYear: a.sinceYear,
  status: a.status as AttestationView['status'],
  expiresAt: a.expiresAt.toISOString(),
  version: a.version,
});

/** Workshop portal "Confirm your mechanics": open requests for the caller's workshops only. */
export async function listUstaadAttestationsForWorkshops(
  tx: Tx,
  workshopIds: readonly string[],
): Promise<AttestationView[]> {
  if (workshopIds.length === 0) return [];
  const rows = await tx
    .select({ a: ustaadAttestations, name: ustaadMembers.displayName, handle: ustaadMembers.handle })
    .from(ustaadAttestations)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadAttestations.memberId))
    .where(
      and(
        inArray(ustaadAttestations.workshopId, [...workshopIds]),
        eq(ustaadAttestations.status, 'requested'),
      ),
    )
    .orderBy(desc(ustaadAttestations.createdAt))
    .limit(100);
  return rows.map((r) => attestationView(r.a, { displayName: r.name, handle: r.handle }));
}

function quarterStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
}

/** Workshop owner: confirm or decline (foreign ids 404; ≤ `verify.attest_per_owner_quarter` confirmations). */
export async function confirmUstaadAttestation(
  db: Tx,
  actor: { userId: string; workshopIds: readonly string[] },
  input: { id: string; expectedVersion: number; decision: 'confirmed' | 'declined' },
): Promise<AttestationView> {
  return db.transaction(async (tx) => {
    if (actor.workshopIds.length === 0) throw new NotFoundError('Not found');
    const [a] = await tx
      .select()
      .from(ustaadAttestations)
      .where(
        and(
          eq(ustaadAttestations.id, input.id),
          inArray(ustaadAttestations.workshopId, [...actor.workshopIds]),
        ),
      )
      .limit(1);
    if (!a?.workshopId) throw new NotFoundError('Not found');
    ustaadAttestationMachine.assert(a.status as AttestationView['status'], input.decision, 'workshop');
    if (a.expiresAt.getTime() < Date.now())
      throw new ConflictError('This request has expired', 'ATTEST_EXPIRED');
    if (input.decision === 'confirmed') {
      const s = await readUstaadSettingValues(tx, [
        'ustaad.verify.attest_per_owner_quarter',
        'ustaad.verify.attest_photo_max_m',
      ]);
      const [q] = await tx
        .select({ n: count() })
        .from(ustaadAttestations)
        .where(
          and(
            eq(ustaadAttestations.workshopId, a.workshopId),
            eq(ustaadAttestations.status, 'confirmed'),
            gte(ustaadAttestations.decidedAt, quarterStart(new Date())),
          ),
        );
      const refusal = attestationRefusal({
        ownerIsPartner: true,
        businessId: null,
        photoDistanceM: null,
        thisQuarter: q?.n ?? 0,
        perQuarter: Number(s['ustaad.verify.attest_per_owner_quarter']),
        maxM: Number(s['ustaad.verify.attest_photo_max_m']),
      });
      if (refusal) throw new ValidationError('Too many confirmations this quarter', refusal);
    }
    const [row] = await tx
      .update(ustaadAttestations)
      .set({ status: input.decision, decidedAt: new Date(), ownerUserId: actor.userId })
      .where(
        and(
          eq(ustaadAttestations.id, a.id),
          eq(ustaadAttestations.status, a.status),
          eq(ustaadAttestations.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!row) throw new ConflictError('This request changed meanwhile', 'STALE_ATTESTATION');
    const [m] = await tx.select().from(ustaadMembers).where(eq(ustaadMembers.id, a.memberId));
    if (!m) throw new NotFoundError('Not found');
    // A confirmed owner proves the garage: it is the member's workshop for the same-garage checks.
    if (input.decision === 'confirmed')
      await tx
        .update(ustaadMembers)
        .set({ workshopId: a.workshopId })
        .where(eq(ustaadMembers.id, a.memberId));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'attestation',
        entityId: a.id,
        kind: input.decision,
        fromStatus: a.status,
        toStatus: input.decision,
        actorId: actor.userId,
        actorRole: 'workshop',
        cityId: m.cityId,
      },
      {
        name: 'ustaad_attestation_decided',
        memberId: a.memberId,
        userId: actor.userId,
        props: { memberId: a.memberId, outcome: input.decision },
      },
    );
    if (input.decision === 'confirmed') await maybeToReview(tx, a.memberId);
    return attestationView(row, m);
  });
}

/** Hourly `ustaad_attestation_expire`: requested past `expires_at` → expired (system). */
export async function expireUstaadAttestations(tx: Tx, now: Date = new Date()): Promise<number> {
  ustaadAttestationMachine.assert('requested', 'expired', 'system');
  const rows = await tx
    .update(ustaadAttestations)
    .set({ status: 'expired', decidedAt: now })
    .where(and(eq(ustaadAttestations.status, 'requested'), lt(ustaadAttestations.expiresAt, now)))
    .returning({ id: ustaadAttestations.id });
  return rows.length;
}

// ── Staff queue and decisions (SR-8, locked) ──────────────────────────────────────────────────────────────────

/** Staff queue (`ustaad:verify`), city scoped (null = all cities); keyset by created_at. */
export async function listUstaadVerifications(
  tx: Tx,
  q: {
    status: 'requested' | 'in_review' | 'approved' | 'rejected';
    cityIds: readonly string[] | null;
    before?: Date;
  },
): Promise<{ items: VerificationQueueItem[]; next: string | null }> {
  const LIMIT = 50;
  const rows = await tx
    .select({ v: ustaadVerifications, m: ustaadMembers, cityCode: cities.code })
    .from(ustaadVerifications)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadVerifications.memberId))
    .innerJoin(cities, eq(cities.id, ustaadMembers.cityId))
    .where(
      and(
        eq(ustaadVerifications.status, q.status),
        q.cityIds ? inArray(ustaadMembers.cityId, [...q.cityIds]) : undefined,
        q.before ? lt(ustaadVerifications.createdAt, q.before) : undefined,
      ),
    )
    .orderBy(desc(ustaadVerifications.createdAt))
    .limit(LIMIT + 1);
  const page = rows.slice(0, LIMIT);
  const items: VerificationQueueItem[] = [];
  for (const r of page)
    items.push({
      ...(await viewOf(tx, r.v)),
      handle: r.m.handle,
      displayName: r.m.displayName,
      level: r.m.level as UstaadLevel,
      cityCode: r.cityCode,
      yearsClaimed: r.m.yearsClaimed,
    });
  const last = page.at(-1);
  return { items, next: rows.length > LIMIT && last ? last.v.createdAt.toISOString() : null };
}

async function loadForStaff(
  tx: Tx,
  id: string,
  cityIds: readonly string[] | null,
): Promise<{ v: VerificationRow; m: MemberRow }> {
  const [r] = await tx
    .select({ v: ustaadVerifications, m: ustaadMembers })
    .from(ustaadVerifications)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadVerifications.memberId))
    .where(
      and(eq(ustaadVerifications.id, id), cityIds ? inArray(ustaadMembers.cityId, [...cityIds]) : undefined),
    )
    .limit(1);
  if (!r) throw new NotFoundError('Request not found');
  return r;
}

async function audit(
  tx: Tx,
  staffUserId: string,
  action: string,
  v: VerificationRow,
  after: Record<string, unknown>,
  reason: string | null,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: staffUserId,
    actorRole: 'staff',
    action,
    entity: 'ustaad_verification',
    entityId: v.id,
    before: { status: v.status, version: v.version },
    after,
    reason,
  });
}

/** The single-step level path from `from` up to `to` (each step asserted by the level machine as `admin`). */
function levelPath(from: UstaadLevel, to: UstaadLevel): UstaadLevel[] {
  const path: UstaadLevel[] = [];
  let cur = from;
  if (cur === 'apprentice' || cur === 'ustaad_pending') {
    if (levelRank(to) < levelRank('naya')) return path;
    ustaadLevelMachine.assert(cur, 'naya', 'admin');
    path.push('naya');
    cur = 'naya';
  }
  while (levelRank(cur) < levelRank(to)) {
    const next: UstaadLevel | undefined =
      EARNED_LEVELS[(EARNED_LEVELS as readonly UstaadLevel[]).indexOf(cur) + 1];
    if (!next) break;
    ustaadLevelMachine.assert(cur, next, 'admin');
    path.push(next);
    cur = next;
  }
  return path;
}

/**
 * Staff: approve (from `requested`, staff pull it in, or `in_review`). Grants a level ≤ the level asked; for a
 * verification also sets `verified`, flips `counts_for_levels` on the member's answers and back-fills their Izzat
 * (idempotent keys). Staff never decide their own request (403 SELF_MODERATION).
 */
export async function approveUstaadVerification(
  db: Tx,
  staff: { userId: string; cityIds?: readonly string[] | null },
  input: { id: string; expectedVersion: number; grantedLevel: 'naya' | 'pakka' | 'bada' | 'master' },
): Promise<VerificationView> {
  return db.transaction(async (tx) => {
    const { v, m } = await loadForStaff(tx, input.id, staff.cityIds ?? null);
    if (v.version !== input.expectedVersion) throw stale();
    if (m.userId === staff.userId)
      throw new ForbiddenError('You cannot decide your own request', 'SELF_MODERATION');
    if (levelRank(input.grantedLevel) > levelRank(v.requestedLevel as UstaadLevel))
      throw new ValidationError('Grant at most the level asked for', 'USTAAD_LEVEL_ABOVE_REQUEST');
    const from = v.status as UstaadVerificationStatus;
    if (from === 'requested') ustaadVerificationMachine.assert('requested', 'in_review', 'admin');
    ustaadVerificationMachine.assert(from === 'requested' ? 'in_review' : from, 'approved', 'admin');
    const now = new Date();
    const [row] = await tx
      .update(ustaadVerifications)
      .set({ status: 'approved', grantedLevel: input.grantedLevel, decidedBy: staff.userId, decidedAt: now })
      .where(cas(v, input.expectedVersion))
      .returning();
    if (!row) throw stale();

    const level = m.level as UstaadLevel;
    const path = levelRank(input.grantedLevel) > levelRank(level) ? levelPath(level, input.grantedLevel) : [];
    const target = path.at(-1) ?? level;
    const [moved] = await tx
      .update(ustaadMembers)
      .set({
        verificationState: 'verified',
        verifiedAt: m.verifiedAt ?? now,
        ...(target !== level ? { level: target, levelSince: now } : {}),
      })
      .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.version, m.version)))
      .returning({ id: ustaadMembers.id });
    if (!moved) throw new ConflictError('The member changed meanwhile; try again', 'STALE_MEMBER');

    // Answers written while pending start counting, with their Izzat (idempotent per answer).
    const flipped = await tx
      .update(ustaadAnswers)
      .set({ countsForLevels: true })
      .where(and(eq(ustaadAnswers.authorId, m.id), eq(ustaadAnswers.countsForLevels, false)))
      .returning({ id: ustaadAnswers.id });
    for (const a of flipped)
      await recordIzzat(
        tx,
        { userId: staff.userId },
        {
          memberId: m.id,
          reason: 'answer_posted',
          source: { type: 'answer', id: a.id },
          idemKey: `answer:${a.id}`,
        },
      );

    await audit(
      tx,
      staff.userId,
      'ustaad.verification.approved',
      v,
      { status: 'approved', grantedLevel: input.grantedLevel },
      null,
    );
    await recordUstaadEvent(
      tx,
      {
        entityType: 'verification',
        entityId: v.id,
        kind: 'approved',
        fromStatus: v.status,
        toStatus: 'approved',
        actorId: staff.userId,
        actorRole: 'staff',
        cityId: m.cityId,
        props: { granted: input.grantedLevel },
      },
      {
        name: 'ustaad_verification_decided',
        memberId: m.id,
        userId: m.userId,
        props: { memberId: m.id, outcome: 'approved', reason: null },
      },
    );
    if (target !== level)
      await recordUstaadEvent(
        tx,
        {
          entityType: 'member',
          entityId: m.id,
          kind: 'level_changed',
          fromStatus: level,
          toStatus: target,
          actorId: staff.userId,
          actorRole: 'staff',
          cityId: m.cityId,
        },
        {
          name: 'ustaad_level_reached',
          memberId: m.id,
          userId: m.userId,
          props: { memberId: m.id, level: target },
        },
      );
    await notifyUstaad(tx, 'ustaad.verification_decided', {
      userId: m.userId,
      entityId: v.id,
      version: row.version,
      params: {},
    });
    await recomputeUstaadLevel(tx, m.id);
    return viewOf(tx, row);
  });
}

/** Staff: reject an open request with a reason code (note required for `other`). */
export async function rejectUstaadVerification(
  db: Tx,
  staff: { userId: string; cityIds?: readonly string[] | null },
  input: { id: string; expectedVersion: number } & Pick<RejectVerification, 'reasonCode' | 'note'>,
): Promise<VerificationView> {
  return db.transaction(async (tx) => {
    const { v, m } = await loadForStaff(tx, input.id, staff.cityIds ?? null);
    if (v.version !== input.expectedVersion) throw stale();
    if (m.userId === staff.userId)
      throw new ForbiddenError('You cannot decide your own request', 'SELF_MODERATION');
    const from = v.status as UstaadVerificationStatus;
    if (from === 'requested') ustaadVerificationMachine.assert('requested', 'in_review', 'admin');
    ustaadVerificationMachine.assert(from === 'requested' ? 'in_review' : from, 'rejected', 'admin');
    const [row] = await tx
      .update(ustaadVerifications)
      .set({
        status: 'rejected',
        reasonCode: input.reasonCode,
        note: input.note,
        decidedBy: staff.userId,
        decidedAt: new Date(),
      })
      .where(cas(v, input.expectedVersion))
      .returning();
    if (!row) throw stale();
    // A pending member with no other open request goes back to "unverified" (they can ask again).
    if (m.verificationState === 'pending_verification')
      await tx
        .update(ustaadMembers)
        .set({ verificationState: 'unverified' })
        .where(and(eq(ustaadMembers.id, m.id), eq(ustaadMembers.verificationState, 'pending_verification')));
    await audit(
      tx,
      staff.userId,
      'ustaad.verification.rejected',
      v,
      { status: 'rejected' },
      input.reasonCode,
    );
    await recordUstaadEvent(
      tx,
      {
        entityType: 'verification',
        entityId: v.id,
        kind: 'rejected',
        fromStatus: v.status,
        toStatus: 'rejected',
        reasonCode: input.reasonCode,
        actorId: staff.userId,
        actorRole: 'staff',
        cityId: m.cityId,
      },
      {
        name: 'ustaad_verification_decided',
        memberId: m.id,
        userId: m.userId,
        props: { memberId: m.id, outcome: 'rejected', reason: input.reasonCode },
      },
    );
    await notifyUstaad(tx, 'ustaad.verification_decided', {
      userId: m.userId,
      entityId: v.id,
      version: row.version,
      params: {},
    });
    return viewOf(tx, row);
  });
}

/**
 * Staff: revoke an approved verification (four-eyes: not the staff member who approved it, 403 FOUR_EYES). The level
 * is not changed here (a demotion is a separate staff level review).
 */
export async function revokeUstaadVerification(
  db: Tx,
  staff: { userId: string; cityIds?: readonly string[] | null },
  input: { id: string; expectedVersion: number } & Pick<RejectVerification, 'reasonCode' | 'note'>,
): Promise<VerificationView> {
  return db.transaction(async (tx) => {
    const { v, m } = await loadForStaff(tx, input.id, staff.cityIds ?? null);
    if (v.version !== input.expectedVersion) throw stale();
    if (m.userId === staff.userId)
      throw new ForbiddenError('You cannot decide your own request', 'SELF_MODERATION');
    ustaadVerificationMachine.assert(v.status as UstaadVerificationStatus, 'revoked', 'admin');
    if (v.decidedBy === staff.userId)
      throw new ForbiddenError('A second staff member must revoke this', 'FOUR_EYES');
    const [row] = await tx
      .update(ustaadVerifications)
      .set({
        status: 'revoked',
        reasonCode: input.reasonCode,
        note: input.note,
        decidedBy: staff.userId,
        decidedAt: new Date(),
      })
      .where(cas(v, input.expectedVersion))
      .returning();
    if (!row) throw stale();
    await tx.update(ustaadMembers).set({ verificationState: 'revoked' }).where(eq(ustaadMembers.id, m.id));
    await audit(tx, staff.userId, 'ustaad.verification.revoked', v, { status: 'revoked' }, input.reasonCode);
    await recordUstaadEvent(
      tx,
      {
        entityType: 'verification',
        entityId: v.id,
        kind: 'revoked',
        fromStatus: v.status,
        toStatus: 'revoked',
        reasonCode: input.reasonCode,
        actorId: staff.userId,
        actorRole: 'staff',
        cityId: m.cityId,
      },
      {
        name: 'ustaad_verification_decided',
        memberId: m.id,
        userId: m.userId,
        props: { memberId: m.id, outcome: 'revoked', reason: input.reasonCode },
      },
    );
    return viewOf(tx, row);
  });
}

/** Open requests per status (admin overview, `/partners/applications` notice count). */
export async function countOpenUstaadVerifications(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(ustaadVerifications)
    .where(or(eq(ustaadVerifications.status, 'requested'), eq(ustaadVerifications.status, 'in_review')));
  return r?.n ?? 0;
}
