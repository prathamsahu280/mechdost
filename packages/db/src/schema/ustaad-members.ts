/**
 * Ustaad Network membership (spec 23 § 6.1, § 6.10; migration `ustaad_foundations`). One member row per user, kept
 * when the member leaves (status `left`, handle reserved) so a rejoin reuses it: no second handle, no double counts
 * (plan review focus 3). Written only by `repo/ustaad/members.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  APPLICATION_LINK_STATES,
  USTAAD_CORRECTION_MODES,
  USTAAD_DM_MODES,
  USTAAD_EVENT_ENTITIES,
  USTAAD_LANGS,
  USTAAD_LEVELS,
  USTAAD_MEMBER_STATUSES,
  USTAAD_RESTRICTED_MODES,
  USTAAD_SPECIALITY_CODES,
  USTAAD_SPECIALITY_STEPS,
  USTAAD_TRACKS,
  USTAAD_VERIFICATION_STATES,
  USTAAD_WORK_PLACES,
} from '@mechdost/shared/ustaad/codes';
import { citext, createdAt, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { partnerApplications } from './platform';
import { workshops } from './services';
import { nullOrOneOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';

/** Cities where the network is open (spec 23 § 15). No row or `enabled = false` = joins refused with USTAAD_REGION. */
export const ustaadReachCities = pgTable(
  'ustaad_reach_cities',
  {
    cityId: uuid()
      .primaryKey()
      .references(() => cities.id, { onDelete: 'restrict' }),
    enabled: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.updatedBy)],
);

export const ustaadMembers = pgTable(
  'ustaad_members',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Public handle, case-insensitive; kept reserved after leaving. */
    handle: citext().notNull(),
    displayName: text().notNull(),
    displayNameHi: text(),
    photoMediaId: uuid().references((): AnyPgColumn => ustaadMedia.id, { onDelete: 'set null' }),
    track: text().notNull(),
    level: text().notNull(),
    levelSince: ts().notNull().defaultNow(),
    status: text().notNull().default('active'),
    bannedUntil: ts(),
    /** F2: end of a moderation restriction (no posting); null with status `restricted` = until staff lift it. */
    restrictedUntil: ts(),
    verificationState: text().notNull().default('unverified'),
    verifiedAt: ts(),
    /** `none | minor_report | review` (spec 23 § 13): restricted mode turns analytics, suggestions, jobs, DMs off. */
    restrictedMode: text().notNull().default('none'),
    /** SR-2: perks and job posting frozen after a credential change on a Pakka+ account. */
    perksFrozenUntil: ts(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    areaLabel: text().notNull(),
    areaLabelHi: text(),
    pincode: text().notNull(),
    workPlace: text().notNull(),
    garageName: text(),
    showGarage: boolean().notNull().default(false),
    workshopId: uuid().references(() => workshops.id, { onDelete: 'set null' }),
    yearsClaimed: smallint().notNull().default(0),
    verifiedYears: smallint(),
    dmMode: text().notNull().default('request'),
    suggestMe: boolean().notNull().default(true),
    /** Null = the network default (`ustaad.correction.default_mode`). */
    correctionMode: text(),
    lang: text().notNull().default('hi'),
    dataSaver: boolean().notNull().default(true),
    /** Staff/official badge: set only by a super admin through its own route (SR-5). */
    official: boolean().notNull().default(false),
    founding: boolean().notNull().default(false),
    sourceApplicationId: uuid().references(() => partnerApplications.id, { onDelete: 'set null' }),
    joinedAt: ts().notNull().defaultNow(),
    leftAt: ts(),
    lastActiveAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('ustaad_members_user_uq').on(t.userId),
    uniqueIndex('ustaad_members_handle_uq').on(t.handle),
    index().on(t.cityId, t.level),
    index().on(t.status),
    index().on(t.lastActiveAt),
    index().on(t.workshopId),
    index().on(t.photoMediaId),
    index().on(t.sourceApplicationId),
    index().on(t.createdBy),
    check('ustaad_members_handle_format', sql`${t.handle} ~ '^[a-z0-9_]{3,24}$'`),
    check('ustaad_members_track_valid', oneOf(t.track, USTAAD_TRACKS)),
    check('ustaad_members_level_valid', oneOf(t.level, USTAAD_LEVELS)),
    // The junior track stays Chhotu; only the expert track climbs the Ustaad ladder.
    check(
      'ustaad_members_level_track',
      sql`(${t.track} = 'apprentice' and ${t.level} = 'apprentice') or (${t.track} = 'ustaad' and ${t.level} <> 'apprentice')`,
    ),
    check('ustaad_members_status_valid', oneOf(t.status, USTAAD_MEMBER_STATUSES)),
    check('ustaad_members_verification_valid', oneOf(t.verificationState, USTAAD_VERIFICATION_STATES)),
    check('ustaad_members_restricted_valid', oneOf(t.restrictedMode, USTAAD_RESTRICTED_MODES)),
    check('ustaad_members_work_place_valid', oneOf(t.workPlace, USTAAD_WORK_PLACES)),
    check('ustaad_members_dm_mode_valid', oneOf(t.dmMode, USTAAD_DM_MODES)),
    check('ustaad_members_correction_valid', nullOrOneOf(t.correctionMode, USTAAD_CORRECTION_MODES)),
    check('ustaad_members_lang_valid', oneOf(t.lang, USTAAD_LANGS)),
    check('ustaad_members_pincode_format', sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check('ustaad_members_years', sql`${t.yearsClaimed} between 0 and 60`),
    check(
      'ustaad_members_verified_years',
      sql`${t.verifiedYears} is null or ${t.verifiedYears} between 0 and 60`,
    ),
    check('ustaad_members_left_at', sql`(${t.status} = 'left') = (${t.leftAt} is not null)`),
    check('ustaad_members_banned_until', sql`${t.bannedUntil} is null or ${t.status} = 'banned'`),
    check('ustaad_members_restricted_until', sql`${t.restrictedUntil} is null or ${t.status} = 'restricted'`),
  ],
);

export const ustaadMemberSpecialities = pgTable(
  'ustaad_member_specialities',
  {
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    code: text().notNull(),
    step: text().notNull().default('shuru'),
    earnedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.code] }),
    index().on(t.code, t.step),
    check('ustaad_member_specialities_code_valid', oneOf(t.code, USTAAD_SPECIALITY_CODES)),
    check('ustaad_member_specialities_step_valid', oneOf(t.step, USTAAD_SPECIALITY_STEPS)),
  ],
);

