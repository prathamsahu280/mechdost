/**
 * Reports, moderation actions, strikes, word lists, report reasons and the removed-content archive (spec 23 § 6.7,
 * § 13; SR-39; migration `ustaad_moderation`). Workstream F owns the repositories. Actions are append-only; a second
 * staff member is recorded for four-eyes actions; the archive is purged after `retain_until` unless on legal hold.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  MODERATION_ACTIONS,
  REPORT_CLOCKS,
  REPORT_REASONS,
  REPORT_SOURCES,
  REPORT_TARGETS,
  STRIKE_STATES,
  WORD_LISTS,
} from '@mechdost/shared/ustaad/codes';
import { USTAAD_REPORT_STATUSES } from '@mechdost/shared/state';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users } from './identity';
import { supportTickets } from './platform';
import { oneOf } from './ustaad-common';
import { ustaadMembers } from './ustaad-members';

const TARGETS = [...REPORT_TARGETS, 'media'] as const;

export const ustaadReports = pgTable(
  'ustaad_reports',
  {
    id: id(),
    code: text().notNull(),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    /** Null for staff, automatic and legal sources. */
    reporterId: uuid().references(() => ustaadMembers.id, { onDelete: 'set null' }),
    cityId: uuid().references(() => cities.id, { onDelete: 'set null' }),
    source: text().notNull().default('member'),
    reasonCode: text().notNull(),
    note: text(),
    clock: text().notNull().default('standard_24h'),
    dueAt: ts().notNull(),
    status: text().notNull().default('open'),
    assignedTo: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
    appealTicketId: uuid().references(() => supportTickets.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_reports_code_uq').on(t.code),
    uniqueIndex('ustaad_reports_one_open_uq')
      .on(t.targetType, t.targetId, t.reporterId)
      .where(sql`${t.status} in ('open','in_review') and ${t.reporterId} is not null`),
    index().on(t.status, t.dueAt),
    index().on(t.cityId, t.status, t.dueAt),
    index().on(t.targetType, t.targetId),
    index().on(t.reporterId),
    index().on(t.assignedTo),
    index().on(t.decidedBy),
    index().on(t.appealTicketId),
    check('ustaad_reports_code_format', sql`${t.code} ~ '^UR-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'`),
    check('ustaad_reports_target_valid', oneOf(t.targetType, TARGETS)),
    check('ustaad_reports_source_valid', oneOf(t.source, REPORT_SOURCES)),
    check('ustaad_reports_reason_valid', oneOf(t.reasonCode, REPORT_REASONS)),
    check('ustaad_reports_clock_valid', oneOf(t.clock, REPORT_CLOCKS)),
    check('ustaad_reports_status_valid', oneOf(t.status, USTAAD_REPORT_STATUSES)),
    check('ustaad_reports_member_reporter', sql`${t.source} <> 'member' or ${t.reporterId} is not null`),
    check('ustaad_reports_note_len', sql`${t.note} is null or char_length(${t.note}) <= 500`),
  ],
);

/** Append-only; every action reason-coded and audited (spec 23 § 13). */
export const ustaadModerationActions = pgTable(
  'ustaad_moderation_actions',
  {
    id: id(),
    reportId: uuid().references(() => ustaadReports.id, { onDelete: 'restrict' }),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    action: text().notNull(),
    reasonCode: text().notNull(),
    days: integer(),
    actorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    secondActorId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.targetType, t.targetId, t.createdAt),
    index().on(t.reportId),
    index().on(t.actorId),
    index().on(t.secondActorId),
    check('ustaad_moderation_actions_target_valid', oneOf(t.targetType, TARGETS)),
    check('ustaad_moderation_actions_action_valid', oneOf(t.action, MODERATION_ACTIONS)),
    check('ustaad_moderation_actions_reason_format', sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check(
      'ustaad_moderation_actions_four_eyes',
      sql`${t.secondActorId} is null or ${t.secondActorId} <> ${t.actorId}`,
    ),
    check('ustaad_moderation_actions_days', sql`${t.days} is null or ${t.days} between 1 and 36500`),
  ],
);

export const ustaadStrikes = pgTable(
  'ustaad_strikes',
  {
    id: id(),
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    reasonCode: text().notNull(),
    izzatDelta: integer().notNull().default(0),
    expiresAt: ts(),
    appealTicketId: uuid().references(() => supportTickets.id, { onDelete: 'set null' }),
    status: text().notNull().default('active'),
    actionId: uuid().references(() => ustaadModerationActions.id, { onDelete: 'restrict' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.memberId, t.status),
    index().on(t.appealTicketId),
    index().on(t.actionId),
    check('ustaad_strikes_status_valid', oneOf(t.status, STRIKE_STATES)),
    check('ustaad_strikes_delta', sql`${t.izzatDelta} between -500 and 0`),
    check('ustaad_strikes_reason_format', sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{1,40}$'`),
  ],
);

/** Admin lists: banned words, scam phrases, protected words, PII patterns, link domains, corrections. */
export const ustaadWordLists = pgTable(
  'ustaad_word_lists',
  {
    id: id(),
    list: text().notNull(),
    phrase: text().notNull(),
    phraseNorm: text().notNull(),
    /** For `correction`: what the phrase becomes. */
    replacement: text(),
    lang: text().notNull().default('any'),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_word_lists_uq').on(t.list, t.phraseNorm),
    index().on(t.list, t.active),
    index().on(t.updatedBy),
    check('ustaad_word_lists_list_valid', oneOf(t.list, WORD_LISTS)),
    check('ustaad_word_lists_lang_valid', oneOf(t.lang, ['any', 'hi', 'en', 'hinglish', 'cg'])),
    check('ustaad_word_lists_len', sql`char_length(${t.phrase}) between 1 and 120`),
    check('ustaad_word_lists_replacement', sql`(${t.list} = 'correction') = (${t.replacement} is not null)`),
  ],
);

export const ustaadReportReasons = pgTable(
  'ustaad_report_reasons',
  {
    code: text().primaryKey(),
    labelEn: text().notNull(),
    labelHi: text().notNull(),
    active: boolean().notNull().default(true),
    defaultClock: text().notNull().default('standard_24h'),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.updatedBy),
    check('ustaad_report_reasons_code_valid', oneOf(t.code, REPORT_REASONS)),
    check('ustaad_report_reasons_clock_valid', oneOf(t.defaultClock, REPORT_CLOCKS)),
    // `other` cannot be turned off (spec 23 § 6.7).
    check('ustaad_report_reasons_other_on', sql`${t.code} <> 'other' or ${t.active}`),
  ],
);

export const ustaadRemovedArchive = pgTable(
  'ustaad_removed_archive',
  {
    id: id(),
    targetType: text().notNull(),
    targetId: uuid().notNull(),
    snapshot: jsonb().notNull(),
    removedAt: ts().notNull().defaultNow(),
    retainUntil: ts().notNull(),
    /** Set for legal holds and child-safety evidence; the purge job skips held rows. */
    legalHold: text(),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.targetType, t.targetId),
    index('ustaad_removed_archive_purge_idx')
      .on(t.retainUntil)
      .where(sql`${t.legalHold} is null`),
    check('ustaad_removed_archive_target_valid', oneOf(t.targetType, TARGETS)),
    check('ustaad_removed_archive_retain', sql`${t.retainUntil} > ${t.removedAt}`),
    check('ustaad_removed_archive_versioned', sql`${t.snapshot} ? 'schema_version'`),
  ],
);
