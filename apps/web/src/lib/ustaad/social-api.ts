import { FeedPageDto, PostViewDto } from '@mechdost/shared/ustaad/dto/feed';
import { DiscoverPageDto, DiscoverTagsDto, TopPostsDto } from '@mechdost/shared/ustaad/dto/discover';
import { MessagePageDto, ThreadPageDto } from '@mechdost/shared/ustaad/dto/messages';
import { ReportCreatedDto } from '@mechdost/shared/ustaad/dto/moderation';
import { PromotionClickResultDto, ServePromotionResultDto } from '@mechdost/shared/ustaad/dto/promotions';
import {
  BlockedResponse,
  CommentPageResponse,
  ConnectionMovedResponse,
  CreatedResponse,
  LikeStateResponse,
  MessageSentResponse,
  MutedResponse,
  OkResponse,
  OpenShareResponse,
  PromotionHiddenResponse,
  RemovedResponse,
  SavedResponse,
  SeenResponse,
  SignedUrlResponse,
  ShareLinkResponse,
  StatusResponse,
  StoryCreatedResponse,
  StoryRingsResponse,
  TagFollowResponse,
  TagPageResponse,
  TagsResponse,
  ThreadStartedResponse,
  ThreadStatusResponse,
  VotedResponse,
} from '@mechdost/shared/ustaad/dto/responses';
import {
  BlockListDto,
  ConnectionPageDto,
  FollowResultDto,
  MemberPageDto,
  ProfileViewDto,
} from '@mechdost/shared/ustaad/dto/social';
import { authed, type ApiResult, type Schema } from '../orders-api';
import type { SocialClient } from './social-client';

/**
 * The real feed + social client (spec 23 § 8, workstream D routes): every call is signed in and every answer is
 * checked with the shared schemas (hard rule 4). Loaded only on real-sign-in builds (`social-client.ts`).
 */
const map = <A, B>(r: ApiResult<A>, f: (a: A) => B): ApiResult<B> =>
  r.ok ? { ok: true, data: f(r.data) } : r;
