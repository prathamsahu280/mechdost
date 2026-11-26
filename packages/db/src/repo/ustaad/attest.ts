/**
 * Garage owner not on MechDost confirms a member (spec 23 § 4 flow 2, § 8, public path `/ustaad-attest/{token}`, SR-6;
 * plan task B4). The member gives the owner's phone; it is stored encrypted (spec 13 envelope) with a keyed hash for
 * the per-owner quarter cap. The member never sees a link: a staff member issues the one-time link (and calls the
 * owner while WhatsApp/SMS templates are off), so a member cannot confirm themselves. The link is single use (the
 * POST consumes it with a conditional UPDATE), expires with the attestation, and a re-issue replaces the token.
 * Opening the page (GET) never consumes it (link-preview crawlers fetch links).
 *
 * The owner confirms with a GSTIN or Udyam number and their position at the shop, which must be within
 * `verify.attest_photo_max_m` of the member's garage pin (only when the member allowed "use pin for verification").
 * The public caller never learns whether the distance check passed (every confirmation answers "received"); failures
 * are recorded for staff and close the link after `verify.attest_distance_tries`. Quarter caps per owner phone and per
 * business number are counted under advisory locks. Only the distance is stored, never the owner's position. The shop photo of SR-6 is not built yet (it needs a public
 * upload path; report). Staff still give the final approval (SR-8). Evidence is cleared after
 * `verify.evidence_retention_days` by `purgeUstaadAttestationEvidence`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ustaadAttestationMachine } from '@mechdost/shared/state';
import { attestationRefusal, BUSINESS_ID_RE } from '@mechdost/shared/ustaad/verify';
import { blindIndex, decryptField, encryptField, type Keyring } from '../../crypto';
import {
  auditLog,
  users,
  ustaadAttestations,
  ustaadLocations,
  ustaadMembers,
  ustaadVerifications,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { num } from '../sql-rows';
import { recordUstaadEvent } from './events';
import { readUstaadSettingValues } from './settings';
import { ustaadMaybeToReview } from './verification';

const DAY_MS = 86_400_000;
const ATTEST_TTL_MS = 7 * DAY_MS;
const PHONE_AAD = 'ustaad_attestations.owner_phone_enc';
const HASH_PURPOSE = 'ustaad_owner_phone';
const E164_IN = /^\+91[6-9]\d{9}$/;
/** The token in the link: 32 random bytes as hex (64 word characters, so log and Sentry scrubbing removes it). */
export const ATTEST_TOKEN_RE = /^[0-9a-f]{64}$/;

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function quarterStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
}

export interface OwnerAttestationView {
  id: string;
  status: string;
  sinceYear: number | null;
  expiresAt: string;
  version: number;
}

/** Member: ask a garage owner who is not on MechDost to confirm they work there (needs an open request). */
export async function requestUstaadOwnerAttestation(
  db: Tx,
  keyring: Keyring,
  actor: { userId: string },
  input: { ownerPhone: string; sinceYear: number | null },
): Promise<OwnerAttestationView> {
  if (!E164_IN.test(input.ownerPhone))
    throw new ValidationError('Enter a 10-digit Indian mobile number', 'PHONE_FORMAT');
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ id: ustaadMembers.id, status: ustaadMembers.status, cityId: ustaadMembers.cityId })
      .from(ustaadMembers)
      .where(eq(ustaadMembers.userId, actor.userId))
      .limit(1);
    if (!m || m.status === 'left') throw new NotFoundError('Not a member');
    if (m.status === 'banned')
      throw new ForbiddenError('This account cannot use the network', 'USTAAD_BANNED');
    const s = await readUstaadSettingValues(tx, ['ustaad.verify.owner_enabled']);
    if (s['ustaad.verify.owner_enabled'] !== true)
      throw new ValidationError('The owner proof is not available', 'USTAAD_METHOD_OFF');
    const [me] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, actor.userId));
    if (me?.phone === input.ownerPhone)
      throw new ForbiddenError('You cannot confirm yourself', 'SELF_ATTESTATION');
    const [open] = await tx
      .select({ id: ustaadVerifications.id })
      .from(ustaadVerifications)
      .where(
        and(
          eq(ustaadVerifications.memberId, m.id),
          sql`${ustaadVerifications.status} in ('requested','in_review')`,
        ),
      )
      .limit(1);
    if (!open) throw new ValidationError('Ask for verification first', 'USTAAD_NO_REQUEST');
    const [row] = await tx
      .insert(ustaadAttestations)
      .values({
        verificationId: open.id,
        memberId: m.id,
        ownerPhoneEnc: encryptField(input.ownerPhone, keyring, PHONE_AAD),
        ownerPhoneHash: blindIndex(input.ownerPhone, keyring, HASH_PURPOSE),
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
      props: { owner: 'not_partner' },
    });
    return {
      id: row.id,
      status: row.status,
      sinceYear: row.sinceYear,
      expiresAt: row.expiresAt.toISOString(),
      version: row.version,
    };
  });
}

