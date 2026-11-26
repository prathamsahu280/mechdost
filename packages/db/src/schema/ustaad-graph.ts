/**
 * Social graph and messages (spec 23 § 6.2; migration `ustaad_feed`). Workstream D owns the repositories. Follows are
 * hard-deleted on unfollow (the `ustaad_events` row keeps history); pairs that are symmetric are stored ordered
 * (`low_id < high_id`); a block removes follows and the connection both ways in the same transaction (repository).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  MESSAGE_HOLD_REASONS,
  MESSAGE_KINDS,
  PROMOTION_HIDE_REASONS,
  USTAAD_DAILY_COUNTER_KINDS,
} from '@mechdost/shared/ustaad/codes';
import {
  USTAAD_CONNECTION_STATUSES,
  USTAAD_MENTORSHIP_STATUSES,
  USTAAD_THREAD_STATUSES,
} from '@mechdost/shared/state';
import { createdAt, id, ts, updatedAt, version } from './_common';
import { nullOrOneOf, oneOf } from './ustaad-common';
import { ustaadMedia } from './ustaad-media';
import { ustaadMembers } from './ustaad-members';
import { ustaadPosts, ustaadPromotions, ustaadTags } from './ustaad-content';

const member = () =>
  uuid()
    .notNull()
    .references(() => ustaadMembers.id, { onDelete: 'cascade' });

export const ustaadFollows = pgTable(
  'ustaad_follows',
  {
    followerId: member(),
    followeeId: member(),
    /** False when the ring check removed the follow from level counting (spec 23 § 14). */
    counted: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index().on(t.followeeId, t.createdAt),
    check('ustaad_follows_not_self', sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

export const ustaadConnections = pgTable(
  'ustaad_connections',
  {
    id: id(),
    lowId: member(),
    highId: member(),
    requestedBy: member(),
    status: text().notNull().default('requested'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_connections_pair_uq').on(t.lowId, t.highId),
    index().on(t.highId, t.status),
    index().on(t.requestedBy),
    check('ustaad_connections_ordered', sql`${t.lowId} < ${t.highId}`),
    check('ustaad_connections_requester_in_pair', sql`${t.requestedBy} in (${t.lowId}, ${t.highId})`),
    check('ustaad_connections_status_valid', oneOf(t.status, USTAAD_CONNECTION_STATUSES)),
  ],
);

export const ustaadMentorships = pgTable(
  'ustaad_mentorships',
  {
    id: id(),
    ustaadId: member(),
    shagirdId: member(),
    status: text().notNull().default('requested'),
    endedReasonCode: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_mentorships_active_uq')
      .on(t.ustaadId, t.shagirdId)
      .where(sql`${t.status} in ('requested','active')`),
    index().on(t.shagirdId, t.status),
    check('ustaad_mentorships_not_self', sql`${t.ustaadId} <> ${t.shagirdId}`),
    check('ustaad_mentorships_status_valid', oneOf(t.status, USTAAD_MENTORSHIP_STATUSES)),
    check('ustaad_mentorships_ended_reason', sql`${t.status} <> 'ended' or ${t.endedReasonCode} is not null`),
  ],
);

export const ustaadBlocks = pgTable(
  'ustaad_blocks',
  { memberId: member(), targetId: member(), createdAt: createdAt() },
  (t) => [
    primaryKey({ columns: [t.memberId, t.targetId] }),
    index().on(t.targetId),
    check('ustaad_blocks_not_self', sql`${t.memberId} <> ${t.targetId}`),
  ],
);

export const ustaadMutes = pgTable(
  'ustaad_mutes',
  { memberId: member(), targetId: member(), createdAt: createdAt() },
  (t) => [
    primaryKey({ columns: [t.memberId, t.targetId] }),
    index().on(t.targetId),
    check('ustaad_mutes_not_self', sql`${t.memberId} <> ${t.targetId}`),
  ],
);

export const ustaadThreads = pgTable(
  'ustaad_threads',
  {
    id: id(),
    lowId: member(),
    highId: member(),
    requestedBy: member(),
    status: text().notNull().default('requested'),
    /** The status before a block (D2): unblock restores it, so a request never opens without being accepted. */
    blockedFrom: text(),
    lastMessageAt: ts(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_threads_pair_uq').on(t.lowId, t.highId),
    index().on(t.highId, t.lastMessageAt),
    index().on(t.lowId, t.lastMessageAt),
    index().on(t.requestedBy, t.createdAt),
    check('ustaad_threads_ordered', sql`${t.lowId} < ${t.highId}`),
    check('ustaad_threads_requester_in_pair', sql`${t.requestedBy} in (${t.lowId}, ${t.highId})`),
    check('ustaad_threads_status_valid', oneOf(t.status, USTAAD_THREAD_STATUSES)),
    check(
      'ustaad_threads_blocked_from_valid',
      sql`(${t.status} = 'blocked') = (${t.blockedFrom} is not null) and (${t.blockedFrom} is null or ${t.blockedFrom} in ('requested','open','declined'))`,
    ),
  ],
);

export const ustaadMessages = pgTable(
  'ustaad_messages',
  {
    id: id(),
    threadId: uuid()
      .notNull()
      .references(() => ustaadThreads.id, { onDelete: 'cascade' }),
    senderId: member(),
    kind: text().notNull().default('text'),
    body: text(),
    mediaId: uuid().references(() => ustaadMedia.id, { onDelete: 'set null' }),
    postId: uuid().references(() => ustaadPosts.id, { onDelete: 'set null' }),
    /** Held for staff (D2): visible to the sender only, no notice, not counted as the thread's last message. */
    heldReasonCode: text(),
    deletedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.threadId, t.createdAt),
    index().on(t.senderId, t.createdAt),
    index().on(t.mediaId),
    index().on(t.postId),
    check('ustaad_messages_kind_valid', oneOf(t.kind, MESSAGE_KINDS)),
    check('ustaad_messages_held_reason_valid', nullOrOneOf(t.heldReasonCode, MESSAGE_HOLD_REASONS)),
    check('ustaad_messages_len', sql`${t.body} is null or char_length(${t.body}) <= 2000`),
    check(
      'ustaad_messages_content',
      sql`(${t.kind} = 'text' and ${t.body} is not null) or (${t.kind} in ('voice','photo') and ${t.mediaId} is not null) or (${t.kind} = 'post_share' and ${t.postId} is not null) or ${t.deletedAt} is not null`,
    ),
  ],
);

export const ustaadTagFollows = pgTable(
  'ustaad_tag_follows',
  {
    memberId: member(),
    tagId: uuid()
      .notNull()
      .references(() => ustaadTags.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.tagId] }), index().on(t.tagId)],
);

