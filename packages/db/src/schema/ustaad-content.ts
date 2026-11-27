/**
 * Feed content: posts and stories, media slots, polls, tags, reactions, saves, comments, counters, promotions and link
 * previews (spec 23 § 6.3, § 6.10, § 7.4; migration `ustaad_feed`). Workstream D owns the repositories. Counters change
 * only with `ON CONFLICT DO NOTHING RETURNING` + a conditional `± 1` (§ 6.9). Promotions are MechDost-authored only:
 * there is no brand or advertiser column (SR-41).
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
  CONTENT_TYPES,
  CORRECTION_APPLIED,
  LINK_PREVIEW_STATES,
  POST_KINDS,
  POST_TEMPLATES,
  PROMOTION_SLOTS,
  PROMOTION_STATES,
  PROMOTION_TARGETS,
  TAG_GROUPS,
  TAG_SUGGESTION_STATES,
  USTAAD_SEGMENT_CODES,
} from '@mechdost/shared/ustaad/codes';
import { USTAAD_CONTENT_STATUSES } from '@mechdost/shared/state';
import { INTERNAL_PATH_SQL_FORBIDDEN, INTERNAL_PATH_SQL_RE } from '@mechdost/shared/ustaad/paths';
import { VIDEO_PROVIDERS } from '@mechdost/shared/ustaad/video-links';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { cities } from './geography';
import { users, vehicleModels } from './identity';
import { allOf, nullOrOneOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';
import { ustaadAnswers, ustaadQuestions } from './ustaad-qa';

const member = () =>
  uuid()
    .notNull()
    .references(() => ustaadMembers.id, { onDelete: 'restrict' });

export const ustaadTags = pgTable(
  'ustaad_tags',
  {
    id: id(),
    slug: text().notNull(),
    nameEn: text().notNull(),
    nameHi: text().notNull(),
    group: text().notNull(),
    /** NFC-normalised, lower-case spellings that resolve to this tag ("battri" → #battery). */
    aliases: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean().notNull().default(true),
    mergedIntoId: uuid().references((): AnyPgColumn => ustaadTags.id, { onDelete: 'set null' }),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_tags_slug_uq').on(t.slug),
    index('ustaad_tags_aliases_gin').using('gin', t.aliases),
    index('ustaad_tags_name_trgm').using('gin', sql`${t.nameEn} gin_trgm_ops`),
    index().on(t.mergedIntoId),
    index().on(t.updatedBy),
    check('ustaad_tags_slug_format', sql`${t.slug} ~ '^[a-z0-9][a-z0-9_]{1,39}$'`),
    check('ustaad_tags_group_valid', oneOf(t.group, TAG_GROUPS)),
    check('ustaad_tags_not_self_merge', sql`${t.mergedIntoId} is null or ${t.mergedIntoId} <> ${t.id}`),
  ],
);

export const ustaadTagSuggestions = pgTable(
  'ustaad_tag_suggestions',
  {
    id: id(),
    memberId: member(),
    text: text().notNull(),
    status: text().notNull().default('open'),
    tagId: uuid().references(() => ustaadTags.id, { onDelete: 'set null' }),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.status),
    index().on(t.memberId),
    index().on(t.tagId),
    index().on(t.decidedBy),
    check('ustaad_tag_suggestions_status_valid', oneOf(t.status, TAG_SUGGESTION_STATES)),
    check('ustaad_tag_suggestions_len', sql`char_length(${t.text}) between 2 and 40`),
  ],
);