export interface OwnerLinkIssued {
  /** The raw token: shown once to the staff member, never stored. */
  token: string;
  expiresAt: string;
  /** The owner's number, for the staff call (audited read). */
  ownerPhone: string;
}

/**
 * Staff (`ustaad:verify`, city scoped by the caller): issue (or re-issue) the one-time link for a non-partner owner.
 * A re-issue replaces the token hash, so an earlier link stops working. The owner phone is decrypted for the call and
 * the read is written to `audit_log` (`ustaad.attest_owner_phone_read`).
 */
export async function issueUstaadOwnerAttestLink(
  db: Tx,
  keyring: Keyring,
  actor: { userId: string; role: string; cityIds: readonly string[] | null },
  input: { id: string },
): Promise<OwnerLinkIssued> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ a: ustaadAttestations, cityId: ustaadMembers.cityId, memberUserId: ustaadMembers.userId })
      .from(ustaadAttestations)
      .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadAttestations.memberId))
      .where(eq(ustaadAttestations.id, input.id))
      .limit(1);
    const a = found?.a;
    if (!found || !a || (actor.cityIds !== null && !actor.cityIds.includes(found.cityId)))
      throw new NotFoundError('Not found');
    if (a.workshopId !== null || a.ownerPhoneEnc === null) throw new NotFoundError('Not found');
    if (found.memberUserId === actor.userId)
      throw new ForbiddenError('Staff cannot act on their own verification', 'SELF_MODERATION');
    if (a.status !== 'requested' || a.expiresAt.getTime() <= Date.now())
      throw new ConflictError('This request is no longer open', 'ATTEST_EXPIRED');
    const token = randomBytes(32).toString('hex');
    const [row] = await tx
      .update(ustaadAttestations)
      .set({ tokenHash: tokenHash(token), linkIssuedAt: new Date() })
      .where(
        and(
          eq(ustaadAttestations.id, a.id),
          eq(ustaadAttestations.status, 'requested'),
          eq(ustaadAttestations.version, a.version),
        ),
      )
      .returning({ expiresAt: ustaadAttestations.expiresAt });
    if (!row) throw new ConflictError('This request changed meanwhile', 'STALE_ATTESTATION');
    await tx.insert(auditLog).values({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: 'ustaad.attest_owner_phone_read',
      entity: 'ustaad_attestation',
      entityId: a.id,
      after: { linkIssued: true },
    });
    await recordUstaadEvent(
      tx,
      {
        entityType: 'attestation',
        entityId: a.id,
        kind: 'link_issued',
        fromStatus: 'requested',
        toStatus: 'requested',
        actorId: actor.userId,
        actorRole: 'staff',
        cityId: found.cityId,
      },
      {
        name: 'ustaad_attest_link_issued',
        memberId: null,
        userId: actor.userId,
        props: { attestationId: a.id },
      },
    );
    return {
      token,
      expiresAt: row.expiresAt.toISOString(),
      ownerPhone: decryptField(a.ownerPhoneEnc, keyring, PHONE_AAD),
    };
  });
}

export interface OwnerAttestationQueueItem {
  id: string;
  memberHandle: string;
  memberName: string;
  sinceYear: number | null;
  linkIssuedAt: string | null;
  expiresAt: string;
}