/** Append-only timeline of every network state change (spec 23 § 6.1; hard rule 16). */
export const ustaadEvents = pgTable(
  'ustaad_events',
  {
    id: id(),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    kind: text().notNull(),
    fromStatus: text(),
    toStatus: text(),
    reasonCode: text(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorRole: text().notNull(),
    cityId: uuid().references(() => cities.id, { onDelete: 'set null' }),
    props: jsonb()
      .notNull()
      .default(sql`'{"schema_version":1}'::jsonb`),
    occurredAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.entityType, t.entityId, t.occurredAt),
    index('ustaad_events_occurred_brin').using('brin', t.occurredAt),
    index().on(t.actorId),
    index().on(t.cityId),
    check('ustaad_events_entity_valid', oneOf(t.entityType, USTAAD_EVENT_ENTITIES)),
    check('ustaad_events_kind_format', sql`${t.kind} ~ '^[a-z][a-z0-9_]{1,60}$'`),
    check('ustaad_events_actor_role_format', sql`${t.actorRole} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check('ustaad_events_props_versioned', sql`${t.props} ? 'schema_version'`),
  ],
);

/**
 * Old "Apply as a mechanic" applications mapped to invites (spec 23 § 4a). Never a membership by itself: the member's
 * own required consent is needed. Written by the mapping script (workstream B) and the join.
 */
export const ustaadApplicationLinks = pgTable(
  'ustaad_application_links',
  {
    id: id(),
    applicationId: uuid()
      .notNull()
      .references(() => partnerApplications.id, { onDelete: 'restrict' }),
    /** sha256 of the E.164 phone (dedupe and matching at join); the phone itself stays on the application. */
    phoneHash: text().notNull(),
    prefill: jsonb()
      .notNull()
      .default(sql`'{"schema_version":1}'::jsonb`),
    status: text().notNull().default('invited'),
    memberId: uuid().references(() => ustaadMembers.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_application_links_application_uq').on(t.applicationId),
    index().on(t.phoneHash),
    index().on(t.memberId),
    check('ustaad_application_links_status_valid', oneOf(t.status, APPLICATION_LINK_STATES)),
    check('ustaad_application_links_phone_hash', sql`${t.phoneHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'ustaad_application_links_joined_member',
      sql`(${t.status} = 'joined') = (${t.memberId} is not null)`,
    ),
    check('ustaad_application_links_prefill_versioned', sql`${t.prefill} ? 'schema_version'`),
  ],
);

/** Reserved names (SR-4): `skeleton` = TR39 confusable skeleton of the NFKC-folded name (workstream B fills). */
export const ustaadReservedNames = pgTable(
  'ustaad_reserved_names',
  {
    id: id(),
    name: text().notNull(),
    skeleton: text().notNull(),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_reserved_names_skeleton_uq').on(t.skeleton),
    index().on(t.createdBy),
    check('ustaad_reserved_names_len', sql`char_length(${t.name}) between 2 and 60`),
  ],
);