export const ustaadPosts = pgTable(
  'ustaad_posts',
  {
    id: id(),
    authorId: member(),
    cityId: uuid()
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    kind: text().notNull(),
    template: text(),
    contentType: text().notNull().default('ugc'),
    body: text(),
    bodyOriginal: text(),
    correction: text().notNull().default('none'),
    fixSymptom: text(),
    fixCause: text(),
    fixFix: text(),
    segmentCode: text(),
    vehicleModelId: uuid().references(() => vehicleModels.id, { onDelete: 'set null' }),
    linkUrl: text(),
    // Video links (spec 23 § 10b): set only for a recognised video URL; the player and thumbnail URLs are rebuilt from
    // the id. Title and author come from oEmbed and are screened with the post text.
    videoProvider: text(),
    videoId: text(),
    videoStartS: integer(),
    linkTitle: text(),
    linkAuthor: text(),
    aiGenerated: boolean().notNull().default(false),
    status: text().notNull().default('visible'),
    heldReasonCode: text(),
    expiresAt: ts(),
    idemKey: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.authorId, t.createdAt.desc()),
    index().on(t.cityId, t.status, t.createdAt.desc()),
    index('ustaad_posts_story_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.kind} = 'story'`),
    index().on(t.vehicleModelId),
    uniqueIndex('ustaad_posts_idem_uq')
      .on(t.authorId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    check('ustaad_posts_kind_valid', oneOf(t.kind, POST_KINDS)),
    check('ustaad_posts_template_valid', nullOrOneOf(t.template, POST_TEMPLATES)),
    check('ustaad_posts_content_type_valid', oneOf(t.contentType, CONTENT_TYPES)),
    check('ustaad_posts_correction_valid', oneOf(t.correction, CORRECTION_APPLIED)),
    check('ustaad_posts_status_valid', oneOf(t.status, USTAAD_CONTENT_STATUSES)),
    check('ustaad_posts_segment_valid', nullOrOneOf(t.segmentCode, USTAAD_SEGMENT_CODES)),
    check('ustaad_posts_story_expires', sql`(${t.kind} = 'story') = (${t.expiresAt} is not null)`),
    check('ustaad_posts_link_https', sql`${t.linkUrl} is null or ${t.linkUrl} ~ '^https?://'`),
    check('ustaad_posts_video_provider_valid', nullOrOneOf(t.videoProvider, VIDEO_PROVIDERS)),
    check(
      'ustaad_posts_video_shape',
      sql`(${t.videoProvider} is null) = (${t.videoId} is null) and (${t.videoId} is null or (${t.videoId} ~ '^[A-Za-z0-9_-]{11}$' and ${t.linkUrl} is not null)) and (${t.videoStartS} is null or (${t.videoId} is not null and ${t.videoStartS} between 0 and 43200))`,
    ),
    check(
      'ustaad_posts_link_meta_len',
      sql`(${t.linkTitle} is null or char_length(${t.linkTitle}) <= 200) and (${t.linkAuthor} is null or char_length(${t.linkAuthor}) <= 100)`,
    ),
    check(
      'ustaad_posts_len',
      sql`(${t.body} is null or char_length(${t.body}) <= 3000) and (${t.fixSymptom} is null or char_length(${t.fixSymptom}) <= 500) and (${t.fixCause} is null or char_length(${t.fixCause}) <= 500) and (${t.fixFix} is null or char_length(${t.fixFix}) <= 500)`,
    ),
  ],
);

export const ustaadPostMedia = pgTable(
  'ustaad_post_media',
  {
    postId: uuid()
      .notNull()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    mediaId: uuid()
      .notNull()
      .references(() => ustaadMedia.id, { onDelete: 'restrict' }),
    position: smallint().notNull(),
    role: text(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    index().on(t.mediaId),
    check('ustaad_post_media_role_valid', nullOrOneOf(t.role, ['before', 'after'])),
    check('ustaad_post_media_position', sql`${t.position} between 0 and 9`),
  ],
);

export const ustaadPolls = pgTable(
  'ustaad_polls',
  {
    id: id(),
    postId: uuid()
      .notNull()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    closesAt: ts().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ustaad_polls_post_uq').on(t.postId)],
);

export const ustaadPollOptions = pgTable(
  'ustaad_poll_options',
  {
    id: id(),
    pollId: uuid()
      .notNull()
      .references(() => ustaadPolls.id, { onDelete: 'cascade' }),
    label: text().notNull(),
    position: smallint().notNull(),
    votes: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('ustaad_poll_options_position_uq').on(t.pollId, t.position),
    check('ustaad_poll_options_len', sql`char_length(${t.label}) between 1 and 80`),
    check('ustaad_poll_options_votes', sql`${t.votes} >= 0`),
  ],
);

export const ustaadPollVotes = pgTable(
  'ustaad_poll_votes',
  {
    pollId: uuid()
      .notNull()
      .references(() => ustaadPolls.id, { onDelete: 'cascade' }),
    optionId: uuid()
      .notNull()
      .references(() => ustaadPollOptions.id, { onDelete: 'cascade' }),
    memberId: member(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.memberId] }), index().on(t.optionId), index().on(t.memberId)],
);

/** A tag on a post or on a question (exactly one). ≤ 5 per item (repository + `ustaad.tags.max_per_post`). */
export const ustaadPostTags = pgTable(
  'ustaad_post_tags',
  {
    id: id(),
    postId: uuid().references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    questionId: uuid().references(() => ustaadQuestions.id, { onDelete: 'cascade' }),
    tagId: uuid()
      .notNull()
      .references(() => ustaadTags.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ustaad_post_tags_post_uq')
      .on(t.postId, t.tagId)
      .where(sql`${t.postId} is not null`),
    uniqueIndex('ustaad_post_tags_question_uq')
      .on(t.questionId, t.tagId)
      .where(sql`${t.questionId} is not null`),
    index().on(t.tagId, t.createdAt.desc()),
    index().on(t.questionId),
    check('ustaad_post_tags_one_target', sql`num_nonnulls(${t.postId}, ${t.questionId}) = 1`),
  ],
);

export const ustaadReactions = pgTable(
  'ustaad_reactions',
  {
    postId: uuid()
      .notNull()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    memberId: member(),
    kind: text().notNull().default('like'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.memberId, t.kind] }),
    index().on(t.memberId, t.createdAt),
    check('ustaad_reactions_kind_valid', oneOf(t.kind, ['like', 'useful'])),
  ],
);

