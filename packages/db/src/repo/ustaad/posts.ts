/**
 * Ustaad posts (spec 23 § 4 flow 4, § 6.3, § 7.4, § 15; plan task D1). The only writer of `ustaad_posts` (non-story
 * kinds), `ustaad_post_media`, `ustaad_polls` / `ustaad_poll_options` and post tags. One transaction per create: the
 * member row is locked (so `posts.per_day` counts cannot race), media are checked (own, verified, unused, the kind's
 * caps and durations), curated tags resolved, the content screen asked (`held` when it says so), then the post, its
 * media, poll, tags and counter row, an `ustaad_events` row and the analytics event. Members only post `ugc`.
 * Views (`ustaadPostsByIds`) re-check visibility on every read (SR-35) and never select a phone number (SR-34).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ustaadContentMachine } from '@mechdost/shared/state';
import type { CreatePost, PostMediaView, PostView } from '@mechdost/shared/ustaad/dto/feed';
import { linkDisplayHost, safeLinkUrl } from '@mechdost/shared/ustaad/links';
import type { UstaadSettingKey } from '@mechdost/shared/ustaad/settings';
import {
  ustaadMedia,
  ustaadMembers,
  ustaadPollOptions,
  ustaadPolls,
  ustaadPollVotes,
  ustaadPostCounters,
  ustaadPostMedia,
  ustaadPosts,
  ustaadPostTags,
  ustaadReactions,
  ustaadSaves,
  ustaadTags,
  ustaadWordLists,
  vehicleModels,
} from '../../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import type { Tx } from '../orders';
import { recordUstaadEvent } from './events';
import {
  feedMember,
  feedWriter,
  memberAgeDays,
  ownUnusedMedia,
  postVisibleTo,
  visibleUstaadPost,
  type FeedMediaRow,
  type UstaadActor,
  type UstaadMemberRow,
} from './feed-common';
import { screenUstaadContent } from './moderation';
import { ustaadScreenText, ustaadStoredOriginal } from './screen-text';
import { ustaadLinkPreviewsFor } from './previews';
import { readUstaadSettingValues } from './settings';
import { resolveUstaadTagIds } from './tags';

const TYPE_SETTING = {
  voice: 'ustaad.posts.types.voice',
  photo: 'ustaad.posts.types.photo',
  video: 'ustaad.posts.types.video',
  text: 'ustaad.posts.types.text',
  document: 'ustaad.posts.types.document',
  poll: 'ustaad.posts.types.poll',
  link: 'ustaad.posts.types.link',
  mixed: 'ustaad.posts.types.mixed',
} as const satisfies Record<CreatePost['kind'], UstaadSettingKey>;

const invalidMedia = () => new ValidationError('That file cannot be used', 'USTAAD_MEDIA_INVALID');

/** Checks the media of a post against its kind and the caps (`posts.max_photos`, durations). Pure. */
export function checkPostMedia(
  kind: CreatePost['kind'],
  rows: readonly Pick<FeedMediaRow, 'kind' | 'durationMs'>[],
  caps: { maxPhotos: number; videoMaxS: number; voiceMaxS: number },
): void {
  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  const [image, audio, video, document] = [count('image'), count('audio'), count('video'), count('document')];
  const total = rows.length;
  const shapeOk =
    kind === 'voice'
      ? audio === 1 && total === 1
      : kind === 'photo'
        ? image >= 1 && total === image
        : kind === 'video'
          ? video === 1 && image <= 1 && total === video + image
          : kind === 'document'
            ? document === 1 && total === 1
            : kind === 'mixed'
              ? document === 0 && audio <= 1 && video <= 1 && total >= 2
              : total === 0;
  if (!shapeOk) throw invalidMedia();
  if (image > caps.maxPhotos)
    throw new ValidationError('Too many photos', 'USTAAD_MEDIA_LIMIT', { max: caps.maxPhotos });
  for (const r of rows) {
    const max = r.kind === 'video' ? caps.videoMaxS : r.kind === 'audio' ? caps.voiceMaxS : null;
    if (max !== null && (r.durationMs ?? 0) > max * 1000)
      throw new ValidationError('Too long', 'USTAAD_MEDIA_TOO_LONG', { maxSeconds: max });
  }
}