/** Staff: open non-partner owner requests (city scoped; null = all cities), oldest first; never a phone. */
export async function listUstaadOwnerAttestations(
  tx: Tx,
  cityIds: readonly string[] | null,
): Promise<OwnerAttestationQueueItem[]> {
  if (cityIds !== null && cityIds.length === 0) return [];
  const rows = await tx
    .select({
      a: ustaadAttestations,
      handle: ustaadMembers.handle,
      name: ustaadMembers.displayName,
    })
    .from(ustaadAttestations)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadAttestations.memberId))
    .where(
      and(
        eq(ustaadAttestations.status, 'requested'),
        isNull(ustaadAttestations.workshopId),
        gt(ustaadAttestations.expiresAt, new Date()),
        cityIds === null ? undefined : inArray(ustaadMembers.cityId, [...cityIds]),
      ),
    )
    .orderBy(ustaadAttestations.createdAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.a.id,
    memberHandle: r.handle,
    memberName: r.name,
    sinceYear: r.a.sinceYear,
    linkIssuedAt: r.a.linkIssuedAt?.toISOString() ?? null,
    expiresAt: r.a.expiresAt.toISOString(),
  }));
}

/** What the public page shows: the member's display name, area and claimed year only (never a phone or an id). */
export interface AttestPageView {
  memberName: string;
  areaLabel: string;
  areaLabelHi: string | null;
  sinceYear: number | null;
  expiresAt: string;
}

