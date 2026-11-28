/**
 * Ustaad feed routes (spec 23 § 8 "Feed & posts", "Stories", tags of "Discover/tags", "Share teaser"; plan tasks
 * D1–D2). Behind `ustaadGate` (index.ts) and `requireUstaadMember` here, so a non-member gets the generic 404 before
 * validation (role-leak). Rate limits per member (SR-43): posts 20/day (and `posts.per_day` in the repository,
 * answered 429), stories 10/day, comments 30/h, likes 100/day, votes 100/day, follows 20/day; reads share the
 * member-read rule. The public teaser `GET /ustaad/s/{token}` is mounted before the gate (`ustaadShareTeaserRoutes`)
 * and shows a generic card only. Link previews are fetched after the post's transaction commits and never block it.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  commentOnUstaadPost,
  ustaadComposeLimits,
  countUstaadFreshFeed,
  createUstaadPost,
  createUstaadStory,
  deleteUstaadComment,
  deleteUstaadPost,
  followUstaadTag,
  likeUstaadPost,
  markUstaadPostUseful,
  listUstaadComments,
  listUstaadFollowingFeed,
  listUstaadSaved,
  listUstaadStories,
  readUstaadAccess,
  saveUstaadLinkPreview,
  saveUstaadPost,
  searchUstaadTags,
  shareUstaadPost,
  suggestUstaadTag,
  unfollowUstaadTag,
  unlikeUstaadPost,
  unmarkUstaadPostUseful,
  unsaveUstaadPost,
  ustaadLinkPreviewNeeded,
  ustaadVideoMetaCached,
  ustaadPostDetail,
  ustaadTagPage,
  ustaadTeaserVisible,
  ValidationError,
  viewUstaadStory,
  visibleUstaadPost,
  voteUstaadPoll,
} from '@mechdost/db/repo';
import {
  CommentDto,
  ComposeLimitsDto,
  CommentViewDto,
  CreatePostDto,
  CreateStoryDto,
  FeedFreshDto,
  FeedFreshQueryDto,
  FeedPageDto,
  FeedQueryDto,
  PageQueryDto,
  PollVoteDto,
  PostViewDto,
  ShareDto,
  StoryRingDto,
  TAG_SLUG_RE,
  TagListItemDto,
  TagListQueryDto,
  TagSuggestionDto,
} from '@mechdost/shared/ustaad/dto/feed';
import { ApiError } from '../../errors';
import { log, safeError } from '../../logger';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { forYouPage, memoryFeedSnapshots } from '../../ustaad/feed/snapshot';
import { fetchLinkPreview } from '../../ustaad/link-preview';
import { fetchYouTubeOEmbed } from '../../ustaad/video-oembed';
import { parseVideoLink, youtubeWatchUrl } from '@mechdost/shared/ustaad/video-links';
import { SHARE_TOKEN_RE, signShareToken, verifyShareToken } from '../../ustaad/share-token';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, conflict, json } from '../service-schemas';

const Id = z.object({ id: z.uuid() });
const Slug = z.object({ slug: z.string().regex(TAG_SLUG_RE) });
const Token = z.object({ token: z.string().regex(SHARE_TOKEN_RE) });
const sec = [{ bearerAuth: [] }];
const Created = z.object({ id: z.uuid(), status: z.string() });
const LikeState = z.object({ liked: z.boolean(), likes: z.number().int().nullable() });
const UsefulState = z.object({ useful: z.boolean(), usefulCount: z.number().int() });
const CommentPage = z.object({ items: z.array(CommentViewDto), nextCursor: z.string().nullable() });
const TagPage = z.object({
  tag: TagListItemDto,
  items: z.array(PostViewDto),
  nextCursor: z.string().nullable(),
});

const feed = createRoute({
  method: 'get',
  path: '/ustaad/feed',
  tags: ['ustaad'],
  summary: 'Home feed: for_you (ranked snapshot, 10 min) or following (newest first); cursor only',
  security: sec,
  request: { query: FeedQueryDto },
  responses: { 200: json(FeedPageDto, 'Feed page'), ...errorResponses },
});
const composeLimits = createRoute({
  method: 'get',
  path: '/ustaad/feed/limits',
  tags: ['ustaad'],
  summary: 'What the composer may offer me now: live photo limit, stories open/locked/off, can I write',
  security: sec,
  responses: { 200: json(ComposeLimitsDto, 'Limits'), ...errorResponses },
});
const fresh = createRoute({
  method: 'get',
  path: '/ustaad/feed/fresh',
  tags: ['ustaad'],
  summary:
    'New posts since a time for the Home "See new posts" pill (count, capped at 10; same candidate rules)',
  security: sec,
  request: { query: FeedFreshQueryDto },
  responses: { 200: json(FeedFreshDto, 'How many new posts'), ...errorResponses },
});
const createPost = createRoute({
  method: 'post',
  path: '/ustaad/posts',
  tags: ['ustaad'],
  summary: 'Create a post of any kind (voice, photos, video, text, document, poll, link, mixed); idempotent',
  security: sec,
  request: { body: body(CreatePostDto) },
  responses: {
    201: json(Created, 'Created (held = "Our team will check it first")'),
    ...conflict,
    ...errorResponses,
  },
});
const getPost = createRoute({
  method: 'get',
  path: '/ustaad/posts/{id}',
  tags: ['ustaad'],
  summary: 'One post',
  security: sec,
  request: { params: Id },
  responses: { 200: json(PostViewDto, 'Post'), ...errorResponses },
});
const delPost = createRoute({
  method: 'delete',
  path: '/ustaad/posts/{id}',
  tags: ['ustaad'],
  summary: 'Hide my own post',
  security: sec,
  request: { params: Id },
  responses: { 200: json(z.object({ status: z.string() }), 'Hidden'), ...conflict, ...errorResponses },
});
const like = createRoute({
  method: 'post',
  path: '/ustaad/posts/{id}/like',
  tags: ['ustaad'],
  summary: 'Like (count visible per feed.show_like_counts; never affects levels)',
  security: sec,
  request: { params: Id },
  responses: { 200: json(LikeState, 'Liked'), ...errorResponses },
});
const unlike = createRoute({
  method: 'delete',
  path: '/ustaad/posts/{id}/like',
  tags: ['ustaad'],
  summary: 'Unlike',
  security: sec,
  request: { params: Id },
  responses: { 200: json(LikeState, 'Unliked'), ...errorResponses },
});
const useful = createRoute({
  method: 'post',
  path: '/ustaad/posts/{id}/useful',
  tags: ['ustaad'],
  summary: '"Kaam ki baat / Useful" reaction (count always shown; never affects levels; no notice)',
  security: sec,
  request: { params: Id },
  responses: { 200: json(UsefulState, 'Marked useful'), ...errorResponses },
});
const unuseful = createRoute({
  method: 'delete',
  path: '/ustaad/posts/{id}/useful',
  tags: ['ustaad'],
  summary: 'Remove the Useful reaction',
  security: sec,
  request: { params: Id },
  responses: { 200: json(UsefulState, 'Unmarked'), ...errorResponses },
});
const save = createRoute({
  method: 'post',
  path: '/ustaad/posts/{id}/save',
  tags: ['ustaad'],
  summary: 'Save a post',
  security: sec,
  request: { params: Id },
  responses: { 200: json(z.object({ saved: z.boolean() }), 'Saved'), ...errorResponses },
});
const unsave = createRoute({
  method: 'delete',
  path: '/ustaad/posts/{id}/save',
  tags: ['ustaad'],
  summary: 'Unsave a post',
  security: sec,
  request: { params: Id },
  responses: { 200: json(z.object({ saved: z.boolean() }), 'Unsaved'), ...errorResponses },
});
const share = createRoute({
  method: 'post',
  path: '/ustaad/posts/{id}/share',
  tags: ['ustaad'],
  summary: 'Share: a teaser link for WhatsApp / copy (generic card, no post text), or send to a mechanic',
  security: sec,
  request: { params: Id, body: body(ShareDto) },
  responses: {
    200: json(z.object({ token: z.string(), path: z.string() }), 'Teaser link'),
    ...errorResponses,
  },
});
const listComments = createRoute({
  method: 'get',
  path: '/ustaad/posts/{id}/comments',
  tags: ['ustaad'],
  summary: 'Replies on a post, oldest first (one level of replies)',
  security: sec,
  request: { params: Id, query: PageQueryDto },
  responses: { 200: json(CommentPage, 'Comments'), ...errorResponses },
});
const addComment = createRoute({
  method: 'post',
  path: '/ustaad/posts/{id}/comments',
  tags: ['ustaad'],
  summary: 'Reply by voice note, photo or text (idempotent)',
  security: sec,
  request: { params: Id, body: body(CommentDto) },
  responses: { 201: json(Created, 'Replied'), ...conflict, ...errorResponses },
});
const delComment = createRoute({
  method: 'delete',
  path: '/ustaad/comments/{id}',
  tags: ['ustaad'],
  summary: 'Hide my own reply',
  security: sec,
  request: { params: Id },
  responses: { 200: json(z.object({ status: z.string() }), 'Hidden'), ...conflict, ...errorResponses },
});
const vote = createRoute({
  method: 'post',
  path: '/ustaad/polls/{id}/vote',
  tags: ['ustaad'],
  summary: 'Vote in a poll (one vote per member)',
  security: sec,
  request: { params: Id, body: body(PollVoteDto) },
  responses: { 200: json(z.object({ optionId: z.uuid() }), 'Voted'), ...conflict, ...errorResponses },
});
const saved = createRoute({
  method: 'get',
  path: '/ustaad/saved',
  tags: ['ustaad'],
  summary: 'My saved posts, newest save first',
  security: sec,
  request: { query: PageQueryDto },
  responses: { 200: json(FeedPageDto, 'Saved'), ...errorResponses },
});
const stories = createRoute({
  method: 'get',
  path: '/ustaad/stories',
  tags: ['ustaad'],
  summary:
    'Story rings ("Today at the garages"): mine, people I follow, my city; expired stories never shown',
  security: sec,
  responses: { 200: json(z.object({ rings: z.array(StoryRingDto) }), 'Rings'), ...errorResponses },
});
const addStory = createRoute({
  method: 'post',
  path: '/ustaad/stories',
  tags: ['ustaad'],
  summary: 'Post a story (photo, voice or short video), gone after stories.hours',
  security: sec,
  request: { body: body(CreateStoryDto) },
  responses: {
    201: json(Created.extend({ expiresAt: z.string() }), 'Posted'),
    ...conflict,
    ...errorResponses,
  },
});
const viewStory = createRoute({
  method: 'post',
  path: '/ustaad/stories/{id}/view',
  tags: ['ustaad'],
  summary: 'Mark a story seen ("Seen by N" is shown to its owner only)',
  security: sec,
  request: { params: Id },
  responses: { 200: json(z.object({ seen: z.boolean() }), 'Seen'), ...errorResponses },
});
const tags = createRoute({
  method: 'get',
  path: '/ustaad/tags',
  tags: ['ustaad'],
  summary: 'Curated hashtags (search by name or alias), with "followed"',
  security: sec,
  request: { query: TagListQueryDto },
  responses: { 200: json(z.object({ tags: z.array(TagListItemDto) }), 'Tags'), ...errorResponses },
});
const tagPage = createRoute({
  method: 'get',
  path: '/ustaad/tags/{slug}',
  tags: ['ustaad'],
  summary: 'A tag and its posts, newest first',
  security: sec,
  request: { params: Slug, query: PageQueryDto },
  responses: { 200: json(TagPage, 'Tag'), ...errorResponses },
});
const followTag = createRoute({
  method: 'put',
  path: '/ustaad/tags/{slug}/follow',
  tags: ['ustaad'],
  summary: 'Follow a tag',
  security: sec,
  request: { params: Slug },
  responses: { 200: json(z.object({ followed: z.boolean() }), 'Followed'), ...errorResponses },
});
const unfollowTag = createRoute({
  method: 'delete',
  path: '/ustaad/tags/{slug}/follow',
  tags: ['ustaad'],
  summary: 'Unfollow a tag',
  security: sec,
  request: { params: Slug },
  responses: { 200: json(z.object({ followed: z.boolean() }), 'Unfollowed'), ...errorResponses },
});
const suggestTag = createRoute({
  method: 'post',
  path: '/ustaad/tag-suggestions',
  tags: ['ustaad'],
  summary: 'Suggest a new tag for the admin list',
  security: sec,
  request: { body: body(TagSuggestionDto) },
  responses: { 201: json(z.object({ id: z.uuid() }), 'Suggested'), ...errorResponses },
});
const openShare = createRoute({
  method: 'get',
  path: '/ustaad/shares/{token}',
  tags: ['ustaad'],
  summary: 'A signed-in member opening a teaser link: the post id to redirect to',
  security: sec,
  request: { params: Token },
  responses: { 200: json(z.object({ postId: z.uuid() }), 'Post'), ...errorResponses },
});
/** Daily caps from the admin settings are 429 like the rate limits (SR-43). */
function asRateLimited(err: unknown): never {
  if (err instanceof ValidationError && err.code === 'USTAAD_DAILY_CAP')
    throw new ApiError(429, err.code, 'Daily limit reached. Try again tomorrow');
  throw err;
}

