import type {
  CommentInput,
  CommentView,
  CreatePost,
  CreateStory,
  FeedPage,
  FeedTab,
  PostView,
  StoryRing,
  TagListItem,
} from '@mechdost/shared/ustaad/dto/feed';
import type { DiscoverPerson, DiscoverQuery, TopPost } from '@mechdost/shared/ustaad/dto/discover';
import type { MessageView, SendMessage, ThreadView } from '@mechdost/shared/ustaad/dto/messages';
import type { CreateReportBody } from '@mechdost/shared/ustaad/dto/moderation';
import type { ServedPromotion } from '@mechdost/shared/ustaad/dto/promotions';
import type {
  ConnectionView,
  FollowResult,
  MemberCard,
  ProfileView,
} from '@mechdost/shared/ustaad/dto/social';
import type { PROMOTION_HIDE_REASONS, PROMOTION_SERVED_SLOTS } from '@mechdost/shared/ustaad/codes';
import type { UstaadConnectionStatus, UstaadThreadStatus } from '@mechdost/shared/state';
import { AUTH_MODE } from '../auth/mode';
import type { ApiResult } from '../orders-api';

/**
 * One seam for the Ustaad feed and social screens (workstream D web, spec 23 § 5): feed, posts, comments, stories,
 * tags, saved, share, profile, follow/connect/block/mute, messages, Discover, promotions and reports. Real sign-in
 * builds call the API (`social-api.ts`, every answer checked with the shared schemas); the browser demo (staff
 * preview with no API) loads labelled sample data (`demo/ustaad-social.ts`). Both are dynamic imports, so no
 * storefront bundle carries either. Uploads and signed media URLs stay on the C + E seam (`client.ts`).
 */