/** `posts.per_day` (IST day; stories excluded) for a member whose row the caller has locked. */
async function assertDailyCap(tx: Tx, memberId: string, perDay: number): Promise<void> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(ustaadPosts)
    .where(
      and(
        eq(ustaadPosts.authorId, memberId),
        sql`${ustaadPosts.kind} <> 'story'`,
        sql`${ustaadPosts.createdAt} >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`,
      ),
    );
  if ((row?.n ?? 0) >= perDay) throw new ValidationError('Daily limit reached', 'USTAAD_DAILY_CAP');
}

/** Admin deny list `link_domain` (SR-24 stand-in): the host or any parent domain on the list is refused. */
async function assertLinkAllowed(tx: Tx, me: UstaadMemberRow, url: string, minDays: number): Promise<void> {
  if (memberAgeDays(me) < minDays)
    throw new ForbiddenError('New accounts cannot share links yet', 'USTAAD_LINKS_LOCKED');
  const host = new URL(url).hostname.toLowerCase();
  const labels = host.split('.');
  const candidates = labels.map((_, i) => labels.slice(i).join('.')).filter((h) => h.includes('.'));
  const [hit] = await tx
    .select({ x: sql`1` })
    .from(ustaadWordLists)
    .where(
      and(
        eq(ustaadWordLists.list, 'link_domain'),
        eq(ustaadWordLists.active, true),
        inArray(ustaadWordLists.phraseNorm, candidates),
      ),
    )
    .limit(1);
  if (hit) throw new ValidationError('This link cannot be posted', 'USTAAD_LINK_BLOCKED');
}

export interface CreatedPost {
  id: string;
  status: string;
  /** The normalised link for the API to fetch a preview for after commit; null for other kinds. */
  linkUrl: string | null;
  created: boolean;
}

/**
 * Create a post (idempotent on `idemKey`). Refuses `USTAAD_RESTRICTED`, `USTAAD_POST_TYPE_OFF`, `USTAAD_DAILY_CAP`,
 * `USTAAD_LINKS_LOCKED`, `USTAAD_LINK_BLOCKED`, `USTAAD_MEDIA_INVALID` / `_LIMIT` / `_TOO_LONG`,
 * `USTAAD_TAG_UNKNOWN` / `_LIMIT`, `USTAAD_CONTENT_BLOCKED`.
 */