const enc = encodeURIComponent;
const qs = (params: Record<string, string | null | undefined>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export function apiSocialClient(locale: string): SocialClient {
  const get = <T>(path: string, schema: Schema<T>) => authed(locale, path, schema);
  const send = <T>(
    path: string,
    schema: Schema<T>,
    body?: unknown,
    method: 'POST' | 'PUT' | 'DELETE' = 'POST',
  ) => authed(locale, path, schema, body === undefined ? { method } : { method, body });
  const toggle = <T>(path: string, schema: Schema<T>, on: boolean) =>
    send(path, schema, undefined, on ? 'PUT' : 'DELETE');
  return {
    sample: false,
    feed: (tab, cursor) => get(`/ustaad/feed${qs({ tab, cursor })}`, FeedPageDto),
    post: (id) => get(`/ustaad/posts/${enc(id)}`, PostViewDto),
    createPost: (input) => send('/ustaad/posts', CreatedResponse, input),
    deletePost: (id) => send(`/ustaad/posts/${enc(id)}`, StatusResponse, undefined, 'DELETE'),
    like: (id, on) =>
      send(`/ustaad/posts/${enc(id)}/like`, LikeStateResponse, undefined, on ? 'POST' : 'DELETE'),
    save: (id, on) => send(`/ustaad/posts/${enc(id)}/save`, SavedResponse, undefined, on ? 'POST' : 'DELETE'),
    share: async (id, channel) =>
      map(await send(`/ustaad/posts/${enc(id)}/share`, ShareLinkResponse, { channel }), (d) => ({
        path: d.path,
      })),
    comments: (postId, cursor) =>
      get(`/ustaad/posts/${enc(postId)}/comments${qs({ cursor })}`, CommentPageResponse),
    comment: (postId, input) => send(`/ustaad/posts/${enc(postId)}/comments`, CreatedResponse, input),
    deleteComment: (id) => send(`/ustaad/comments/${enc(id)}`, StatusResponse, undefined, 'DELETE'),
    vote: (pollId, optionId) => send(`/ustaad/polls/${enc(pollId)}/vote`, VotedResponse, { optionId }),
    saved: (cursor) => get(`/ustaad/saved${qs({ cursor })}`, FeedPageDto),
    stories: async () => map(await get('/ustaad/stories', StoryRingsResponse), (d) => d.rings),
    addStory: async (input) =>
      map(await send('/ustaad/stories', StoryCreatedResponse, input), (d) => ({
        id: d.id,
        status: d.status,
      })),
    viewStory: (id) => send(`/ustaad/stories/${enc(id)}/view`, SeenResponse),
    tags: async (q) =>
      map(await get(`/ustaad/tags${qs({ q: q.trim() || null })}`, TagsResponse), (d) => d.tags),
    tag: (slug, cursor) => get(`/ustaad/tags/${enc(slug)}${qs({ cursor })}`, TagPageResponse),
    followTag: (slug, on) => toggle(`/ustaad/tags/${enc(slug)}/follow`, TagFollowResponse, on),
    openShare: (token) => get(`/ustaad/shares/${enc(token)}`, OpenShareResponse),
    report: async (input) =>
      map(await send('/ustaad/reports', ReportCreatedDto, input), (d) => ({ code: d.code })),
    profile: (handle) => get(`/ustaad/profiles/${enc(handle)}`, ProfileViewDto),
    memberPosts: (memberId, cursor) =>
      get(`/ustaad/members/${enc(memberId)}/posts${qs({ cursor })}`, FeedPageDto),
    follow: (memberId, on) => toggle(`/ustaad/follows/${enc(memberId)}`, FollowResultDto, on),
    follows: (kind, cursor) => get(`/ustaad/follows${qs({ kind, cursor })}`, MemberPageDto),
    removeFollower: (memberId) =>
      send(`/ustaad/followers/${enc(memberId)}`, RemovedResponse, undefined, 'DELETE'),
    connect: (memberId) => send('/ustaad/connections', ConnectionMovedResponse, { memberId }),
    moveConnection: (id, action) => send(`/ustaad/connections/${enc(id)}/${action}`, ConnectionMovedResponse),
    connections: (box, cursor) => get(`/ustaad/connections${qs({ box, cursor })}`, ConnectionPageDto),
    block: (memberId, on) => toggle(`/ustaad/blocks/${enc(memberId)}`, BlockedResponse, on),
    mute: (memberId, on) => toggle(`/ustaad/mutes/${enc(memberId)}`, MutedResponse, on),
    blocks: () => get('/ustaad/blocks', BlockListDto),
    threads: (box, cursor) => get(`/ustaad/threads${qs({ box, cursor })}`, ThreadPageDto),
    startThread: async (memberId, text) =>
      map(await send('/ustaad/threads', ThreadStartedResponse, { memberId, text }), (d) => ({
        threadId: d.threadId,
        status: d.status,
        pending: d.pending,
      })),
    messages: (threadId, cursor) =>
      get(`/ustaad/threads/${enc(threadId)}/messages${qs({ cursor })}`, MessagePageDto),
    send: (threadId, message) =>
      send(`/ustaad/threads/${enc(threadId)}/messages`, MessageSentResponse, message),
    moveThread: (threadId, action) =>
      send(`/ustaad/threads/${enc(threadId)}/${action}`, ThreadStatusResponse),
    readThread: (threadId) => send(`/ustaad/threads/${enc(threadId)}/read`, OkResponse),
    muteThread: (threadId, muted) =>
      send(`/ustaad/threads/${enc(threadId)}/mute`, MutedResponse, { muted }, 'PUT'),
    discover: (q, cursor) =>
      get(
        `/ustaad/discover${qs({ q: q.q, work: q.work, level: q.level, city: q.city, cursor })}`,
        DiscoverPageDto,
      ),
    discoverTags: async () => map(await get('/ustaad/discover/tags', DiscoverTagsDto), (d) => d.items),
    topPosts: async () => map(await get('/ustaad/discover/top-posts', TopPostsDto), (d) => d.items),
    promotion: async (slot) =>
      map(await get(`/ustaad/promotions${qs({ slot })}`, ServePromotionResultDto), (d) => d.promotion),
    promoClick: (id) => send(`/ustaad/promotions/${enc(id)}/click`, PromotionClickResultDto),
    mediaUrl: async (id) =>
      map(await get(`/ustaad/media/${enc(id)}/url`, SignedUrlResponse), (d) => ({ url: d.url })),
    promoHide: (id, reason) =>
      send(`/ustaad/promotions/${enc(id)}/hide`, PromotionHiddenResponse, { reason }),
  };
}
