import { USTAAD_CONNECTION_STATUSES, USTAAD_THREAD_STATUSES } from '@mechdost/shared/state';
import {
  DiscoverPageDto,
  DiscoverTagsDto,
  TopPostsDto,
  type DiscoverPerson,
  type TopPost,
} from '@mechdost/shared/ustaad/dto/discover';
import {
  MessagePageDto,
  ThreadPageDto,
  type MessageView,
  type SendMessage,
  type ThreadView,
} from '@mechdost/shared/ustaad/dto/messages';
import { ReportCreatedDto, type CreateReportBody } from '@mechdost/shared/ustaad/dto/moderation';
import {
  BlockListDto,
  ConnectionPageDto,
  FollowResultDto,
  MemberPageDto,
  RelationshipDto,
  type ConnectionView,
  type FollowResult,
  type MemberCard,
  type Relationship,
} from '@mechdost/shared/ustaad/dto/social';
import { AUTH_MODE } from '../auth/mode';
import { authed, type ApiResult, type Schema } from '../orders-api';
import { ustaadClient, type MediaDeclare } from './client';

/**
 * One seam for the Ustaad messages, My network and Discover screens (spec 23 § 4 flows 7–8, § 8; workstream D2 web).
 * Real sign-in builds call the API (`/v1/ustaad/{threads,follows,followers,members,connections,blocks,mutes,discover,
 * reports}`, every answer checked with the shared schemas); the browser demo (staff preview, no API) loads labelled
 * sample data from `demo/ustaad-messages.ts`, in memory only. The client itself is loaded on demand by the screens,
 * so no storefront bundle carries it. Uploads and signed media URLs go through the C + E seam (`client.ts`).
 */

export type ThreadBox = 'inbox' | 'requests' | 'sent';
export type ConnectionBox = 'connected' | 'incoming' | 'outgoing';
export type ConnectionAction = 'accept' | 'decline' | 'withdraw' | 'remove';
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface DiscoverTag {
  slug: string;
  nameEn: string;
  nameHi: string;
  uses: number;
}
export interface DiscoverQueryInput {
  q: string | null;
  work: string | null;
  level: string | null;
}
export type { ConnectionView, DiscoverPerson, MemberCard, MessageView, Relationship, ThreadView, TopPost };

export interface SocialClient {
  /** True for the browser demo: screens show the "sample data" note. */
  readonly sample: boolean;
  threads(box: ThreadBox, cursor: string | null): Promise<ApiResult<Page<ThreadView>>>;
  startThread(
    memberId: string,
    text: string,
  ): Promise<ApiResult<{ threadId: string; status: ThreadView['status']; pending: boolean }>>;
  threadAction(
    id: string,
    action: 'accept' | 'decline',
  ): Promise<ApiResult<{ status: ThreadView['status'] }>>;
  messages(
    id: string,
    cursor: string | null,
  ): Promise<ApiResult<{ thread: ThreadView; items: MessageView[]; nextCursor: string | null }>>;
  send(id: string, body: SendMessage): Promise<ApiResult<{ messageId: string; pending: boolean }>>;
  markRead(id: string): Promise<ApiResult<{ ok: true }>>;
  muteThread(id: string, muted: boolean): Promise<ApiResult<{ muted: boolean }>>;
  follow(memberId: string, on: boolean): Promise<ApiResult<FollowResult>>;
  follows(kind: 'followers' | 'following', cursor: string | null): Promise<ApiResult<Page<MemberCard>>>;
  removeFollower(memberId: string): Promise<ApiResult<{ removed: boolean }>>;
  relationship(memberId: string): Promise<ApiResult<Relationship>>;
  connect(memberId: string): Promise<ApiResult<{ id: string; status: ConnectionView['status'] }>>;
  moveConnection(
    id: string,
    action: ConnectionAction,
  ): Promise<ApiResult<{ id: string; status: ConnectionView['status'] }>>;
  connections(box: ConnectionBox, cursor: string | null): Promise<ApiResult<Page<ConnectionView>>>;
  block(memberId: string, on: boolean): Promise<ApiResult<{ blocked: boolean }>>;
  muteMember(memberId: string, on: boolean): Promise<ApiResult<{ muted: boolean }>>;
  blocks(): Promise<ApiResult<{ blocked: MemberCard[]; muted: MemberCard[] }>>;
  discover(q: DiscoverQueryInput, cursor: string | null): Promise<ApiResult<Page<DiscoverPerson>>>;
  discoverTags(): Promise<ApiResult<{ items: DiscoverTag[] }>>;
  topPosts(): Promise<ApiResult<{ items: TopPost[] }>>;
  report(body: CreateReportBody): Promise<ApiResult<{ code: string }>>;
  /**
   * A member by handle, for `?to=<handle>`. No handle route exists yet (API gap, spec 23 § 21d web): the typed Discover
   * search matches handles in the caller's city and only an exact match counts. Replace with a handle route later.
   */
  findByHandle(handle: string): Promise<ApiResult<MemberCard | null>>;
  upload(
    file: Blob,
    meta: MediaDeclare,
    onProgress: (pct: number) => void,
  ): Promise<ApiResult<{ mediaId: string }>>;
  /** A short-lived URL to show a photo (fetched only when the photo scrolls into view). */
  mediaUrl(mediaId: string): Promise<ApiResult<{ url: string }>>;
}