export const ustaadSaves = pgTable(
  'ustaad_saves',
  {
    postId: uuid()
      .notNull()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    memberId: member(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.memberId] }), index().on(t.memberId, t.createdAt.desc())],
);

export const ustaadComments = pgTable(
  'ustaad_comments',
  {
    id: id(),
    postId: uuid().references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    answerId: uuid().references(() => ustaadAnswers.id, { onDelete: 'cascade' }),
    authorId: member(),
    parentId: uuid().references((): AnyPgColumn => ustaadComments.id, { onDelete: 'cascade' }),
    body: text(),
    bodyOriginal: text(),
    correction: text().notNull().default('none'),
    mediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    status: text().notNull().default('visible'),
    idemKey: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.postId, t.createdAt),
    index().on(t.answerId, t.createdAt),
    index().on(t.authorId, t.createdAt),
    index().on(t.parentId),
    index().on(t.mediaId),
    uniqueIndex('ustaad_comments_idem_uq')
      .on(t.authorId, t.idemKey)
      .where(sql`${t.idemKey} is not null`),
    check('ustaad_comments_one_target', sql`num_nonnulls(${t.postId}, ${t.answerId}) = 1`),
    check('ustaad_comments_status_valid', oneOf(t.status, USTAAD_CONTENT_STATUSES)),
    check('ustaad_comments_correction_valid', oneOf(t.correction, CORRECTION_APPLIED)),
    check('ustaad_comments_content', sql`${t.body} is not null or ${t.mediaId} is not null`),
    check('ustaad_comments_len', sql`${t.body} is null or char_length(${t.body}) <= 1000`),
    check('ustaad_comments_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export const ustaadStoryViews = pgTable(
  'ustaad_story_views',
  {
    postId: uuid()
      .notNull()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    viewerId: uuid()
      .notNull()
      .references(() => ustaadMembers.id, { onDelete: 'cascade' }),
    viewedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.viewerId] }), index().on(t.viewerId)],
);