export async function createUstaadPost(db: Tx, actor: UstaadActor, input: CreatePost): Promise<CreatedPost> {
  return db.transaction(async (tx) => {
    const me = await feedWriter(tx, actor.memberId, true);
    const [existing] = await tx
      .select({ id: ustaadPosts.id, status: ustaadPosts.status, linkUrl: ustaadPosts.linkUrl })
      .from(ustaadPosts)
      .where(and(eq(ustaadPosts.authorId, me.id), eq(ustaadPosts.idemKey, input.idemKey)))
      .limit(1);
    if (existing) return { ...existing, created: false };
    const s = await readUstaadSettingValues(tx, [
      TYPE_SETTING[input.kind],
      'ustaad.posts.per_day',
      'ustaad.posts.max_photos',
      'ustaad.posts.video_max_s',
      'ustaad.media.voice_max_s',
      'ustaad.tags.max_per_post',
      'ustaad.mod.links_min_account_days',
    ]);
    if (s[TYPE_SETTING[input.kind]] !== true)
      throw new ValidationError('This kind of post is switched off', 'USTAAD_POST_TYPE_OFF');
    await assertDailyCap(tx, me.id, Number(s['ustaad.posts.per_day']));
    let linkUrl: string | null = null;
    if (input.kind === 'link') {
      linkUrl = input.linkUrl === undefined ? null : safeLinkUrl(input.linkUrl);
      if (!linkUrl) throw new ValidationError('This link cannot be posted', 'USTAAD_LINK_BLOCKED');
      await assertLinkAllowed(tx, me, linkUrl, Number(s['ustaad.mod.links_min_account_days']));
    }
    const media = await ownUnusedMedia(
      tx,
      me.id,
      input.media.map((m) => m.mediaId),
    );
    checkPostMedia(input.kind, media, {
      maxPhotos: Number(s['ustaad.posts.max_photos']),
      videoMaxS: Number(s['ustaad.posts.video_max_s']),
      voiceMaxS: Number(s['ustaad.media.voice_max_s']),
    });
    const tagIds = await resolveUstaadTagIds(tx, input.tags, Number(s['ustaad.tags.max_per_post']));
    if (input.vehicleModelId) {
      const [vm] = await tx
        .select({ id: vehicleModels.id })
        .from(vehicleModels)
        .where(eq(vehicleModels.id, input.vehicleModelId))
        .limit(1);
      if (!vm) throw new ValidationError('Unknown vehicle model', 'USTAAD_VEHICLE_UNKNOWN');
    }
    // Everything other members can read is screened, incl. the pre-correction words shown as "see original"
    // (stored only when a correction was used).
    const bodyOriginal = ustaadStoredOriginal(input.bodyOriginal, input.correction);
    const text = ustaadScreenText({
      parts: [input.body, input.fixSymptom, input.fixCause, input.fixFix, ...(input.poll?.options ?? [])],
      original: input.bodyOriginal,
      correction: input.correction,
    });
    const screen = await screenUstaadContent(tx, {
      kind: 'post',
      text,
      mediaIds: media.map((m) => m.id),
      authorId: me.id,
    });
    if (screen === 'block') throw new ValidationError('This post cannot be shared', 'USTAAD_CONTENT_BLOCKED');
    const status = screen === 'ok' ? 'visible' : 'held';
    const [row] = await tx
      .insert(ustaadPosts)
      .values({
        authorId: me.id,
        cityId: me.cityId,
        kind: input.kind,
        template: input.template ?? null,
        contentType: 'ugc',
        body: input.body ?? null,
        bodyOriginal,
        correction: input.correction,
        fixSymptom: input.fixSymptom ?? null,
        fixCause: input.fixCause ?? null,
        fixFix: input.fixFix ?? null,
        segmentCode: input.segmentCode ?? null,
        vehicleModelId: input.vehicleModelId ?? null,
        linkUrl,
        status,
        heldReasonCode: status === 'held' ? 'auto_screen' : null,
        idemKey: input.idemKey,
      })
      .returning({ id: ustaadPosts.id, status: ustaadPosts.status });
    if (!row) throw new ConflictError('Could not save the post');
    if (input.media.length)
      await tx.insert(ustaadPostMedia).values(
        input.media.map((m, position) => ({
          postId: row.id,
          mediaId: m.mediaId,
          position,
          role: m.role ?? null,
        })),
      );
    await tx.insert(ustaadPostCounters).values({ postId: row.id });
    if (input.poll) {
      const [poll] = await tx
        .insert(ustaadPolls)
        .values({
          postId: row.id,
          closesAt: sql`now() + make_interval(hours => ${input.poll.closesInHours})`,
        })
        .returning({ id: ustaadPolls.id });
      if (!poll) throw new ConflictError('Could not save the poll');
      await tx
        .insert(ustaadPollOptions)
        .values(input.poll.options.map((label, position) => ({ pollId: poll.id, label, position })));
    }
    if (tagIds.length)
      await tx.insert(ustaadPostTags).values(tagIds.map((tagId) => ({ postId: row.id, tagId })));
    await recordUstaadEvent(
      tx,
      {
        entityType: 'post',
        entityId: row.id,
        kind: 'created',
        toStatus: status,
        actorId: actor.userId,
        actorRole: 'member',
        cityId: me.cityId,
        props: {
          kind: input.kind,
          template: input.template ?? null,
          media: media.length,
          tags: tagIds.length,
        },
      },
      {
        name: 'ustaad_post_created',
        memberId: me.id,
        userId: actor.userId,
        props: {
          postId: row.id,
          kind: input.kind,
          template: input.template ?? null,
          mediaCount: media.length,
          tagCount: tagIds.length,
          correction: input.correction,
        },
      },
    );
    return { id: row.id, status: row.status, linkUrl, created: true };
  });
}

