/**
 * Q&A and Learn (spec 23 § 6.3, § 7.5; migration `ustaad_qa`). Workstream C owns the repositories. One best answer per
 * question is `ustaad_questions.best_answer_id` (a trigger checks it belongs to the question); one vote per member and
 * answer is the primary key; a member cannot vote for their own answer (trigger).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  CORRECTION_APPLIED,
  LEARNING_KINDS,
  LEARNING_LABELS,
  QUESTION_REACH,
  SAFETY_TAGS,
  USTAAD_SEGMENT_CODES,
  USTAAD_WORK_CODES,
} from '@mechdost/shared/ustaad/codes';
import { USTAAD_CONTENT_STATUSES, USTAAD_QUESTION_STATUSES } from '@mechdost/shared/state';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { products } from './catalogue';
import { cities } from './geography';
import { users, vehicleModels } from './identity';
import { nullOrOneOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';

const member = () =>
  uuid()
    .notNull()
    .references(() => ustaadMembers.id, { onDelete: 'restrict' });

export const ustaadQuestions = pgTable(
  'ustaad_questions',
  {
    id: id(),
    code: text().notNull(),
    askerId: member(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    reach: text().notNull().default('city'),
    segmentCode: text(),
    vehicleModelId: uuid().references(() => vehicleModels.id, { onDelete: 'set null' }),
    workCode: text(),
    title: text().notNull(),
    body: text(),
    bodyOriginal: text(),
    correction: text().notNull().default('none'),
    voiceMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    status: text().notNull().default('open'),
    bestAnswerId: uuid().references((): AnyPgColumn => ustaadAnswers.id, { onDelete: 'set null' }),
    safetyTag: text(),
    hideGarage: boolean().notNull().default(false),
    idemKey: text(),
    widenedAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_questions_code_uq').on(t.code),
    uniqueIndex('ustaad_questions_idem_uq')
      .on(t.askerId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    index().on(t.cityId, t.status, t.createdAt.desc()),
    index().on(t.segmentCode, t.workCode, t.createdAt.desc()),
    index().on(t.askerId, t.createdAt),
    index().on(t.vehicleModelId),
    index().on(t.voiceMediaId),
    index().on(t.bestAnswerId),
    check('ustaad_questions_code_format', sql`${t.code} ~ '^UQ-[A-Z]{3}-[0-9]{4}-[A-Z2-7]{6}$'`),
    check('ustaad_questions_status_valid', oneOf(t.status, USTAAD_QUESTION_STATUSES)),
    check('ustaad_questions_reach_valid', oneOf(t.reach, QUESTION_REACH)),
    check('ustaad_questions_segment_valid', nullOrOneOf(t.segmentCode, USTAAD_SEGMENT_CODES)),
    check('ustaad_questions_work_valid', nullOrOneOf(t.workCode, USTAAD_WORK_CODES)),
    check('ustaad_questions_safety_valid', nullOrOneOf(t.safetyTag, SAFETY_TAGS)),
    check('ustaad_questions_correction_valid', oneOf(t.correction, CORRECTION_APPLIED)),
    check(
      'ustaad_questions_len',
      sql`char_length(${t.title}) between 1 and 200 and (${t.body} is null or char_length(${t.body}) <= 2000)`,
    ),
    check('ustaad_questions_solved_best', sql`${t.status} <> 'solved' or ${t.bestAnswerId} is not null`),
  ],
);

export const ustaadAnswers = pgTable(
  'ustaad_answers',
  {
    id: id(),
    questionId: uuid()
      .notNull()
      .references((): AnyPgColumn => ustaadQuestions.id, { onDelete: 'restrict' }),
    authorId: member(),
    body: text(),
    bodyOriginal: text(),
    correction: text().notNull().default('none'),
    voiceMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    status: text().notNull().default('visible'),
    /** False while the author is `ustaad_pending`; flipped on verification approval (spec 23 § 7.1). */
    countsForLevels: boolean().notNull().default(false),
    helpfulCount: integer().notNull().default(0),
    idemKey: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.questionId, t.createdAt),
    index().on(t.authorId, t.createdAt),
    index().on(t.voiceMediaId),
    uniqueIndex('ustaad_answers_idem_uq')
      .on(t.authorId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    check('ustaad_answers_status_valid', oneOf(t.status, USTAAD_CONTENT_STATUSES)),
    check('ustaad_answers_correction_valid', oneOf(t.correction, CORRECTION_APPLIED)),
    check('ustaad_answers_helpful_non_negative', sql`${t.helpfulCount} >= 0`),
    check('ustaad_answers_has_content', sql`${t.body} is not null or ${t.voiceMediaId} is not null`),
    check('ustaad_answers_len', sql`${t.body} is null or char_length(${t.body}) <= 2000`),
  ],
);