export const ustaadPostCounters = pgTable(
  'ustaad_post_counters',
  {
    postId: uuid()
      .primaryKey()
      .references(() => ustaadPosts.id, { onDelete: 'cascade' }),
    likes: integer().notNull().default(0),
    /** "Kaam ki baat / Useful" reactions (founder Q-UI-3, 2026-11-27); shown always, never Izzat. */
    useful: integer().notNull().default(0),
    comments: integer().notNull().default(0),
    saves: integer().notNull().default(0),
    shares: integer().notNull().default(0),
    views: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'ustaad_post_counters_non_negative',
      sql`${t.likes} >= 0 and ${t.useful} >= 0 and ${t.comments} >= 0 and ${t.saves} >= 0 and ${t.shares} >= 0 and ${t.views} >= 0`,
    ),
  ],
);

/** MechDost's own promotions only, always labelled "Sponsored" / "प्रायोजित" (locked label, not a column). */
export const ustaadPromotions = pgTable(
  'ustaad_promotions',
  {
    id: id(),
    slot: text().notNull(),
    titleEn: text().notNull(),
    titleHi: text().notNull(),
    bodyEn: text().notNull().default(''),
    bodyHi: text().notNull().default(''),
    target: text().notNull(),
    targetId: text().notNull(),
    cityIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    segmentCodes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startsAt: ts().notNull(),
    endsAt: ts().notNull(),
    status: text().notNull().default('draft'),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.slot, t.status, t.startsAt),
    index().on(t.createdBy),
    check('ustaad_promotions_slot_valid', oneOf(t.slot, PROMOTION_SLOTS)),
    check('ustaad_promotions_target_valid', oneOf(t.target, PROMOTION_TARGETS)),
    check('ustaad_promotions_status_valid', oneOf(t.status, PROMOTION_STATES)),
    check('ustaad_promotions_segments_valid', allOf(t.segmentCodes, USTAAD_SEGMENT_CODES)),
    check('ustaad_promotions_window', sql`${t.endsAt} > ${t.startsAt}`),
    // Strict internal path (security review 2026-11-26): the same rule as `isSafeInternalPath` in shared.
    check(
      'ustaad_promotions_internal_target',
      sql`${t.target} <> 'url_internal' or (${t.targetId} ~ ${sql.raw(`'${INTERNAL_PATH_SQL_RE}'`)} and ${t.targetId} !~ ${sql.raw(`'${INTERNAL_PATH_SQL_FORBIDDEN}'`)} and char_length(${t.targetId}) <= 300)`,
    ),
  ],
);

/** Link previews from the isolated preview worker (SR-22–24); one row per URL hash. */
export const ustaadLinkPreviews = pgTable(
  'ustaad_link_previews',
  {
    urlHash: text().primaryKey(),
    finalHost: text(),
    title: text(),
    description: text(),
    /** oEmbed `author_name` for video links (spec 23 § 10b). */
    authorName: text(),
    imageMediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    status: text().notNull(),
    checkedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.imageMediaId),
    index().on(t.checkedAt),
    check('ustaad_link_previews_hash', sql`${t.urlHash} ~ '^[0-9a-f]{64}$'`),
    check('ustaad_link_previews_status_valid', oneOf(t.status, LINK_PREVIEW_STATES)),
    check(
      'ustaad_link_previews_len',
      sql`(${t.title} is null or char_length(${t.title}) <= 200) and (${t.description} is null or char_length(${t.description}) <= 500) and (${t.authorName} is null or char_length(${t.authorName}) <= 100)`,
    ),
  ],
);