/** The author hides their own post (`visible|held → hidden_author`); anyone else gets 404. */
export async function deleteUstaadPost(
  db: Tx,
  actor: UstaadActor,
  postId: string,
): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const me = await feedMember(tx, actor.memberId);
    const [p] = await tx
      .select()
      .from(ustaadPosts)
      .where(
        and(
          eq(ustaadPosts.id, postId),
          eq(ustaadPosts.authorId, me.id),
          inArray(ustaadPosts.status, ['visible', 'held']),
        ),
      )
      .limit(1);
    if (!p) throw new NotFoundError('Post not found');
    ustaadContentMachine.assert(p.status as 'visible' | 'held', 'hidden_author', 'member');
    const done = await tx
      .update(ustaadPosts)
      .set({ status: 'hidden_author' })
      .where(
        and(eq(ustaadPosts.id, p.id), eq(ustaadPosts.status, p.status), eq(ustaadPosts.version, p.version)),
      )
      .returning({ id: ustaadPosts.id });
    if (done.length === 0) throw new ConflictError('The post changed, try again');
    await recordUstaadEvent(tx, {
      entityType: 'post',
      entityId: p.id,
      kind: 'hidden_by_author',
      fromStatus: p.status,
      toStatus: 'hidden_author',
      actorId: actor.userId,
      actorRole: 'member',
      cityId: p.cityId,
    });
    return { status: 'hidden_author' };
  });
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Media of posts (or one comment), in position order. */
export async function ustaadMediaViews(
  tx: Tx,
  postIds: readonly string[],
): Promise<Map<string, PostMediaView[]>> {
  const out = new Map<string, PostMediaView[]>();
  if (postIds.length === 0) return out;
  const rows = await tx
    .select({
      postId: ustaadPostMedia.postId,
      mediaId: ustaadPostMedia.mediaId,
      position: ustaadPostMedia.position,
      role: ustaadPostMedia.role,
      kind: ustaadMedia.kind,
      durationMs: ustaadMedia.durationMs,
      width: ustaadMedia.width,
      height: ustaadMedia.height,
      bytes: ustaadMedia.declaredBytes,
      lqip: ustaadMedia.lqip,
    })
    .from(ustaadPostMedia)
    .innerJoin(ustaadMedia, eq(ustaadMedia.id, ustaadPostMedia.mediaId))
    .where(and(inArray(ustaadPostMedia.postId, [...postIds]), eq(ustaadMedia.status, 'verified')))
    .orderBy(asc(ustaadPostMedia.position));
  for (const { postId, ...m } of rows) out.set(postId, [...(out.get(postId) ?? []), m]);
  return out;
}

export const authorColumns = {
  id: ustaadMembers.id,
  handle: ustaadMembers.handle,
  displayName: ustaadMembers.displayName,
  displayNameHi: ustaadMembers.displayNameHi,
  level: ustaadMembers.level,
  track: ustaadMembers.track,
  official: ustaadMembers.official,
  photoMediaId: ustaadMembers.photoMediaId,
};

/**
 * Post views for a viewer, in the order of `ids`; posts the viewer may no longer see (removed, hidden, blocked,
 * expired) are dropped, never shown. Used by the feed snapshot pages, Saved, tag pages and the detail route.
 */
