import type {
  CommentView,
  PostAuthor,
  PostMediaView,
  PostView,
  StoryRing,
  TagListItem,
} from '@mechdost/shared/ustaad/dto/feed';
import type { DiscoverPerson, TopPost } from '@mechdost/shared/ustaad/dto/discover';
import type { MessageView, ThreadView } from '@mechdost/shared/ustaad/dto/messages';
import type { ServedPromotion } from '@mechdost/shared/ustaad/dto/promotions';
import type { ConnectionView, MemberCard, ProfileView } from '@mechdost/shared/ustaad/dto/social';
import type { ApiResult } from '@/lib/orders-api';
import { firstMessageProblem } from '@/lib/ustaad/feed-view';
import type { MediaKind, SocialClient } from '@/lib/ustaad/social-client';
import { silentWav } from './ustaad';

/**
 * Sample data for the Ustaad feed and social screens in the browser demo (staff preview with no API; workstream D
 * web). Every screen that uses it shows the "Sample data" note. In memory only (a reload starts again), never on the
 * device. Posts, comments, messages and names are user-written content (shown as typed); tag names carry English and
 * Hindi. Pictures are drawn tiles (no photos of people or number plates).
 */

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ ok: true, data: structuredClone(data) });
const fail = <T>(status: number, code: string): Promise<ApiResult<T>> =>
  Promise.resolve({ ok: false, status, code });

