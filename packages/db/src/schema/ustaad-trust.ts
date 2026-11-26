/**
 * Ustaad trust: verification, attestations, vouches, level rules, the Izzat ledger, counters and badges (spec 23
 * § 6.1, § 7.1–7.3, § 9; migration `ustaad_identity`). Written by workstream B's repositories; staff final approval is
 * a row decided by a staff member (`decided_by`), never a setting (SR-8).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  USTAAD_BADGE_KINDS,
  USTAAD_BADGE_RULE_KINDS,
  USTAAD_IZZAT_REASONS,
  USTAAD_LEVELS,
  USTAAD_VERIFY_METHODS,
  USTAAD_VERIFY_REJECT_REASONS,
  USTAAD_VOUCH_RELATIONS,
} from '@mechdost/shared/ustaad/codes';
import {
  USTAAD_ATTESTATION_STATUSES,
  USTAAD_VERIFICATION_STATUSES,
  USTAAD_VOUCH_STATUSES,
} from '@mechdost/shared/state';
import { createdAt, encryptedCheck, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { workshops } from './services';
import { allOf, nullOrOneOf, oneOf } from './ustaad-common';
import { ustaadMembers } from './ustaad-members';

const member = () =>
  uuid()
    .notNull()
    .references(() => ustaadMembers.id, { onDelete: 'restrict' });

export const ustaadVerifications = pgTable(
  'ustaad_verifications',
  {
    id: id(),
    memberId: member(),
    requestedLevel: text().notNull().default('naya'),
    grantedLevel: text(),
    status: text().notNull().default('requested'),
    proofKinds: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    reasonCode: text(),
    note: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_verifications_one_open_uq')
      .on(t.memberId)
      .where(sql`${t.status} in ('requested','in_review')`),
    index().on(t.status, t.createdAt),
    index().on(t.memberId, t.createdAt),
    index().on(t.decidedBy),
    check('ustaad_verifications_status_valid', oneOf(t.status, USTAAD_VERIFICATION_STATUSES)),
    check(
      'ustaad_verifications_requested_level',
      oneOf(t.requestedLevel, ['naya', 'pakka', 'bada', 'master']),
    ),
    check('ustaad_verifications_granted_level', nullOrOneOf(t.grantedLevel, USTAAD_LEVELS)),
    check('ustaad_verifications_proofs_valid', allOf(t.proofKinds, USTAAD_VERIFY_METHODS)),
    check('ustaad_verifications_reason_valid', nullOrOneOf(t.reasonCode, USTAAD_VERIFY_REJECT_REASONS)),
    // A decision always names the staff member (SR-8: no approval path without a staff row).
    check(
      'ustaad_verifications_decided_by_staff',
      sql`${t.status} not in ('approved','rejected','revoked') or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    check(
      'ustaad_verifications_granted_when_approved',
      sql`${t.status} <> 'approved' or ${t.grantedLevel} is not null`,
    ),
    check('ustaad_verifications_note_len', sql`${t.note} is null or char_length(${t.note}) <= 500`),
  ],
);

export const ustaadAttestations = pgTable(
  'ustaad_attestations',
  {
    id: id(),
    verificationId: uuid()
      .notNull()
      .references(() => ustaadVerifications.id, { onDelete: 'restrict' }),
    memberId: member(),
    workshopId: uuid().references(() => workshops.id, { onDelete: 'restrict' }),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Non-partner owner: the phone encrypted (spec 13 envelope) and its hash for dedupe and the 10-per-quarter cap. */
    ownerPhoneEnc: text(),
    ownerPhoneHash: text(),
    /** GSTIN or Udyam number given by a non-partner owner (SR-6). */
    ownerBusinessId: text(),
    sinceYear: smallint(),
    status: text().notNull().default('requested'),
    /** sha256 of the one-time link token (the token itself is never stored). */
    tokenHash: text(),
    expiresAt: ts().notNull(),
    decidedAt: ts(),
    /** When staff last issued the one-time link (non-partner owner; a re-issue replaces `token_hash`). */
    linkIssuedAt: ts(),
    /**
     * Non-partner owner (SR-6): metres between where the owner stood when confirming (browser location) and the
     * member's garage pin. Only the distance is kept, never the owner's position.
     */
    ownerDistanceM: integer(),
    /**
     * Failed distance checks through the link (security review: no location oracle). The caller always gets the same
     * answer; at `verify.attest_distance_tries` failures the token is cleared and staff decide.
     */
    ownerDistanceFailures: smallint().notNull().default(0),
    /** Keyed blind index of the GSTIN/Udyam number: the per-business quarter cap survives the evidence purge. */
    ownerBusinessHash: text(),
    /** Evidence (owner phone, GSTIN/Udyam) cleared after `verify.evidence_retention_days`; the hash stays for the cap. */
    evidencePurgedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_attestations_one_open_uq')
      .on(t.verificationId)
      .where(sql`${t.status} = 'requested'`),
    uniqueIndex('ustaad_attestations_token_uq')
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    index().on(t.workshopId, t.status),
    index().on(t.memberId),
    index().on(t.ownerUserId),
    index().on(t.ownerPhoneHash, t.createdAt),
    index('ustaad_attestations_expiring_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'requested'`),
    check('ustaad_attestations_status_valid', oneOf(t.status, USTAAD_ATTESTATION_STATUSES)),
    check('ustaad_attestations_owner_phone_enc', encryptedCheck(t.ownerPhoneEnc)),
    check(
      'ustaad_attestations_owner_known',
      sql`${t.workshopId} is not null or ${t.ownerPhoneHash} is not null`,
    ),
    check('ustaad_attestations_owner_distance', sql`${t.ownerDistanceM} is null or ${t.ownerDistanceM} >= 0`),
    check('ustaad_attestations_distance_failures', sql`${t.ownerDistanceFailures} between 0 and 20`),
    index().on(t.ownerBusinessHash, t.decidedAt),
    check(
      'ustaad_attestations_purged_clear',
      sql`${t.evidencePurgedAt} is null or (${t.ownerPhoneEnc} is null and ${t.ownerBusinessId} is null)`,
    ),
    index('ustaad_attestations_purge_idx')
      .on(t.decidedAt)
      .where(sql`${t.evidencePurgedAt} is null and ${t.ownerPhoneHash} is not null`),
    check(
      'ustaad_attestations_since_year',
      sql`${t.sinceYear} is null or ${t.sinceYear} between 1950 and 2100`,
    ),
  ],
);