/**
 * Per side of a thread (D2): read receipt and per-thread mute. Separate from `ustaad_threads` so a read marker never
 * moves the thread's `version` (accept/decline compare-and-set, L195). Created with the thread for both members.
 */
export const ustaadThreadMembers = pgTable(
  'ustaad_thread_members',
  {
    threadId: uuid()
      .notNull()
      .references(() => ustaadThreads.id, { onDelete: 'cascade' }),
    memberId: member(),
    lastReadAt: ts(),
    muted: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.memberId] }), index().on(t.memberId)],
);

/**
 * Per-member daily counters with an admin cap (D2): promotions served (`promo.daily_cap_per_member`) and Discover
 * profiles served (`discover.profiles_per_day`, SR-37). `day` is the IST calendar day; one conditional upsert
 * (`n + 1 where n < cap`) per serve, never count-then-insert.
 */
export const ustaadDailyCounters = pgTable(
  'ustaad_daily_counters',
  {
    memberId: member(),
    kind: text().notNull(),
    day: date({ mode: 'string' }).notNull(),
    n: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.kind, t.day] }),
    index().on(t.day),
    check('ustaad_daily_counters_kind_valid', oneOf(t.kind, USTAAD_DAILY_COUNTER_KINDS)),
    check('ustaad_daily_counters_n', sql`${t.n} >= 0`),
  ],
);

/** A member hid a promotion (D2): never served to them again; the reason is a code. */
export const ustaadPromoHides = pgTable(
  'ustaad_promo_hides',
  {
    memberId: member(),
    promotionId: uuid()
      .notNull()
      .references(() => ustaadPromotions.id, { onDelete: 'cascade' }),
    reasonCode: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.promotionId] }),
    index().on(t.promotionId),
    check('ustaad_promo_hides_reason_valid', oneOf(t.reasonCode, PROMOTION_HIDE_REASONS)),
  ],
);