const NOW = Date.UTC(2026, 10, 26, 6, 30);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const uid = (n: number) => `0193a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function card(
  n: number,
  handle: string,
  displayName: string,
  displayNameHi: string,
  level: MemberCard['level'],
  area: [string, string],
  extra: Partial<MemberCard> = {},
): MemberCard {
  return {
    id: uid(n),
    handle,
    displayName,
    displayNameHi,
    track: level === 'apprentice' ? 'apprentice' : 'ustaad',
    level,
    verified: level !== 'apprentice' && level !== 'ustaad_pending',
    official: false,
    areaLabel: area[0],
    areaLabelHi: area[1],
    photoMediaId: null,
    ...extra,
  };
}

const ME = card(1, 'ramesh_rpr', 'Ramesh Sahu', 'रमेश साहू', 'pakka', ['Telibandha', 'तेलीबांधा']);
const SURESH = card(2, 'suresh_auto', 'Suresh Verma', 'सुरेश वर्मा', 'bada', ['Pandri', 'पंडरी']);
const IMRAN = card(3, 'imran_ev', 'Imran Khan', 'इमरान ख़ान', 'master', ['Shankar Nagar', 'शंकर नगर']);
const SONU = card(4, 'sonu_learns', 'Sonu Yadav', 'सोनू यादव', 'apprentice', ['Tatibandh', 'टाटीबंध']);
const DEEPAK = card(5, 'deepak_ac', 'Deepak Patel', 'दीपक पटेल', 'naya', ['Mowa', 'मोवा']);
const MECHDOST = card(6, 'mechdost', 'MechDost', 'मेकदोस्त', 'master', ['Raipur', 'रायपुर'], {
  official: true,
});
const PEOPLE = [ME, SURESH, IMRAN, SONU, DEEPAK, MECHDOST];

const author = (m: MemberCard): PostAuthor => ({
  id: m.id,
  handle: m.handle,
  displayName: m.displayName,
  displayNameHi: m.displayNameHi,
  level: m.level,
  track: m.track,
  official: m.official,
  photoMediaId: m.photoMediaId,
});

const TAGS: TagListItem[] = [
  { slug: 'splendor', nameEn: 'Splendor', nameHi: 'स्प्लेंडर', group: 'vehicle_model', followed: true },
  { slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'part', followed: false },
  { slug: 'clutch', nameEn: 'Clutch', nameHi: 'क्लच', group: 'repair', followed: false },
  { slug: 'self_start', nameEn: 'Self start', nameHi: 'सेल्फ़ स्टार्ट', group: 'repair', followed: false },
  { slug: 'ev', nameEn: 'EV', nameHi: 'ईवी', group: 'repair', followed: false },
  { slug: 'ac_gas', nameEn: 'AC gas', nameHi: 'एसी गैस', group: 'repair', followed: false },
  { slug: 'multimeter', nameEn: 'Multimeter', nameHi: 'मल्टीमीटर', group: 'tool', followed: false },
];
const tag = (slug: string) => {
  const t = TAGS.find((x) => x.slug === slug);
  if (!t) throw new Error(slug);
  return { slug: t.slug, nameEn: t.nameEn, nameHi: t.nameHi, group: t.group };
};

let mediaSeq = 100;
const KINDS = new Map<string, MediaKind>();
const TINTS = new Map<string, number>();
function media(kind: MediaKind, extra: Partial<PostMediaView> = {}, tint = 0): PostMediaView {
  mediaSeq += 1;
  const id = uid(mediaSeq);
  KINDS.set(id, kind);
  TINTS.set(id, tint);
  return {
    mediaId: id,
    kind,
    role: null,
    position: 0,
    durationMs: kind === 'audio' ? 34_000 : kind === 'video' ? 48_000 : null,
    width: kind === 'image' || kind === 'video' ? 1080 : null,
    height: kind === 'image' || kind === 'video' ? 810 : null,
    bytes:
      kind === 'video' ? 6_400_000 : kind === 'audio' ? 210_000 : kind === 'document' ? 480_000 : 180_000,
    lqip: null,
    ...extra,
  };
}

function post(
  n: number,
  who: MemberCard,
  minutes: number,
  over: Partial<PostView>,
  counts: { likes: number; comments: number } = { likes: 0, comments: 0 },
): PostView {
  return {
    id: uid(1000 + n),
    kind: 'text',
    template: null,
    contentType: who.official ? 'mechdost_authored' : 'ugc',
    body: null,
    bodyOriginal: null,
    correction: 'none',
    fix: null,
    segmentCode: null,
    vehicleModelId: null,
    link: null,
    media: [],
    poll: null,
    tags: [],
    counts: {
      likes: counts.likes,
      useful: 0,
      comments: counts.comments,
      saves: who.id === ME.id ? 3 : null,
    },
    likedByMe: false,
    usefulByMe: false,
    savedByMe: false,
    mine: who.id === ME.id,
    status: 'visible',
    author: author(who),
    createdAt: ago(minutes),
    expiresAt: null,
    ...over,
  };
}

function seedPosts(): PostView[] {
  const photos = [0, 1, 2].map((i) => ({ ...media('image', {}, i), position: i }));
  return [
    post(
      1,
      SURESH,
      35,
      {
        kind: 'photo',
        template: 'fix_log',
        body: 'Aaj ka kaam: Splendor self start fix',
        fix: {
          symptom: 'Self dabane par sirf tik tik, engine nahi ghoomta',
          cause: 'Starter relay ka contact jal gaya tha',
          fix: 'Relay badla, battery terminal saaf kiya. Ab ek baar mein start',
        },
        segmentCode: 'two_wheeler',
        media: photos,
        tags: [tag('splendor'), tag('self_start')],
      },
      { likes: 128, comments: 3 },
    ),
    post(
      2,
      IMRAN,
      80,
      {
        kind: 'voice',
        body: 'EV scooter mein controller garam ho raha hai to pehle yeh check karo',
        media: [media('audio')],
        tags: [tag('ev')],
      },
      { likes: 64, comments: 1 },
    ),
    post(
      3,
      DEEPAK,
      140,
      {
        kind: 'poll',
        body: 'Car AC gas bharne se pehle aap kya karte ho?',
        poll: {
          id: uid(3001),
          closesAt: new Date(NOW + 20 * 3_600_000).toISOString(),
          closed: false,
          options: [
            { id: uid(3011), label: 'Leak test pehle', votes: 18 },
            { id: uid(3012), label: 'Vacuum 30 min', votes: 11 },
            { id: uid(3013), label: 'Seedha gas', votes: 2 },
          ],
          myOptionId: null,
        },
        tags: [tag('ac_gas')],
      },
      { likes: 22, comments: 0 },
    ),
    post(
      4,
      SURESH,
      220,
      {
        kind: 'video',
        body: 'Clutch plate badalne ka tarika, 48 second mein',
        media: [media('video'), { ...media('image', {}, 1), role: null, position: 1 }],
        tags: [tag('clutch')],
      },
      { likes: 301, comments: 0 },
    ),
    post(
      5,
      IMRAN,
      300,
      {
        kind: 'text',
        template: 'tip',
        body: 'Multimeter se battery check: 12.6 V se kam ho to charge karo, 12.0 V se kam ho to battery badlo',
        tags: [tag('battery'), tag('multimeter')],
      },
      { likes: 87, comments: 0 },
    ),
    post(
      6,
      DEEPAK,
      400,
      {
        kind: 'photo',
        template: 'before_after',
        body: 'Headlight polish: pehle aur baad',
        media: [
          { ...media('image', {}, 2), role: 'before', position: 0 },
          { ...media('image', {}, 0), role: 'after', position: 1 },
        ],
      },
      { likes: 45, comments: 0 },
    ),
    post(
      7,
      MECHDOST,
      600,
      {
        kind: 'link',
        body: 'Battery warranty claim kaise karein, poori jaankari',
        link: {
          url: 'https://mechdost.in/policies/warranty',
          host: 'mechdost.in',
          preview: { title: 'Warranty and claims', description: 'What to keep ready before a battery claim' },
        },
      },
      { likes: 19, comments: 0 },
    ),
    post(
      8,
      ME,
      900,
      {
        kind: 'document',
        body: 'Splendor wiring diagram, sabke kaam aayega',
        media: [media('document')],
        tags: [tag('splendor')],
        status: 'held',
      },
      { likes: 0, comments: 0 },
    ),
  ];
}

function seedComments(posts: PostView[]): Map<string, CommentView[]> {
  const first = posts[0];
  const second = posts[1];
  const out = new Map<string, CommentView[]>();
  if (!first || !second) return out;
  const c = (
    n: number,
    postId: string,
    who: MemberCard,
    body: string,
    minutes: number,
    parentId: string | null = null,
  ): CommentView => ({
    id: uid(5000 + n),
    postId,
    parentId,
    body,
    bodyOriginal: null,
    correction: 'none',
    media: null,
    author: author(who),
    mine: who.id === ME.id,
    status: 'visible',
    createdAt: ago(minutes),
  });
  const top = c(1, first.id, IMRAN, 'Badhiya! Relay ka part number bhi daal do', 20);
  out.set(first.id, [
    top,
    c(2, first.id, SURESH, 'Haan, 12V 30A wala, Dukaan mein mil jayega', 15, top.id),
    {
      ...c(3, first.id, SONU, '', 10),
      body: null,
      media: media('audio', { durationMs: 12_000 }),
    },
  ]);
  out.set(second.id, [c(4, second.id, DEEPAK, 'Thermal paste bhi dekh lena', 50)]);
  return out;
}

function seedStories(): StoryRing[] {
  const s = (
    n: number,
    who: MemberCard,
    minutes: number,
    body: string | null,
    k: MediaKind = 'image',
    tint = 0,
  ) => ({
    id: uid(7000 + n),
    body,
    media: [media(k, {}, tint)],
    seen: false,
    seenBy: who.id === ME.id ? 14 : null,
    createdAt: ago(minutes),
    expiresAt: new Date(NOW + (1440 - minutes) * 60_000).toISOString(),
  });
  return [
    {
      author: author(ME),
      mine: true,
      allSeen: true,
      stories: [s(1, ME, 60, 'Aaj ki pehli gaadi', 'image', 1)],
    },
    {
      author: author(SURESH),
      mine: false,
      allSeen: false,
      stories: [s(2, SURESH, 30, 'Naya lift laga diya', 'image', 2), s(3, SURESH, 25, null, 'image', 0)],
    },
    {
      author: author(IMRAN),
      mine: false,
      allSeen: false,
      stories: [s(4, IMRAN, 90, 'EV battery pack khola', 'image', 1)],
    },
    {
      author: author(DEEPAK),
      mine: false,
      allSeen: true,
      stories: [s(5, DEEPAK, 200, 'Garmi mein AC ka kaam', 'image', 0)],
    },
  ];
}

function seedThreads(): { threads: ThreadView[]; messages: Map<string, MessageView[]> } {
  const t = (
    n: number,
    other: MemberCard,
    status: ThreadView['status'],
    mine: boolean,
    unread: boolean,
    minutes: number,
  ): ThreadView => ({
    id: uid(8000 + n),
    status,
    mine,
    other,
    muted: false,
    unread,
    lastMessageAt: ago(minutes),
  });
  const threads = [
    t(1, SURESH, 'open', true, true, 12),
    t(2, IMRAN, 'open', false, false, 300),
    t(3, SONU, 'requested', false, true, 45),
    t(4, DEEPAK, 'requested', true, false, 600),
  ];
  const m = (
    n: number,
    mine: boolean,
    text: string,
    minutes: number,
    extra: Partial<MessageView> = {},
  ): MessageView => ({
    id: uid(9000 + n),
    mine,
    kind: 'text',
    text,
    mediaId: null,
    postId: null,
    pending: false,
    read: mine,
    createdAt: ago(minutes),
    ...extra,
  });
  const messages = new Map<string, MessageView[]>([
    [
      uid(8001),
      [
        m(1, true, 'Suresh bhai, Splendor ka relay kahan se liya?', 40),
        m(2, false, 'Telibandha wali dukaan se, 180 rupaye', 30),
        m(3, false, '', 12, { kind: 'voice', text: null, mediaId: media('audio').mediaId }),
      ],
    ],
    [uid(8002), [m(4, false, 'EV wale kaam ke liye kal aana', 300)]],
    [
      uid(8003),
      [m(5, false, 'Ustaad ji, mujhe clutch ka kaam seekhna hai. Aapke garage aa sakta hoon?', 45)],
    ],
    [uid(8004), [m(6, true, 'Deepak bhai, AC gas ka rate kya chal raha hai?', 600)]],
  ]);
  return { threads, messages };
}

function people(): DiscoverPerson[] {
  const p = (
    m: MemberCard,
    specialities: DiscoverPerson['specialities'],
    helpful: number,
    best: number,
    followers: number,
    band: DiscoverPerson['distanceBand'],
    isNew = false,
  ): DiscoverPerson => ({
    ...m,
    specialities,
    followers,
    helpfulAnswers: helpful,
    bestAnswers: best,
    isNew,
    distanceBand: band,
  });
  return [
    p(IMRAN, ['ev', 'electrical'], 212, 64, 1240, '2to5'),
    p(SURESH, ['two_wheeler', 'engine'], 168, 41, 860, 'lt2'),
    p(DEEPAK, ['car_suv', 'ac'], 23, 6, 95, '5to10', true),
  ];
}

const PROMO: ServedPromotion = {
  id: uid(9900),
  slot: 'feed',
  label: { en: 'Sponsored', hi: 'प्रायोजित' },
  titleEn: 'Starter relays at trade price',
  titleHi: 'स्टार्टर रिले थोक दाम पर',
  bodyEn: 'Genuine 12 V relays for two-wheelers, delivered to your garage in Raipur.',
  bodyHi: 'दोपहिया के लिए असली 12 V रिले, रायपुर में आपके गैराज तक।',
  href: '/shop?category=electricals',
};

/** A drawn tile for a sample picture (SVG data URL: the CSP allows `data:` images). */
function tile(tint: number): string {
  const bg = ['#1b3a5c', '#5c3a1b', '#2f4d2a'][tint % 3] ?? '#1b3a5c';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="810" viewBox="0 0 108 81"><rect width="108" height="81" fill="${bg}"/><circle cx="54" cy="40" r="20" fill="none" stroke="#ffffff55" stroke-width="5"/><circle cx="54" cy="40" r="6" fill="#ea5728"/><path d="M10 70h88" stroke="#ffffff33" stroke-width="3"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function demoSocialClient(): SocialClient {
  const posts = seedPosts();
  const comments = seedComments(posts);
  const rings = seedStories();
  const { threads, messages } = seedThreads();
  const following = new Set<string>([SURESH.id]);
  const blocked = new Set<string>();
  const muted = new Set<string>();
  const shares = new Map<string, string>();
  const connections: ConnectionView[] = [
    { id: uid(6001), status: 'accepted', mine: true, other: IMRAN, updatedAt: ago(60 * 24 * 3) },
    { id: uid(6002), status: 'requested', mine: false, other: SONU, updatedAt: ago(90) },
    { id: uid(6003), status: 'requested', mine: true, other: DEEPAK, updatedAt: ago(60 * 5) },
  ];
  let silent: string | null = null;
  let seq = 0;
  const next = () => {
    seq += 1;
    return uid(20_000 + seq);
  };
  const visible = (p: PostView) => !blocked.has(p.author.id);
  const findPost = (id: string) => posts.find((p) => p.id === id && visible(p));
  const byId = new Map(PEOPLE.map((m) => [m.id, m]));

  return {
    sample: true,
    feed: (tab, cursor) => {
      if (cursor) return ok({ items: [], nextCursor: null });
      const list = posts.filter(
        (p) => visible(p) && !muted.has(p.author.id) && (tab === 'for_you' || following.has(p.author.id)),
      );
      return ok({ items: list, nextCursor: null });
    },
    post: (id) => {
      const p = findPost(id);
      return p ? ok(p) : fail(404, 'NOT_FOUND');
    },
    createPost: (input) => {
      const p = post(posts.length + 50, ME, 0, {
        id: next(),
        kind: input.kind,
        template: input.template ?? null,
        body: input.body ?? null,
        bodyOriginal: input.bodyOriginal ?? null,
        correction: input.correction ?? 'none',
        fix:
          input.fixSymptom && input.fixFix
            ? { symptom: input.fixSymptom, cause: input.fixCause ?? null, fix: input.fixFix }
            : null,
        link: input.linkUrl
          ? { url: input.linkUrl, host: new URL(input.linkUrl).hostname, preview: null }
          : null,
        media: (input.media ?? []).map((m, i) => {
          const kind: MediaKind =
            input.kind === 'voice'
              ? 'audio'
              : input.kind === 'video' && i === 0
                ? 'video'
                : input.kind === 'document'
                  ? 'document'
                  : 'image';
          KINDS.set(m.mediaId, kind);
          return { ...media(kind), mediaId: m.mediaId, role: m.role ?? null, position: i };
        }),
        poll: input.poll
          ? {
              id: next(),
              closesAt: new Date(NOW + input.poll.closesInHours * 3_600_000).toISOString(),
              closed: false,
              options: input.poll.options.map((label) => ({ id: next(), label, votes: 0 })),
              myOptionId: null,
            }
          : null,
        tags: (input.tags ?? []).flatMap((s) => {
          const t = TAGS.find((x) => x.slug === s);
          return t ? [tag(t.slug)] : [];
        }),
        createdAt: new Date().toISOString(),
      });
      posts.unshift(p);
      return ok({ id: p.id, status: 'visible' });
    },
    deletePost: (id) => {
      const i = posts.findIndex((p) => p.id === id && p.mine);
      if (i < 0) return fail(404, 'NOT_FOUND');
      posts.splice(i, 1);
      return ok({ status: 'hidden_author' });
    },
    like: (id, on) => {
      const p = findPost(id);
      if (!p) return fail(404, 'NOT_FOUND');
      if (p.likedByMe !== on) {
        p.likedByMe = on;
        p.counts.likes = (p.counts.likes ?? 0) + (on ? 1 : -1);
      }
      return ok({ liked: on, likes: p.counts.likes });
    },
    useful: (id, on) => {
      const p = findPost(id);
      if (!p) return fail(404, 'NOT_FOUND');
      if (p.usefulByMe !== on) {
        p.usefulByMe = on;
        p.counts.useful = Math.max(0, p.counts.useful + (on ? 1 : -1));
      }
      return ok({ useful: on, usefulCount: p.counts.useful });
    },
    save: (id, on) => {
      const p = findPost(id);
      if (!p) return fail(404, 'NOT_FOUND');
      p.savedByMe = on;
      return ok({ saved: on });
    },
    share: (id) => {
      if (!findPost(id)) return fail(404, 'NOT_FOUND');
      // Same shape as a real token ({22}.{22} base64url), mapped back to the post in memory.
      const token = `${id.replace(/-/g, '').slice(-22)}.samplesamplesamplesamp`;
      shares.set(token, id);
      return ok({ path: `/ustaad/s/${token}` });
    },
    comments: (postId) => ok({ items: comments.get(postId) ?? [], nextCursor: null }),
    comment: (postId, input) => {
      const p = findPost(postId);
      if (!p) return fail(404, 'NOT_FOUND');
      const list = comments.get(postId) ?? [];
      const id = next();
      list.push({
        id,
        postId,
        parentId: input.parentId ?? null,
        body: input.body ?? null,
        bodyOriginal: input.bodyOriginal ?? null,
        correction: input.correction ?? 'none',
        media: input.mediaId
          ? { ...media(KINDS.get(input.mediaId) ?? 'audio'), mediaId: input.mediaId }
          : null,
        author: author(ME),
        mine: true,
        status: 'visible',
        createdAt: new Date().toISOString(),
      });
      comments.set(postId, list);
      p.counts.comments += 1;
      return ok({ id, status: 'visible' });
    },
    deleteComment: (id) => {
      for (const [postId, list] of comments) {
        const i = list.findIndex((c) => c.id === id && c.mine);
        if (i >= 0) {
          list.splice(i, 1);
          const p = posts.find((x) => x.id === postId);
          if (p) p.counts.comments = Math.max(0, p.counts.comments - 1);
          return ok({ status: 'hidden_author' });
        }
      }
      return fail(404, 'NOT_FOUND');
    },
    vote: (pollId, optionId) => {
      const p = posts.find((x) => x.poll?.id === pollId);
      const poll = p?.poll;
      if (!poll) return fail(404, 'NOT_FOUND');
      if (poll.myOptionId) return fail(409, 'USTAAD_ALREADY_VOTED');
      const o = poll.options.find((x) => x.id === optionId);
      if (!o) return fail(404, 'NOT_FOUND');
      o.votes += 1;
      poll.myOptionId = optionId;
      return ok({ optionId });
    },
    saved: () => ok({ items: posts.filter((p) => p.savedByMe && visible(p)), nextCursor: null }),
    stories: () => ok(rings.filter((r) => !blocked.has(r.author.id))),
    addStory: (input) => {
      const mine = rings.find((r) => r.mine);
      const id = next();
      const story = {
        id,
        body: input.body ?? null,
        media: [{ ...media(KINDS.get(input.mediaId) ?? 'image'), mediaId: input.mediaId }],
        seen: true,
        seenBy: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
      if (mine) mine.stories.push(story);
      else rings.unshift({ author: author(ME), mine: true, allSeen: true, stories: [story] });
      return ok({ id, status: 'visible' });
    },
    viewStory: (id) => {
      for (const r of rings) {
        const s = r.stories.find((x) => x.id === id);
        if (s) {
          s.seen = true;
          r.allSeen = r.stories.every((x) => x.seen);
          return ok({ seen: true });
        }
      }
      return fail(404, 'NOT_FOUND');
    },
    tags: (q) => {
      const term = q.trim().toLowerCase().replace(/^#/, '');
      return ok(
        TAGS.filter(
          (t) =>
            !term ||
            t.slug.includes(term) ||
            t.nameHi.includes(term) ||
            t.nameEn.toLowerCase().includes(term),
        ),
      );
    },
    tag: (slug) => {
      const t = TAGS.find((x) => x.slug === slug);
      if (!t) return fail(404, 'NOT_FOUND');
      return ok({
        tag: t,
        items: posts.filter((p) => visible(p) && p.tags.some((x) => x.slug === slug)),
        nextCursor: null,
      });
    },
    followTag: (slug, on) => {
      const t = TAGS.find((x) => x.slug === slug);
      if (!t) return fail(404, 'NOT_FOUND');
      t.followed = on;
      return ok({ followed: on });
    },
    openShare: (token) => {
      const id =
        shares.get(token) ?? posts.find((p) => token.startsWith(p.id.replace(/-/g, '').slice(-22)))?.id;
      return id && findPost(id) ? ok({ postId: id }) : fail(404, 'NOT_FOUND');
    },
    report: () => ok({ code: 'UR-RPR-2026-SAMPLE' }),
    profile: (handle) => {
      const m = PEOPLE.find((x) => x.handle === handle.toLowerCase());
      if (!m || blocked.has(m.id)) return fail(404, 'NOT_FOUND');
      const mine = m.id === ME.id;
      const conn = connections.find(
        (c) => c.other.id === m.id && c.status !== 'removed' && c.status !== 'declined',
      );
      const thread = threads.find((t) => t.other.id === m.id);
      const person = people().find((p) => p.id === m.id);
      const view: ProfileView = {
        member: m,
        mine,
        specialities: person?.specialities ?? ['two_wheeler', 'engine'],
        followers: person?.followers ?? 41,
        following: 37,
        posts: posts.filter((p) => p.author.id === m.id).length,
        helpfulAnswers: person?.helpfulAnswers ?? 12,
        bestAnswers: person?.bestAnswers ?? 4,
        relationship: mine
          ? null
          : {
              following: following.has(m.id),
              followsMe: m.id === IMRAN.id,
              connection: conn ? { id: conn.id, status: conn.status, mine: conn.mine } : null,
              blocked: false,
              muted: muted.has(m.id),
              threadId: thread?.id ?? null,
            },
      };
      return ok(view);
    },
    memberPosts: (memberId) =>
      ok({ items: posts.filter((p) => p.author.id === memberId && visible(p)), nextCursor: null }),
    follow: (memberId, on) => {
      if (!byId.has(memberId) || blocked.has(memberId)) return fail(404, 'NOT_FOUND');
      if (on) following.add(memberId);
      else following.delete(memberId);
      return ok({ following: on, followers: null });
    },
    follows: (kind) =>
      ok({
        items:
          kind === 'following'
            ? PEOPLE.filter((p) => following.has(p.id))
            : [IMRAN, SONU, DEEPAK].filter((p) => !blocked.has(p.id)),
        nextCursor: null,
      }),
    removeFollower: () => ok({ removed: true }),
    connect: (memberId) => {
      const other = byId.get(memberId);
      if (!other) return fail(404, 'NOT_FOUND');
      const c: ConnectionView = {
        id: next(),
        status: 'requested',
        mine: true,
        other,
        updatedAt: new Date().toISOString(),
      };
      connections.push(c);
      return ok({ id: c.id, status: c.status });
    },
    moveConnection: (id, action) => {
      const c = connections.find((x) => x.id === id);
      if (!c) return fail(404, 'NOT_FOUND');
      c.status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'removed';
      return ok({ id, status: c.status });
    },
    connections: (box) =>
      ok({
        items: connections.filter((c) =>
          box === 'connected'
            ? c.status === 'accepted'
            : c.status === 'requested' && c.mine === (box === 'outgoing'),
        ),
        nextCursor: null,
      }),
    block: (memberId, on) => {
      if (on) {
        blocked.add(memberId);
        following.delete(memberId);
      } else blocked.delete(memberId);
      return ok({ blocked: on });
    },
    mute: (memberId, on) => {
      if (on) muted.add(memberId);
      else muted.delete(memberId);
      return ok({ muted: on });
    },
    blocks: () =>
      ok({
        blocked: PEOPLE.filter((p) => blocked.has(p.id)),
        muted: PEOPLE.filter((p) => muted.has(p.id)),
      }),
    threads: (box) =>
      ok({
        items: threads.filter(
          (t) =>
            !blocked.has(t.other.id) &&
            (box === 'inbox'
              ? t.status === 'open'
              : box === 'requests'
                ? t.status === 'requested' && !t.mine
                : t.status === 'requested' && t.mine),
        ),
        nextCursor: null,
      }),
    startThread: (memberId, text) => {
      const other = byId.get(memberId);
      if (!other) return fail(404, 'NOT_FOUND');
      if (firstMessageProblem(text) === 'link') return fail(422, 'USTAAD_DM_LINK');
      const existing = threads.find((t) => t.other.id === memberId);
      if (existing) return fail(409, 'USTAAD_DM_PENDING');
      const id = next();
      threads.unshift({
        id,
        status: 'requested',
        mine: true,
        other,
        muted: false,
        unread: false,
        lastMessageAt: new Date().toISOString(),
      });
      messages.set(id, [
        {
          id: next(),
          mine: true,
          kind: 'text',
          text,
          mediaId: null,
          postId: null,
          pending: false,
          read: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      return ok({ threadId: id, status: 'requested', pending: false });
    },
    messages: (threadId) => {
      const t = threads.find((x) => x.id === threadId);
      if (!t || blocked.has(t.other.id)) return fail(404, 'NOT_FOUND');
      return ok({ thread: t, items: [...(messages.get(threadId) ?? [])].reverse(), nextCursor: null });
    },
    send: (threadId, message) => {
      const t = threads.find((x) => x.id === threadId);
      if (!t) return fail(404, 'NOT_FOUND');
      if (t.status === 'requested' && t.mine) return fail(409, 'USTAAD_DM_PENDING');
      if (t.status !== 'open') return fail(409, 'CONFLICT');
      const id = next();
      const list = messages.get(threadId) ?? [];
      list.push({
        id,
        mine: true,
        kind: message.kind,
        text: 'text' in message ? (message.text ?? null) : null,
        mediaId: 'mediaId' in message ? message.mediaId : null,
        postId: 'postId' in message ? message.postId : null,
        pending: false,
        read: false,
        createdAt: new Date().toISOString(),
      });
      if ('mediaId' in message) KINDS.set(message.mediaId, message.kind === 'voice' ? 'audio' : 'image');
      messages.set(threadId, list);
      t.lastMessageAt = new Date().toISOString();
      return ok({ messageId: id, pending: false });
    },
    moveThread: (threadId, action) => {
      const t = threads.find((x) => x.id === threadId && !x.mine && x.status === 'requested');
      if (!t) return fail(404, 'NOT_FOUND');
      t.status = action === 'accept' ? 'open' : 'declined';
      return ok({ status: t.status });
    },
    readThread: (threadId) => {
      const t = threads.find((x) => x.id === threadId);
      if (t) t.unread = false;
      return ok({ ok: true as const });
    },
    muteThread: (threadId, on) => {
      const t = threads.find((x) => x.id === threadId);
      if (!t) return fail(404, 'NOT_FOUND');
      t.muted = on;
      return ok({ muted: on });
    },
    discover: (q) => {
      const term = q.q?.toLowerCase() ?? '';
      return ok({
        items: people().filter(
          (p) =>
            !blocked.has(p.id) &&
            (!q.work || p.specialities.includes(q.work)) &&
            (!term ||
              p.displayName.toLowerCase().includes(term) ||
              (p.displayNameHi ?? '').includes(term) ||
              p.handle.includes(term)),
        ),
        nextCursor: null,
      });
    },
    discoverTags: () =>
      ok(
        TAGS.slice(0, 6).map((t, i) => ({
          slug: t.slug,
          nameEn: t.nameEn,
          nameHi: t.nameHi,
          uses: 40 - i * 6,
        })),
      ),
    topPosts: () =>
      ok(
        posts
          .filter((p) => visible(p) && p.status === 'visible' && !p.mine)
          .slice(0, 3)
          .map((p): TopPost => ({
            id: p.id,
            kind: p.kind as TopPost['kind'],
            author: byId.get(p.author.id) ?? ME,
            likes: p.counts.likes,
            saves: 9,
            createdAt: p.createdAt,
          })),
      ),
    promotion: (slot) => ok(slot === 'feed' ? PROMO : null),
    promoClick: () => ok({ href: PROMO.href }),
    promoHide: () => ok({ hidden: true as const }),
    mediaUrl: (mediaId, kind) => {
      const k = KINDS.get(mediaId) ?? kind;
      if (k === 'audio') return ok({ url: (silent ??= silentWav(2)) });
      if (k === 'image') return ok({ url: tile(TINTS.get(mediaId) ?? 0) });
      return fail(404, 'NOT_FOUND');
    },
  };
}
