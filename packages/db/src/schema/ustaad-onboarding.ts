/**
 * First-time tutorial and coach-marks (spec 23 flow 15, § 6.10; migration `ustaad_identity`). Admin-editable copy in
 * English and Hindi (hard rules 8 and 10); per-member progress. Workstream B owns the repositories.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { COACHMARK_TARGETS } from '@mechdost/shared/ustaad/codes';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { users } from './identity';
import { allOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';

export const ustaadTutorialCards = pgTable(
  'ustaad_tutorial_cards',
  {
    id: id(),
    code: text().notNull(),
    position: smallint().notNull(),
    titleEn: text().notNull(),
    titleHi: text().notNull(),
    bodyEn: text().notNull(),
    bodyHi: text().notNull(),
    imageMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    audioEnMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    audioHiMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_tutorial_cards_code_uq').on(t.code),
    index().on(t.active, t.position),
    index().on(t.imageMediaId),
    index().on(t.audioEnMediaId),
    index().on(t.audioHiMediaId),
    index().on(t.updatedBy),
    check('ustaad_tutorial_cards_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,40}$'`),
    check(
      'ustaad_tutorial_cards_len',
      sql`char_length(${t.titleEn}) <= 80 and char_length(${t.titleHi}) <= 120 and char_length(${t.bodyEn}) <= 300 and char_length(${t.bodyHi}) <= 400`,
    ),
  ],
);

export const ustaadCoachmarks = pgTable(
  'ustaad_coachmarks',
  {
    id: id(),
    target: text().notNull(),
    textEn: text().notNull(),
    textHi: text().notNull(),
    position: smallint().notNull(),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_coachmarks_target_uq').on(t.target),
    index().on(t.updatedBy),
    check('ustaad_coachmarks_target_valid', oneOf(t.target, COACHMARK_TARGETS)),
    check('ustaad_coachmarks_len', sql`char_length(${t.textEn}) <= 140 and char_length(${t.textHi}) <= 200`),
  ],
);

export const ustaadMemberOnboarding = pgTable(
  'ustaad_member_onboarding',
  {
    memberId: uuid()
      .primaryKey()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    tutorialCompletedAt: ts(),
    tutorialSkippedAt: ts(),
    lastCard: smallint(),
    coachmarksSeen: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [check('ustaad_member_onboarding_coachmarks_valid', allOf(t.coachmarksSeen, COACHMARK_TARGETS))],
);