export const ustaadVouches = pgTable(
  'ustaad_vouches',
  {
    id: id(),
    voucherId: member(),
    voucheeId: member(),
    relation: text().notNull(),
    status: text().notNull().default('requested'),
    verificationId: uuid().references(() => ustaadVerifications.id, { onDelete: 'set null' }),
    revokedReasonCode: text(),
    expiresAt: ts().notNull(),
    decidedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_vouches_active_pair_uq')
      .on(t.voucherId, t.voucheeId)
      .where(sql`${t.status} in ('requested','given')`),
    index().on(t.voucheeId, t.status),
    index().on(t.voucherId, t.createdAt),
    index().on(t.verificationId),
    check('ustaad_vouches_not_self', sql`${t.voucherId} <> ${t.voucheeId}`),
    check('ustaad_vouches_status_valid', oneOf(t.status, USTAAD_VOUCH_STATUSES)),
    check('ustaad_vouches_relation_valid', oneOf(t.relation, USTAAD_VOUCH_RELATIONS)),
    check(
      'ustaad_vouches_revoked_reason',
      sql`${t.status} <> 'revoked' or ${t.revokedReasonCode} is not null`,
    ),
  ],
);

/** Admin table (spec 23 § 9.2): a level is reached when every number of one of its rule groups is met. */
export const ustaadLevelRules = pgTable(
  'ustaad_level_rules',
  {
    id: id(),
    level: text().notNull(),
    ruleGroup: text().notNull().default('A'),
    minFollowers: integer().notNull().default(0),
    minBestAnswers: integer().notNull().default(0),
    minHelpfulPct: smallint().notNull().default(0),
    minVerifiedYears: smallint().notNull().default(0),
    minVideos: integer().notNull().default(0),
    minRecommendations: integer().notNull().default(0),
    needsStaffReview: boolean().notNull().default(false),
    perkEn: text().notNull().default(''),
    perkHi: text().notNull().default(''),
    coinMultiplierBp: integer().notNull().default(10_000),
    nameEn: text().notNull(),
    nameHi: text().notNull(),
    position: smallint().notNull(),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_level_rules_uq').on(t.level, t.ruleGroup),
    index().on(t.updatedBy),
    check('ustaad_level_rules_level_valid', oneOf(t.level, USTAAD_LEVELS)),
    check('ustaad_level_rules_group', sql`${t.ruleGroup} ~ '^[A-Z]$'`),
    check(
      'ustaad_level_rules_non_negative',
      sql`${t.minFollowers} >= 0 and ${t.minBestAnswers} >= 0 and ${t.minVerifiedYears} >= 0 and ${t.minVideos} >= 0 and ${t.minRecommendations} >= 0`,
    ),
    check('ustaad_level_rules_pct', sql`${t.minHelpfulPct} between 0 and 100`),
    check('ustaad_level_rules_multiplier', sql`${t.coinMultiplierBp} between 10000 and 30000`),
    // Bada and Master always need a staff approval row (locked, SR-8).
    check(
      'ustaad_level_rules_staff_review_locked',
      sql`${t.level} not in ('bada','master') or ${t.needsStaffReview}`,
    ),
  ],
);