export function ustaadFeedRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const snapshots = deps.feedSnapshots ?? memoryFeedSnapshots();
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  const limit = (rule: (typeof USTAAD_RATE_RULES)[keyof typeof USTAAD_RATE_RULES]) =>
    rateLimit(deps.rateLimiter, rule, userKey);
  for (const path of [
    '/ustaad/feed',
    '/ustaad/feed/fresh',
    '/ustaad/feed/limits',
    '/ustaad/posts',
    '/ustaad/posts/*',
    '/ustaad/comments/*',
    '/ustaad/polls/*',
    '/ustaad/saved',
    '/ustaad/stories',
    '/ustaad/stories/*',
    '/ustaad/tags',
    '/ustaad/tags/*',
    '/ustaad/tag-suggestions',
    '/ustaad/shares/*',
  ])
    app.use(path, requireUstaadMember(deps));
  app.on(
    'GET',
    [
      '/ustaad/feed',
      '/ustaad/feed/fresh',
      '/ustaad/feed/limits',
      '/ustaad/posts/*',
      '/ustaad/saved',
      '/ustaad/stories',
      '/ustaad/tags/*',
      '/ustaad/shares/*',
    ],
    limit(USTAAD_RATE_RULES.memberReads),
  );
  app.on('GET', '/ustaad/tags', limit(USTAAD_RATE_RULES.search));
  app.on('POST', '/ustaad/posts', limit(USTAAD_RATE_RULES.posts));
  app.on('DELETE', '/ustaad/posts/:id', limit(USTAAD_RATE_RULES.membershipWrites));
  app.on(['POST', 'DELETE'], '/ustaad/posts/:id/like', limit(USTAAD_RATE_RULES.likes));
  app.on(['POST', 'DELETE'], '/ustaad/posts/:id/useful', limit(USTAAD_RATE_RULES.likes));
  app.on(['POST', 'DELETE'], '/ustaad/posts/:id/save', limit(USTAAD_RATE_RULES.likes));
  app.on('POST', '/ustaad/posts/:id/share', limit(USTAAD_RATE_RULES.membershipWrites));
  app.on('POST', '/ustaad/posts/:id/comments', limit(USTAAD_RATE_RULES.comments));
  app.on('DELETE', '/ustaad/comments/:id', limit(USTAAD_RATE_RULES.membershipWrites));
  app.on('POST', '/ustaad/polls/:id/vote', limit(USTAAD_RATE_RULES.votes));
  app.on('POST', '/ustaad/stories', limit(USTAAD_RATE_RULES.stories));
  app.on('POST', '/ustaad/stories/:id/view', limit(USTAAD_RATE_RULES.memberReads));
  app.on(['PUT', 'DELETE'], '/ustaad/tags/:slug/follow', limit(USTAAD_RATE_RULES.follows));
  app.on('POST', '/ustaad/tag-suggestions', limit(USTAAD_RATE_RULES.membershipWrites));

  const actor = (c: Context<AppEnv>) => {
    const member = c.get('ustaadMember');
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return { userId: c.get('auth').user.id, memberId: member.id };
  };
  const shareSecret = () => {
    const s = deps.config.ustaadShareSecret;
    if (!s) throw new ApiError(503, 'SHARE_UNAVAILABLE', 'Sharing is not available right now');
    return s;
  };

  /** After commit: fetch and store the preview; failures are logged, never shown. */
  const preview = (url: string) => {
    const fetcher = deps.linkPreview;
    if (!fetcher) return;
    void (async () => {
      if (!(await ustaadLinkPreviewNeeded(deps.db, url))) return;
      const result = await fetchLinkPreview(url, fetcher);
      await saveUstaadLinkPreview(deps.db, url, result);
    })().catch((err: unknown) => {
      log('warn', 'ustaad_link_preview_failed', safeError(err));
    });
  };

  /**
   * A recognised video link (spec 23 § 10b): the cached oEmbed title/author, else one fixed-host oEmbed request before
   * the post's transaction so the words are screened with the post text. Failure → null (the post still goes up).
   */
  const videoMeta = async (raw: string) => {
    const v = parseVideoLink(raw);
    if (!v) return null;
    const watch = youtubeWatchUrl(v.videoId);
    const cached = await ustaadVideoMetaCached(deps.db, watch);
    if (cached || !deps.videoOEmbed) return cached;
    const meta = await fetchYouTubeOEmbed(v.videoId, deps.videoOEmbed);
    await saveUstaadLinkPreview(deps.db, watch, {
      status: meta ? 'ok' : 'failed',
      finalHost: 'youtube.com',
      title: meta?.title ?? null,
      description: null,
      author: meta?.author ?? null,
    }).catch((err: unknown) => {
      log('warn', 'ustaad_video_meta_save_failed', safeError(err));
    });
    return meta;
  };

  return app
    .openapi(feed, async (c) => {
      const q = c.req.valid('query');
      const page =
        q.tab === 'following'
          ? await listUstaadFollowingFeed(deps.db, actor(c), q)
          : await forYouPage(deps.db, snapshots, actor(c), q);
      return c.json(page, 200);
    })
    .openapi(composeLimits, async (c) => c.json(await ustaadComposeLimits(deps.db, actor(c)), 200))
    .openapi(fresh, async (c) => {
      const q = c.req.valid('query');
      const count = await countUstaadFreshFeed(deps.db, actor(c), { tab: q.tab, since: new Date(q.since) });
      return c.json({ count }, 200);
    })
    .openapi(createPost, async (c) => {
      const body = c.req.valid('json');
      const video = body.kind === 'link' && body.linkUrl ? await videoMeta(body.linkUrl) : null;
      const p = await createUstaadPost(deps.db, actor(c), body, { video }).catch(asRateLimited);
      // A video's card is built from the screened oEmbed fields; the generic HTML preview is never fetched for it.
      if (p.created && p.linkUrl && !p.video) preview(p.linkUrl);
      return c.json({ id: p.id, status: p.status }, 201);
    })
    .openapi(getPost, async (c) =>
      c.json(await ustaadPostDetail(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(delPost, async (c) =>
      c.json(await deleteUstaadPost(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(like, async (c) => c.json(await likeUstaadPost(deps.db, actor(c), c.req.valid('param').id), 200))
    .openapi(unlike, async (c) =>
      c.json(await unlikeUstaadPost(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(useful, async (c) =>
      c.json(await markUstaadPostUseful(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(unuseful, async (c) =>
      c.json(await unmarkUstaadPostUseful(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(save, async (c) => c.json(await saveUstaadPost(deps.db, actor(c), c.req.valid('param').id), 200))
    .openapi(unsave, async (c) =>
      c.json(await unsaveUstaadPost(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(share, async (c) => {
      const secret = shareSecret();
      const { postId } = await shareUstaadPost(
        deps.db,
        actor(c),
        c.req.valid('param').id,
        c.req.valid('json').channel,
      );
      const token = signShareToken(secret, postId);
      return c.json({ token, path: `/ustaad/s/${token}` }, 200);
    })
    .openapi(listComments, async (c) =>
      c.json(await listUstaadComments(deps.db, actor(c), c.req.valid('param').id, c.req.valid('query')), 200),
    )
    .openapi(addComment, async (c) =>
      c.json(await commentOnUstaadPost(deps.db, actor(c), c.req.valid('param').id, c.req.valid('json')), 201),
    )
    .openapi(delComment, async (c) =>
      c.json(await deleteUstaadComment(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(vote, async (c) =>
      c.json(
        await voteUstaadPoll(deps.db, actor(c), c.req.valid('param').id, c.req.valid('json').optionId),
        200,
      ),
    )
    .openapi(saved, async (c) => c.json(await listUstaadSaved(deps.db, actor(c), c.req.valid('query')), 200))
    .openapi(stories, async (c) => c.json({ rings: await listUstaadStories(deps.db, actor(c)) }, 200))
    .openapi(addStory, async (c) =>
      c.json(await createUstaadStory(deps.db, actor(c), c.req.valid('json')), 201),
    )
    .openapi(viewStory, async (c) =>
      c.json(await viewUstaadStory(deps.db, actor(c), c.req.valid('param').id), 200),
    )
    .openapi(tags, async (c) =>
      c.json({ tags: await searchUstaadTags(deps.db, actor(c), c.req.valid('query')) }, 200),
    )
    .openapi(tagPage, async (c) =>
      c.json(await ustaadTagPage(deps.db, actor(c), c.req.valid('param').slug, c.req.valid('query')), 200),
    )
    .openapi(followTag, async (c) =>
      c.json(await followUstaadTag(deps.db, actor(c), c.req.valid('param').slug), 200),
    )
    .openapi(unfollowTag, async (c) =>
      c.json(await unfollowUstaadTag(deps.db, actor(c), c.req.valid('param').slug), 200),
    )
    .openapi(suggestTag, async (c) =>
      c.json(await suggestUstaadTag(deps.db, actor(c), c.req.valid('json').text), 201),
    )
    .openapi(openShare, async (c) => {
      const postId = verifyShareToken(shareSecret(), c.req.valid('param').token);
      if (!postId) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const a = actor(c);
      await visibleUstaadPost(deps.db, a.memberId, postId, { live: true });
      return c.json({ postId }, 200);
    });
}

const teaser = createRoute({
  method: 'get',
  path: '/ustaad/s/{token}',
  tags: ['ustaad'],
  summary: 'Public share teaser: a generic card only (no text, media, names or counts), noindex',
  request: { params: Token },
  responses: { 200: json(z.object({ kind: z.literal('ustaad_post') }), 'Teaser'), ...errorResponses },
});

/**
 * The public teaser (SR-44), mounted BEFORE the gate: no sign-in, rate limited per IP, `noindex`, 404 unless the
 * network is `open`, the token is genuine and the post is live. The website renders the generic card ("A post on
 * Ustaad Network. Sign in as a mechanic to see it", en + hi) and sends signed-in members to `/ustaad/shares/{token}`.
 */
export function ustaadShareTeaserRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/ustaad/s/*',
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.sharePerIp, (c) => c.get('clientIp')),
  );
  return app.openapi(teaser, async (c) => {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Cache-Control', 'no-store');
    const secret = deps.config.ustaadShareSecret;
    const postId = secret ? verifyShareToken(secret, c.req.valid('param').token) : null;
    const live =
      postId !== null &&
      (await readUstaadAccess(deps.db)) === 'open' &&
      (await ustaadTeaserVisible(deps.db, postId));
    if (!live) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    return c.json({ kind: 'ustaad_post' as const }, 200);
  });
}