async function openByToken(tx: Tx, token: string) {
  if (!ATTEST_TOKEN_RE.test(token)) return null;
  const [found] = await tx
    .select({
      a: ustaadAttestations,
      memberName: ustaadMembers.displayName,
      memberStatus: ustaadMembers.status,
      areaLabel: ustaadMembers.areaLabel,
      areaLabelHi: ustaadMembers.areaLabelHi,
      cityId: ustaadMembers.cityId,
    })
    .from(ustaadAttestations)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadAttestations.memberId))
    .where(
      and(
        eq(ustaadAttestations.tokenHash, tokenHash(token)),
        eq(ustaadAttestations.status, 'requested'),
        gt(ustaadAttestations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!found || found.memberStatus === 'left' || found.memberStatus === 'banned') return null;
  return found;
}

/** Public `GET /ustaad/attest/{token}`: one 404 for unknown, used and expired tokens (no oracle). */
export async function ustaadAttestPage(tx: Tx, token: string): Promise<AttestPageView> {
  const found = await openByToken(tx, token);
  if (!found) throw new NotFoundError('Not found');
  return {
    memberName: found.memberName,
    areaLabel: found.areaLabel,
    areaLabelHi: found.areaLabelHi,
    sinceYear: found.a.sinceYear,
    expiresAt: found.a.expiresAt.toISOString(),
  };
}

export type AttestDecision =
  | { decision: 'declined' }
  | { decision: 'confirmed'; businessId: string; shop: { lat: number; lng: number; accuracyM: number } };

/** What the public caller learns: a confirmation is always "received" (never whether the distance check passed). */
export type AttestPublicOutcome = 'received' | 'declined';

const BUSINESS_PURPOSE = 'ustaad_owner_business';

/** Serialise every confirmation of one owner phone or business number (quarter cap; no count-then-confirm race). */
async function lockOwnerKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * Public `POST /ustaad/attest/{token}` (the API checked Turnstile and the IP limit). A malformed GSTIN/Udyam number is
 * refused (`ATTEST_BUSINESS_ID`, a format check only). Then, under transaction-scoped advisory locks on the owner's
 * phone hash and business hash, the per-quarter caps for both are counted (`ATTEST_QUARTER_CAP`). The distance check
 * (owner within `verify.attest_photo_max_m` of a pin the member allowed for verification) never answers differently
 * (security review: no location oracle): a failure records the distance and the attempt for staff and answers
 * "received"; at `verify.attest_distance_tries` failures the token is cleared. A pass confirms with one conditional
 * UPDATE (status, token hash, version) and also answers "received". A second submit after the link closed is 404.
 */
export async function decideUstaadAttestByToken(
  db: Tx,
  keyring: Keyring,
  token: string,
  input: AttestDecision,
): Promise<{ outcome: AttestPublicOutcome }> {
  return db.transaction(async (tx) => {
    const found = await openByToken(tx, token);
    if (!found) throw new NotFoundError('Not found');
    const a = found.a;
    ustaadAttestationMachine.assert('requested', input.decision, 'workshop');
    const cas = and(
      eq(ustaadAttestations.id, a.id),
      eq(ustaadAttestations.status, 'requested'),
      eq(ustaadAttestations.version, a.version),
      eq(ustaadAttestations.tokenHash, tokenHash(token)),
    );
    if (input.decision === 'declined') {
      const [row] = await tx
        .update(ustaadAttestations)
        .set({ status: 'declined', decidedAt: new Date(), tokenHash: null })
        .where(cas)
        .returning({ id: ustaadAttestations.id });
      if (!row) throw new NotFoundError('Not found');
      await decidedEvent(tx, a, found.cityId, 'declined');
      return { outcome: 'declined' };
    }

    const businessId = input.businessId.trim().toUpperCase();
    if (!BUSINESS_ID_RE.test(businessId))
      throw new ValidationError('Enter a valid GSTIN or Udyam number', 'ATTEST_BUSINESS_ID');
    const businessHash = blindIndex(businessId, keyring, BUSINESS_PURPOSE);
    const s = await readUstaadSettingValues(tx, [
      'ustaad.verify.attest_per_owner_quarter',
      'ustaad.verify.attest_photo_max_m',
      'ustaad.verify.attest_distance_tries',
    ]);
    const perQuarter = Number(s['ustaad.verify.attest_per_owner_quarter']);
    const since = quarterStart(new Date());
    // Locks in a fixed order (phone, then business) so two confirmations never deadlock.
    const phoneKey = `ustaad_owner_phone:${a.ownerPhoneHash ?? a.id}`;
    const businessKey = `ustaad_owner_business:${businessHash}`;
    for (const key of [phoneKey, businessKey].sort()) await lockOwnerKey(tx, key);
    // Re-read the row under a row lock now that the owner locks are held (security review: the failure count and
    // the version read before the locks can be stale when attempts run in parallel).
    const [fresh] = await tx
      .select()
      .from(ustaadAttestations)
      .where(
        and(
          eq(ustaadAttestations.id, a.id),
          eq(ustaadAttestations.status, 'requested'),
          eq(ustaadAttestations.tokenHash, tokenHash(token)),
          gt(ustaadAttestations.expiresAt, new Date()),
        ),
      )
      .for('update')
      .limit(1);
    if (!fresh) throw new NotFoundError('Not found');
    const freshCas = and(
      eq(ustaadAttestations.id, fresh.id),
      eq(ustaadAttestations.status, 'requested'),
      eq(ustaadAttestations.version, fresh.version),
      eq(ustaadAttestations.tokenHash, tokenHash(token)),
    );
    const confirmedSince = async (
      column: typeof ustaadAttestations.ownerPhoneHash | typeof ustaadAttestations.ownerBusinessHash,
      value: string,
    ) => {
      const [q] = await tx
        .select({ n: count() })
        .from(ustaadAttestations)
        .where(
          and(
            eq(column, value),
            eq(ustaadAttestations.status, 'confirmed'),
            gte(ustaadAttestations.decidedAt, since),
          ),
        );
      return q?.n ?? 0;
    };
    const used = Math.max(
      a.ownerPhoneHash ? await confirmedSince(ustaadAttestations.ownerPhoneHash, a.ownerPhoneHash) : 0,
      await confirmedSince(ustaadAttestations.ownerBusinessHash, businessHash),
    );
    if (used >= perQuarter)
      throw new ValidationError('This confirmation cannot be accepted', 'ATTEST_QUARTER_CAP');

    const [pin] = await tx
      .select({
        m: sql<number>`round(ST_Distance(${ustaadLocations.location}, ST_SetSRID(ST_MakePoint(${input.shop.lng}::float8, ${input.shop.lat}::float8), 4326)::geography))::int`,
      })
      .from(ustaadLocations)
      .where(
        and(
          eq(ustaadLocations.memberId, a.memberId),
          eq(ustaadLocations.useForVerify, true),
          eq(ustaadLocations.hidden, false),
        ),
      )
      .limit(1);
    const distanceM = pin ? num(pin.m) : null;
    const near =
      attestationRefusal({
        ownerIsPartner: false,
        businessId,
        photoDistanceM: distanceM,
        thisQuarter: used,
        perQuarter,
        maxM: Number(s['ustaad.verify.attest_photo_max_m']),
      }) === null;

    if (!near) {
      const tries = Number(s['ustaad.verify.attest_distance_tries']);
      // Counted in SQL on the locked row; the token is cleared in the same statement when the count reaches the cap.
      const [row] = await tx
        .update(ustaadAttestations)
        .set({
          ownerDistanceFailures: sql`${ustaadAttestations.ownerDistanceFailures} + 1`,
          ownerDistanceM: distanceM,
          ownerBusinessId: businessId,
          ownerBusinessHash: businessHash,
          tokenHash: sql`case when ${ustaadAttestations.ownerDistanceFailures} + 1 >= ${tries} then null else ${ustaadAttestations.tokenHash} end`,
        })
        .where(freshCas)
        .returning({ failures: ustaadAttestations.ownerDistanceFailures });
      if (!row) throw new NotFoundError('Not found');
      const failures = row.failures;
      const closes = failures >= tries;
      await recordUstaadEvent(tx, {
        entityType: 'attestation',
        entityId: a.id,
        kind: closes ? 'distance_failed_closed' : 'distance_failed',
        fromStatus: 'requested',
        toStatus: 'requested',
        actorId: null,
        actorRole: 'owner',
        cityId: found.cityId,
        props: { failures, has_pin: distanceM !== null },
      });
      return { outcome: 'received' };
    }

    const [row] = await tx
      .update(ustaadAttestations)
      .set({
        status: 'confirmed',
        decidedAt: new Date(),
        tokenHash: null,
        ownerBusinessId: businessId,
        ownerBusinessHash: businessHash,
        ownerDistanceM: distanceM,
      })
      .where(freshCas)
      .returning({ id: ustaadAttestations.id });
    if (!row) throw new NotFoundError('Not found');
    await decidedEvent(tx, a, found.cityId, 'confirmed');
    await ustaadMaybeToReview(tx, a.memberId);
    return { outcome: 'received' };
  });
}

async function decidedEvent(
  tx: Tx,
  a: typeof ustaadAttestations.$inferSelect,
  cityId: string,
  outcome: 'confirmed' | 'declined',
): Promise<void> {
  await recordUstaadEvent(
    tx,
    {
      entityType: 'attestation',
      entityId: a.id,
      kind: outcome,
      fromStatus: 'requested',
      toStatus: outcome,
      actorId: null,
      actorRole: 'owner',
      cityId,
      props: { via: 'link' },
    },
    {
      name: 'ustaad_attestation_decided',
      memberId: a.memberId,
      userId: null,
      props: { memberId: a.memberId, outcome },
    },
  );
}

/**
 * Daily evidence purge (SR-6 retention, `verify.evidence_retention_days`): for non-partner attestations decided (or
 * expired) longer ago than the retention, the owner phone and the GSTIN/Udyam number are cleared and
 * `evidence_purged_at` is set. The keyed phone hash stays (the quarter cap needs it; it cannot be read back without
 * the index key). Idempotent; bounded batch.
 */
export async function purgeUstaadAttestationEvidence(
  tx: Tx,
  now: Date = new Date(),
  limit = 500,
): Promise<number> {
  const s = await readUstaadSettingValues(tx, ['ustaad.verify.evidence_retention_days']);
  const cutoff = new Date(now.getTime() - Number(s['ustaad.verify.evidence_retention_days']) * DAY_MS);
  const due = tx
    .select({ id: ustaadAttestations.id })
    .from(ustaadAttestations)
    .where(
      and(
        isNull(ustaadAttestations.evidencePurgedAt),
        sql`${ustaadAttestations.ownerPhoneHash} is not null`,
        or(
          and(sql`${ustaadAttestations.status} <> 'requested'`, lte(ustaadAttestations.decidedAt, cutoff)),
          and(eq(ustaadAttestations.status, 'requested'), lte(ustaadAttestations.expiresAt, cutoff)),
        ),
      ),
    )
    .limit(limit);
  const rows = await tx
    .update(ustaadAttestations)
    .set({ ownerPhoneEnc: null, ownerBusinessId: null, tokenHash: null, evidencePurgedAt: now })
    .where(inArray(ustaadAttestations.id, due))
    .returning({ id: ustaadAttestations.id });
  return rows.length;
}