// The small write answers have no shared DTO (they are defined inline in the API routes), and the web app carries no
// zod of its own: these guards check the same shapes.
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const bool = (v: unknown) => typeof v === 'boolean';
const among = (list: readonly string[]) => (v: unknown) => typeof v === 'string' && list.includes(v);
function shape<T>(fields: Record<keyof T & string, (v: unknown) => boolean>): Schema<T> {
  return {
    safeParse: (v) =>
      isRec(v) && Object.entries(fields).every(([k, ok]) => (ok as (x: unknown) => boolean)(v[k]))
        ? { success: true, data: v as T }
        : { success: false },
  };
}
const threadStatus = among(USTAAD_THREAD_STATUSES);
const Sent = shape<{ messageId: string; pending: boolean }>({ messageId: str, pending: bool });
const Started = shape<{
  threadId: string;
  status: ThreadView['status'];
  messageId: string;
  pending: boolean;
}>({
  threadId: str,
  status: threadStatus,
  messageId: str,
  pending: bool,
});
const Status = shape<{ status: ThreadView['status'] }>({ status: threadStatus });
const Moved = shape<{ id: string; status: ConnectionView['status'] }>({
  id: str,
  status: among(USTAAD_CONNECTION_STATUSES),
});
const Ok = shape<{ ok: true }>({ ok: (v) => v === true });
const Muted = shape<{ muted: boolean }>({ muted: bool });
const Blocked = shape<{ blocked: boolean }>({ blocked: bool });
const Removed = shape<{ removed: boolean }>({ removed: bool });

const map = <A, B>(r: ApiResult<A>, f: (a: A) => B): ApiResult<B> =>
  r.ok ? { ok: true, data: f(r.data) } : r;
const qs = (o: Record<string, string | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export function apiSocialClient(locale: string): SocialClient {
  const get = <T>(path: string, schema: Schema<T>) => authed(locale, path, schema);
  const call = <T>(path: string, schema: Schema<T>, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) =>
    authed(locale, path, schema, body === undefined ? { method } : { method, body });
  const media = () => ustaadClient(locale);
  const discover: SocialClient['discover'] = (q, cursor) =>
    get(`/ustaad/discover${qs({ q: q.q, work: q.work, level: q.level, cursor })}`, DiscoverPageDto);
  return {
    sample: false,
    threads: (box, cursor) => get(`/ustaad/threads${qs({ box, cursor })}`, ThreadPageDto),
    startThread: async (memberId, text) =>
      map(await call('/ustaad/threads', Started, 'POST', { memberId, text }), (d) => ({
        threadId: d.threadId,
        status: d.status,
        pending: d.pending,
      })),
    threadAction: (id, action) => call(`/ustaad/threads/${id}/${action}`, Status, 'POST', {}),
    messages: (id, cursor) => get(`/ustaad/threads/${id}/messages${qs({ cursor })}`, MessagePageDto),
    send: (id, body) => call(`/ustaad/threads/${id}/messages`, Sent, 'POST', body),
    markRead: (id) => call(`/ustaad/threads/${id}/read`, Ok, 'POST', {}),
    muteThread: (id, muted) => call(`/ustaad/threads/${id}/mute`, Muted, 'PUT', { muted }),
    follow: (memberId, on) => call(`/ustaad/follows/${memberId}`, FollowResultDto, on ? 'PUT' : 'DELETE'),
    follows: (kind, cursor) => get(`/ustaad/follows${qs({ kind, cursor })}`, MemberPageDto),
    removeFollower: (memberId) => call(`/ustaad/followers/${memberId}`, Removed, 'DELETE'),
    relationship: (memberId) => get(`/ustaad/members/${memberId}/relationship`, RelationshipDto),
    connect: (memberId) => call('/ustaad/connections', Moved, 'POST', { memberId }),
    moveConnection: (id, action) => call(`/ustaad/connections/${id}/${action}`, Moved, 'POST', {}),
    connections: (box, cursor) => get(`/ustaad/connections${qs({ box, cursor })}`, ConnectionPageDto),
    block: (memberId, on) => call(`/ustaad/blocks/${memberId}`, Blocked, on ? 'PUT' : 'DELETE'),
    muteMember: (memberId, on) => call(`/ustaad/mutes/${memberId}`, Muted, on ? 'PUT' : 'DELETE'),
    blocks: () => get('/ustaad/blocks', BlockListDto),
    discover,
    discoverTags: () => get('/ustaad/discover/tags', DiscoverTagsDto),
    topPosts: () => get('/ustaad/discover/top-posts', TopPostsDto),
    report: async (body) =>
      map(await call('/ustaad/reports', ReportCreatedDto, 'POST', body), (d) => ({ code: d.code })),
    findByHandle: async (handle) =>
      map(
        await discover({ q: handle, work: null, level: null }, null),
        (d) => d.items.find((m) => m.handle.toLowerCase() === handle) ?? null,
      ),
    upload: async (file, meta, onProgress) => (await media()).upload(file, meta, onProgress),
    mediaUrl: async (id) => (await media()).mediaUrl(id),
  };
}

const cache = new Map<string, Promise<SocialClient>>();

export function socialClient(locale: string): Promise<SocialClient> {
  let c = cache.get(locale);
  if (!c) {
    c =
      AUTH_MODE === 'firebase'
        ? Promise.resolve(apiSocialClient(locale))
        : import('@/demo/ustaad-messages').then((m) => m.demoSocialClient());
    cache.set(locale, c);
    // A failed chunk load is not cached: the next screen (or Try again) loads it afresh.
    void c.catch(() => cache.delete(locale));
  }
  return c;
}