/** Append-only (spec 23 § 9.1): reversals are new rows, never edits. Izzat is never money and never Coins. */
export const ustaadIzzatLedger = pgTable(
  'ustaad_izzat_ledger',
  {
    id: id(),
    memberId: member(),
    delta: integer().notNull(),
    reasonCode: text().notNull(),
    sourceType: text().notNull(),
    sourceId: uuid(),
    idemKey: text().notNull(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ustaad_izzat_ledger_idem_uq').on(t.idemKey),
    index().on(t.memberId, t.createdAt),
    index().on(t.actorId),
    check('ustaad_izzat_ledger_reason_valid', oneOf(t.reasonCode, USTAAD_IZZAT_REASONS)),
    check('ustaad_izzat_ledger_delta', sql`${t.delta} between -500 and 100 and ${t.delta} <> 0`),
    check('ustaad_izzat_ledger_source_format', sql`${t.sourceType} ~ '^[a-z_]{2,30}$'`),
    check('ustaad_izzat_ledger_idem_len', sql`char_length(${t.idemKey}) between 8 and 120`),
  ],
);

/** Counters, created with the member (spec 23 § 6.9): conditional `± 1` updates, nightly reconcile. */
export const ustaadMemberCounters = pgTable(
  'ustaad_member_counters',
  {
    memberId: uuid()
      .primaryKey()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    followers: integer().notNull().default(0),
    following: integer().notNull().default(0),
    posts: integer().notNull().default(0),
    answers: integer().notNull().default(0),
    bestAnswers: integer().notNull().default(0),
    helpfulVotes: integer().notNull().default(0),
    helpfulAnswers: integer().notNull().default(0),
    videosWatched: integer().notNull().default(0),
    recommendations: integer().notNull().default(0),
    /** May go negative after strikes; shown as 0. */
    izzat: integer().notNull().default(0),
    bestAnswers30d: integer().notNull().default(0),
    helpful30d: integer().notNull().default(0),
    /** Followers that count for levels (SR-9), refreshed by the qualified-followers job; the card shows it. */
    qualifiedFollowers: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'ustaad_member_counters_non_negative',
      sql`${t.followers} >= 0 and ${t.following} >= 0 and ${t.posts} >= 0 and ${t.answers} >= 0 and ${t.bestAnswers} >= 0 and ${t.helpfulVotes} >= 0 and ${t.helpfulAnswers} >= 0 and ${t.videosWatched} >= 0 and ${t.recommendations} >= 0 and ${t.bestAnswers30d} >= 0 and ${t.helpful30d} >= 0 and ${t.qualifiedFollowers} >= 0`,
    ),
  ],
);

export const ustaadBadges = pgTable(
  'ustaad_badges',
  {
    id: id(),
    code: text().notNull(),
    nameEn: text().notNull(),
    nameHi: text().notNull(),
    ruleEn: text().notNull(),
    ruleHi: text().notNull(),
    icon: text().notNull(),
    kind: text().notNull(),
    rule: jsonb().notNull(),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_badges_code_uq').on(t.code),
    index().on(t.updatedBy),
    check('ustaad_badges_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check('ustaad_badges_kind_valid', oneOf(t.kind, USTAAD_BADGE_KINDS)),
    check(
      'ustaad_badges_rule_typed',
      sql`${t.rule} ? 'schema_version' and (${t.rule} ->> 'kind') in (${sql.raw(USTAAD_BADGE_RULE_KINDS.map((k) => `'${k}'`).join(','))})`,
    ),
  ],
);

export const ustaadBadgeAwards = pgTable(
  'ustaad_badge_awards',
  {
    id: id(),
    memberId: member(),
    badgeCode: text().notNull(),
    awardedAt: ts().notNull().defaultNow(),
    revokedAt: ts(),
    revokedReasonCode: text(),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_badge_awards_active_uq')
      .on(t.memberId, t.badgeCode)
      .where(sql`${t.revokedAt} is null`),
    index().on(t.badgeCode),
    check(
      'ustaad_badge_awards_revoked_reason',
      sql`${t.revokedAt} is null or ${t.revokedReasonCode} is not null`,
    ),
  ],
);