export const ustaadAnswerVotes = pgTable(
  'ustaad_answer_votes',
  {
    answerId: uuid()
      .notNull()
      .references(() => ustaadAnswers.id, { onDelete: 'cascade' }),
    voterId: member(),
    /** Ring check (SR-10): a flagged vote weighs 0 until reviewed. */
    counted: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.answerId, t.voterId] }), index().on(t.voterId, t.createdAt)],
);

/** "Parts used in this fix" under a best answer: MechDost catalogue links, ≤ 5 (repository). */
export const ustaadAnswerParts = pgTable(
  'ustaad_answer_parts',
  {
    answerId: uuid()
      .notNull()
      .references(() => ustaadAnswers.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    addedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.answerId, t.productId] }), index().on(t.productId), index().on(t.addedBy)],
);

export const ustaadCourses = pgTable(
  'ustaad_courses',
  {
    id: id(),
    code: text().notNull(),
    titleEn: text().notNull(),
    titleHi: text().notNull(),
    position: smallint().notNull().default(0),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_courses_code_uq').on(t.code),
    index().on(t.active, t.position),
    index().on(t.updatedBy),
    check('ustaad_courses_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,40}$'`),
  ],
);

export const ustaadLearningResources = pgTable(
  'ustaad_learning_resources',
  {
    id: id(),
    courseId: uuid().references(() => ustaadCourses.id, { onDelete: 'set null' }),
    kind: text().notNull(),
    titleEn: text().notNull(),
    titleHi: text().notNull(),
    segmentCode: text(),
    workCode: text(),
    durationS: integer(),
    mediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'restrict' }),
    url: text(),
    label: text().notNull().default('none'),
    position: smallint().notNull().default(0),
    active: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.courseId, t.position),
    index().on(t.segmentCode, t.workCode),
    index().on(t.mediaId),
    index().on(t.updatedBy),
    check('ustaad_learning_resources_kind_valid', oneOf(t.kind, LEARNING_KINDS)),
    check('ustaad_learning_resources_label_valid', oneOf(t.label, LEARNING_LABELS)),
    check('ustaad_learning_resources_segment_valid', nullOrOneOf(t.segmentCode, USTAAD_SEGMENT_CODES)),
    check('ustaad_learning_resources_work_valid', nullOrOneOf(t.workCode, USTAAD_WORK_CODES)),
    check(
      'ustaad_learning_resources_source',
      sql`(${t.kind} = 'hosted_video' and ${t.mediaId} is not null and ${t.url} is null) or (${t.kind} = 'external_link' and ${t.url} is not null and ${t.mediaId} is null)`,
    ),
    check('ustaad_learning_resources_url', sql`${t.url} is null or ${t.url} ~ '^https://'`),
    check('ustaad_learning_resources_duration', sql`${t.durationS} is null or ${t.durationS} > 0`),
  ],
);

export const ustaadLearningProgress = pgTable(
  'ustaad_learning_progress',
  {
    memberId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    resourceId: uuid()
      .notNull()
      .references(() => ustaadLearningResources.id, { onDelete: 'cascade' }),
    watchedSeconds: integer().notNull().default(0),
    completedAt: ts(),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.resourceId] }),
    index().on(t.resourceId),
    check('ustaad_learning_progress_watched', sql`${t.watchedSeconds} >= 0`),
  ],
);