export type PostInput = Omit<CreatePost, 'correction' | 'media' | 'tags'> & {
  correction?: CreatePost['correction'];
  media?: CreatePost['media'];
  tags?: CreatePost['tags'];
};
export type CommentBody = Omit<CommentInput, 'correction'> & { correction?: CommentInput['correction'] };
export type StoryInput = CreateStory;
export type ReportInput = Omit<CreateReportBody, 'note'> & { note?: string };
export type ConnectionAction = 'accept' | 'decline' | 'withdraw' | 'remove';
export type PromoSlot = (typeof PROMOTION_SERVED_SLOTS)[number];
export type MediaKind = 'image' | 'audio' | 'video' | 'document';
export type PromoHideReason = (typeof PROMOTION_HIDE_REASONS)[number];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SocialClient {
  /** True for the browser demo: screens show the "sample data" note. */
  readonly sample: boolean;
  feed(tab: FeedTab, cursor: string | null): Promise<ApiResult<FeedPage>>;
  post(id: string): Promise<ApiResult<PostView>>;
  createPost(input: PostInput): Promise<ApiResult<{ id: string; status: string }>>;
  deletePost(id: string): Promise<ApiResult<{ status: string }>>;
  like(id: string, on: boolean): Promise<ApiResult<{ liked: boolean; likes: number | null }>>;
  save(id: string, on: boolean): Promise<ApiResult<{ saved: boolean }>>;
  share(id: string, channel: 'whatsapp' | 'copy_link'): Promise<ApiResult<{ path: string }>>;
  comments(postId: string, cursor: string | null): Promise<ApiResult<Page<CommentView>>>;
  comment(postId: string, input: CommentBody): Promise<ApiResult<{ id: string; status: string }>>;
  deleteComment(id: string): Promise<ApiResult<{ status: string }>>;
  vote(pollId: string, optionId: string): Promise<ApiResult<{ optionId: string }>>;
  saved(cursor: string | null): Promise<ApiResult<FeedPage>>;
  stories(): Promise<ApiResult<StoryRing[]>>;
  addStory(input: StoryInput): Promise<ApiResult<{ id: string; status: string }>>;
  viewStory(id: string): Promise<ApiResult<{ seen: boolean }>>;
  tags(q: string): Promise<ApiResult<TagListItem[]>>;
  tag(
    slug: string,
    cursor: string | null,
  ): Promise<ApiResult<{ tag: TagListItem; items: PostView[]; nextCursor: string | null }>>;
  followTag(slug: string, on: boolean): Promise<ApiResult<{ followed: boolean }>>;
  openShare(token: string): Promise<ApiResult<{ postId: string }>>;
  report(input: ReportInput): Promise<ApiResult<{ code: string }>>;
  profile(handle: string): Promise<ApiResult<ProfileView>>;
  memberPosts(memberId: string, cursor: string | null): Promise<ApiResult<FeedPage>>;
  follow(memberId: string, on: boolean): Promise<ApiResult<FollowResult>>;
  follows(kind: 'followers' | 'following', cursor: string | null): Promise<ApiResult<Page<MemberCard>>>;
  removeFollower(memberId: string): Promise<ApiResult<{ removed: boolean }>>;
  connect(memberId: string): Promise<ApiResult<{ id: string; status: UstaadConnectionStatus }>>;
  moveConnection(
    id: string,
    action: ConnectionAction,
  ): Promise<ApiResult<{ id: string; status: UstaadConnectionStatus }>>;
  connections(
    box: 'connected' | 'incoming' | 'outgoing',
    cursor: string | null,
  ): Promise<ApiResult<Page<ConnectionView>>>;
  block(memberId: string, on: boolean): Promise<ApiResult<{ blocked: boolean }>>;
  mute(memberId: string, on: boolean): Promise<ApiResult<{ muted: boolean }>>;
  blocks(): Promise<ApiResult<{ blocked: MemberCard[]; muted: MemberCard[] }>>;
  threads(box: 'inbox' | 'requests' | 'sent', cursor: string | null): Promise<ApiResult<Page<ThreadView>>>;
  startThread(
    memberId: string,
    text: string,
  ): Promise<ApiResult<{ threadId: string; status: UstaadThreadStatus; pending: boolean }>>;
  messages(
    threadId: string,
    cursor: string | null,
  ): Promise<ApiResult<{ thread: ThreadView; items: MessageView[]; nextCursor: string | null }>>;
  send(threadId: string, message: SendMessage): Promise<ApiResult<{ messageId: string; pending: boolean }>>;
  moveThread(
    threadId: string,
    action: 'accept' | 'decline',
  ): Promise<ApiResult<{ status: UstaadThreadStatus }>>;
  readThread(threadId: string): Promise<ApiResult<{ ok: true }>>;
  muteThread(threadId: string, muted: boolean): Promise<ApiResult<{ muted: boolean }>>;
  discover(q: Omit<DiscoverQuery, 'cursor'>, cursor: string | null): Promise<ApiResult<Page<DiscoverPerson>>>;
  discoverTags(): Promise<ApiResult<{ slug: string; nameEn: string; nameHi: string; uses: number }[]>>;
  topPosts(): Promise<ApiResult<TopPost[]>>;
  promotion(slot: PromoSlot): Promise<ApiResult<ServedPromotion | null>>;
  promoClick(id: string): Promise<ApiResult<{ href: string }>>;
  promoHide(id: string, reason: PromoHideReason): Promise<ApiResult<{ hidden: true }>>;
  /** A short-lived signed URL (≤ 10 min) for a post, comment, story or message file the member may see. */
  mediaUrl(mediaId: string, kind: MediaKind): Promise<ApiResult<{ url: string }>>;
}

const cache = new Map<string, Promise<SocialClient>>();

export function socialClient(locale: string): Promise<SocialClient> {
  let c = cache.get(locale);
  if (!c) {
    c =
      AUTH_MODE === 'firebase'
        ? import('./social-api').then((m) => m.apiSocialClient(locale))
        : import('@/demo/ustaad-social').then((m) => m.demoSocialClient());
    cache.set(locale, c);
    // A failed chunk load is not cached: the next screen (or Try again) loads it afresh.
    void c.catch(() => cache.delete(locale));
  }
  return c;
}