export async function ustaadPostsByIds(
  db: Tx,
  actor: UstaadActor,
  ids: readonly string[],
): Promise<PostView[]> {
  if (ids.length === 0) return [];
  const viewer = actor.memberId;
  const rows = await db
    .select({ post: ustaadPosts, author: authorColumns })
    .from(ustaadPosts)
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadPosts.authorId))
    .where(and(inArray(ustaadPosts.id, [...ids]), postVisibleTo(viewer)));
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.post.id);
  const s = await readUstaadSettingValues(db, ['ustaad.feed.show_like_counts']);
  const [media, tags, counters, liked, saved, polls, previews] = await Promise.all([
    ustaadMediaViews(db, postIds),
    db
      .select({
        postId: ustaadPostTags.postId,
        slug: ustaadTags.slug,
        nameEn: ustaadTags.nameEn,
        nameHi: ustaadTags.nameHi,
        group: ustaadTags.group,
      })
      .from(ustaadPostTags)
      .innerJoin(ustaadTags, eq(ustaadTags.id, ustaadPostTags.tagId))
      .where(inArray(ustaadPostTags.postId, postIds))
      .orderBy(asc(ustaadTags.slug)),
    db.select().from(ustaadPostCounters).where(inArray(ustaadPostCounters.postId, postIds)),
    db
      .select({ postId: ustaadReactions.postId })
      .from(ustaadReactions)
      .where(and(eq(ustaadReactions.memberId, viewer), inArray(ustaadReactions.postId, postIds))),
    db
      .select({ postId: ustaadSaves.postId })
      .from(ustaadSaves)
      .where(and(eq(ustaadSaves.memberId, viewer), inArray(ustaadSaves.postId, postIds))),
    ustaadPollViews(db, viewer, postIds),
    ustaadLinkPreviewsFor(
      db,
      rows.map((r) => r.post.linkUrl).filter((u): u is string => u !== null),
    ),
  ]);
  const likedSet = new Set(liked.map((x) => x.postId));
  const savedSet = new Set(saved.map((x) => x.postId));
  const counterOf = new Map(counters.map((c) => [c.postId, c]));
  const showLikes = s['ustaad.feed.show_like_counts'] === true;
  const byId = new Map<string, PostView>();
  for (const { post: p, author } of rows) {
    const c = counterOf.get(p.id);
    const mine = p.authorId === viewer;
    byId.set(p.id, {
      id: p.id,
      kind: p.kind,
      template: p.template,
      contentType: p.contentType,
      body: p.body,
      bodyOriginal: p.bodyOriginal,
      correction: p.correction,
      fix:
        p.template === 'fix_log' && p.fixSymptom !== null && p.fixFix !== null
          ? { symptom: p.fixSymptom, cause: p.fixCause, fix: p.fixFix }
          : null,
      segmentCode: p.segmentCode,
      vehicleModelId: p.vehicleModelId,
      link: p.linkUrl
        ? { url: p.linkUrl, host: linkDisplayHost(p.linkUrl), preview: previews.get(p.linkUrl) ?? null }
        : null,
      media: media.get(p.id) ?? [],
      poll: polls.get(p.id) ?? null,
      tags: tags.filter((x) => x.postId === p.id).map(({ postId: _p, ...t }) => t),
      counts: {
        likes: showLikes ? (c?.likes ?? 0) : null,
        comments: c?.comments ?? 0,
        saves: mine ? (c?.saves ?? 0) : null,
      },
      likedByMe: likedSet.has(p.id),
      savedByMe: savedSet.has(p.id),
      mine,
      status: p.status,
      author,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt?.toISOString() ?? null,
    });
  }
  return ids.map((id) => byId.get(id)).filter((v): v is PostView => v !== undefined);
}

async function ustaadPollViews(tx: Tx, viewer: string, postIds: readonly string[]) {
  const out = new Map<string, NonNullable<PostView['poll']>>();
  const polls = await tx
    .select({
      id: ustaadPolls.id,
      postId: ustaadPolls.postId,
      closesAt: ustaadPolls.closesAt,
      closed: sql<boolean>`${ustaadPolls.closesAt} <= now()`,
    })
    .from(ustaadPolls)
    .where(inArray(ustaadPolls.postId, [...postIds]));
  if (polls.length === 0) return out;
  const pollIds = polls.map((p) => p.id);
  const [options, votes] = await Promise.all([
    tx
      .select()
      .from(ustaadPollOptions)
      .where(inArray(ustaadPollOptions.pollId, pollIds))
      .orderBy(asc(ustaadPollOptions.position)),
    tx
      .select({ pollId: ustaadPollVotes.pollId, optionId: ustaadPollVotes.optionId })
      .from(ustaadPollVotes)
      .where(and(eq(ustaadPollVotes.memberId, viewer), inArray(ustaadPollVotes.pollId, pollIds))),
  ]);
  for (const p of polls)
    out.set(p.postId, {
      id: p.id,
      closesAt: p.closesAt.toISOString(),
      closed: p.closed === true || (p.closed as unknown) === 't',
      options: options
        .filter((o) => o.pollId === p.id)
        .map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
      myOptionId: votes.find((v) => v.pollId === p.id)?.optionId ?? null,
    });
  return out;
}

/** One post for a viewer (404 when they may not see it). */
export async function ustaadPostDetail(db: Tx, actor: UstaadActor, postId: string): Promise<PostView> {
  await feedMember(db, actor.memberId);
  await visibleUstaadPost(db, actor.memberId, postId);
  const [view] = await ustaadPostsByIds(db, actor, [postId]);
  if (!view) throw new NotFoundError('Post not found');
  return view;
}
