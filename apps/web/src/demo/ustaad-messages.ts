import type { ApiResult } from '@/lib/orders-api';
import type {
  ConnectionView,
  DiscoverPerson,
  DiscoverTag,
  MemberCard,
  MessageView,
  Page,
  SocialClient,
  ThreadView,
  TopPost,
} from '@/lib/ustaad/messages-api';

/**
 * Sample data for the Ustaad messages, My network and Discover screens in the browser demo (the staff preview with no
 * API; spec 23 § 5). Every screen shows the "Sample data" note. Kept in memory only (a reload starts again), never on
 * the device, so nothing typed is stored anywhere (decision 2026-11-14). Names and message texts are user-written
 * content (shown as typed); member names and areas carry Hindi too, tags carry both languages. The rules the API
 * enforces are imitated where a screen shows them: a request is one text-only message, a link is refused, a fee
 * phrase is held for a check, a withdrawn connect request waits for the cooldown.
 */

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ ok: true, data });
const fail = <T>(status: number, code: string): Promise<ApiResult<T>> =>
  Promise.resolve({ ok: false, status, code });

const NOW = Date.UTC(2026, 10, 26, 6, 30);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const uid = (n: number) => `0193a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const member = (
  n: number,
  handle: string,
  displayName: string,
  displayNameHi: string,
  level: MemberCard['level'],
  areaLabel: string,
  areaLabelHi: string,
  verified = true,
): MemberCard => ({
  id: uid(n),
  handle,
  displayName,
  displayNameHi,
  track: level === 'apprentice' ? 'apprentice' : 'ustaad',
  level,
  verified,
  official: false,
  areaLabel,
  areaLabelHi,
  photoMediaId: null,
});

const SURESH = member(2, 'suresh_auto', 'Suresh Verma', 'सुरेश वर्मा', 'bada', 'Telibandha', 'तेलीबांधा');
const IMRAN = member(3, 'imran_ev', 'Imran Khan', 'इमरान ख़ान', 'pakka', 'Shankar Nagar', 'शंकर नगर');
const DEEPAK = member(4, 'deepak_2w', 'Deepak Sahu', 'दीपक साहू', 'naya', 'Pandri', 'पंडरी');
const RAJU = member(
  5,
  'raju_chhotu',
  'Raju Nishad',
  'राजू निषाद',
  'apprentice',
  'Gudhiyari',
  'गुढ़ियारी',
  false,
);
const ANIL = member(6, 'anil_ac', 'Anil Patel', 'अनिल पटेल', 'master', 'Civil Lines', 'सिविल लाइंस');
const MANOJ = member(
  7,
  'manoj_tyre',
  'Manoj Yadav',
  'मनोज यादव',
  'ustaad_pending',
  'Tatibandh',
  'टाटीबंध',
  false,
);
const VIKAS = member(8, 'vikas_diesel', 'Vikas Dewangan', 'विकास देवांगन', 'pakka', 'Mowa', 'मोवा');
const ALL = [SURESH, IMRAN, DEEPAK, RAJU, ANIL, MANOJ, VIKAS];

/** Discover extras per member (speciality codes, counts, new-member slot, distance band). */
const PROFILE: Record<string, Omit<DiscoverPerson, keyof MemberCard>> = {
  [SURESH.id]: {
    specialities: ['two_wheeler', 'engine', 'electrical'],
    followers: 214,
    helpfulAnswers: 96,
    bestAnswers: 31,
    isNew: false,
    distanceBand: 'lt2',
  },
  [ANIL.id]: {
    specialities: ['car_suv', 'ac'],
    followers: 402,
    helpfulAnswers: 88,
    bestAnswers: 40,
    isNew: false,
    distanceBand: '5to10',
  },
  [IMRAN.id]: {
    specialities: ['ev', 'battery', 'electrical'],
    followers: 77,
    helpfulAnswers: 41,
    bestAnswers: 12,
    isNew: false,
    distanceBand: '2to5',
  },
  [VIKAS.id]: {
    specialities: ['truck_bus', 'engine', 'diagnostics'],
    followers: 58,
    helpfulAnswers: 30,
    bestAnswers: 9,
    isNew: false,
    distanceBand: '10plus',
  },
  [DEEPAK.id]: {
    specialities: ['two_wheeler', 'suspension_brakes'],
    followers: 12,
    helpfulAnswers: 6,
    bestAnswers: 1,
    isNew: true,
    distanceBand: '2to5',
  },
  [RAJU.id]: {
    specialities: ['two_wheeler'],
    followers: 3,
    helpfulAnswers: 0,
    bestAnswers: 0,
    isNew: true,
    distanceBand: null,
  },
  [MANOJ.id]: {
    specialities: ['tyres'],
    followers: 5,
    helpfulAnswers: 2,
    bestAnswers: 0,
    isNew: true,
    distanceBand: '5to10',
  },
};

const TAGS: DiscoverTag[] = [
  { slug: 'splendor', nameEn: 'Splendor', nameHi: 'स्प्लेंडर', uses: 42 },
  { slug: 'self-start', nameEn: 'Self start', nameHi: 'सेल्फ़ स्टार्ट', uses: 31 },
  { slug: 'brake', nameEn: 'Brakes', nameHi: 'ब्रेक', uses: 27 },
  { slug: 'ac-gas', nameEn: 'AC gas', nameHi: 'एसी गैस', uses: 19 },
  { slug: 'ev-battery', nameEn: 'EV battery', nameHi: 'ईवी बैटरी', uses: 11 },
];

const TOP: TopPost[] = [
  { id: uid(901), kind: 'photo', author: SURESH, likes: 64, saves: 23, createdAt: ago(60 * 30) },
  { id: uid(902), kind: 'voice', author: ANIL, likes: 41, saves: 17, createdAt: ago(60 * 52) },
  { id: uid(903), kind: 'mixed', author: IMRAN, likes: 22, saves: 9, createdAt: ago(60 * 70) },
];

interface DemoThread {
  view: ThreadView;
  /** Newest first, like the API. */
  messages: MessageView[];
}

const message = (
  n: number,
  mine: boolean,
  text: string | null,
  minutes: number,
  over: Partial<MessageView> = {},
) =>
  ({
    id: uid(500 + n),
    mine,
    kind: 'text',
    text,
    mediaId: null,
    postId: null,
    pending: false,
    read: false,
    createdAt: ago(minutes),
    ...over,
  }) satisfies MessageView;

function seedThreads(): DemoThread[] {
  const thread = (n: number, other: MemberCard, over: Partial<ThreadView>): ThreadView => ({
    id: uid(300 + n),
    status: 'open',
    mine: true,
    other,
    muted: false,
    unread: false,
    lastMessageAt: null,
    ...over,
  });
  const suresh = [
    message(6, true, 'Ok bhai, kal subah aata hoon. Advance UPI pe bhej doon?', 4, { pending: true }),
    message(5, false, 'Haan, 6301 bearing mere paas hai. Le jao.', 9),
    message(4, false, null, 12, { kind: 'voice', mediaId: uid(701) }),
    message(3, true, 'Splendor ka self nahi chal raha, carbon brush badla phir bhi.', 30, { read: true }),
    message(2, false, 'Ram Ram Ramesh bhai! Bolo kya kaam hai?', 45),
    message(1, true, 'Namaste Suresh bhai', 50, { read: true }),
  ];
  const anil = [
    message(13, false, 'Gauge yahan dekho.', 60 * 19, { kind: 'photo', mediaId: uid(702) }),
    message(12, false, 'AC gas ka pressure 35 psi rakhna, zyada mat bharna.', 60 * 20),
    message(11, true, 'Dhanyavaad Anil ji, Swift ka AC thanda nahi kar raha tha.', 60 * 21, { read: true }),
  ];
  const imran = [
    message(21, false, 'Bhai, EV scooty ka battery cell balance kaise karte ho? Thoda samjha do.', 25),
  ];
  const deepak = [
    message(31, true, 'Deepak bhai, Pandri mein brake shoe ka sahi rate kya chal raha hai?', 60 * 3),
  ];
  return [
    {
      view: thread(1, SURESH, { unread: true, lastMessageAt: suresh[1]?.createdAt ?? null }),
      messages: suresh,
    },
    { view: thread(2, ANIL, { muted: true, lastMessageAt: anil[0]?.createdAt ?? null }), messages: anil },
    {
      view: thread(3, IMRAN, {
        status: 'requested',
        mine: false,
        unread: true,
        lastMessageAt: imran[0]?.createdAt ?? null,
      }),
      messages: imran,
    },
    {
      view: thread(4, DEEPAK, {
        status: 'requested',
        mine: true,
        lastMessageAt: deepak[0]?.createdAt ?? null,
      }),
      messages: deepak,
    },
  ];
}

/** A small picture for sample photos (a `blob:` URL: the CSP allows `blob:` images). */
function samplePhoto(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#1c3050"/><circle cx="320" cy="240" r="120" fill="none" stroke="#ea5728" stroke-width="36" stroke-dasharray="40 22"/><circle cx="320" cy="240" r="48" fill="#ea5728"/></svg>`;
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

const PAGE = 4;
function paged<T>(all: readonly T[], cursor: string | null, size = PAGE): Page<T> {
  const start = cursor ? Number(cursor.replace(/^p/, '')) || 0 : 0;
  const items = all.slice(start, start + size);
  return { items, nextCursor: start + size < all.length ? `p${String(start + size)}` : null };
}

export function demoSocialClient(): SocialClient {
  const threads = seedThreads();
  const followers = new Set([SURESH.id, RAJU.id, DEEPAK.id, VIKAS.id, IMRAN.id]);
  const following = new Set([SURESH.id, ANIL.id]);
  const blocked = new Set([MANOJ.id]);
  const muted = new Set<string>();
  const cooldown = new Set<string>();
  const connections: ConnectionView[] = [
    { id: uid(401), status: 'accepted', mine: true, other: SURESH, updatedAt: ago(60 * 24 * 5) },
    { id: uid(402), status: 'requested', mine: false, other: RAJU, updatedAt: ago(60 * 2) },
    { id: uid(403), status: 'requested', mine: true, other: VIKAS, updatedAt: ago(60 * 26) },
  ];
  const media = new Map<string, string>();
  let photo: string | null = null;
  let seq = 0;
  const nextId = (base: number) => {
    seq += 1;
    return uid(base + seq);
  };
  const byId = (id: string) => ALL.find((m) => m.id === id);
  const findThread = (id: string) => threads.find((t) => t.view.id === id);
  const visible = (id: string) => !blocked.has(id);
  const followResult = (id: string) => ({
    following: following.has(id),
    followers: (PROFILE[id]?.followers ?? 0) + (following.has(id) ? 1 : 0),
  });
  const LINK = /(https?:\/\/|www\.|\.(com|in|net)\b)/i;
  const HOLD = /\b(advance|fee|upi)\b/i;

  return {
    sample: true,
    threads: (box, cursor) => {
      const list = threads
        .filter((t) => visible(t.view.other.id))
        .filter((t) =>
          box === 'inbox'
            ? t.view.status === 'open'
            : box === 'requests'
              ? t.view.status === 'requested' && !t.view.mine
              : t.view.status === 'requested' && t.view.mine,
        )
        .map((t) => t.view)
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
      return ok(paged(list, cursor, 20));
    },
    startThread: (memberId, text) => {
      const other = byId(memberId);
      if (!other || !visible(memberId)) return fail(404, 'NOT_FOUND');
      if (LINK.test(text)) return fail(422, 'USTAAD_DM_LINK');
      const existing = threads.find((t) => t.view.other.id === memberId);
      // My request was declined: asking again starts a fresh request on the same conversation (as the API does).
      if (existing?.view.status === 'declined' && existing.view.mine) {
        const now = new Date().toISOString();
        existing.view.status = 'requested';
        existing.view.lastMessageAt = now;
        existing.messages.unshift(
          message(900 + seq, true, text, 0, { id: nextId(600), pending: HOLD.test(text), createdAt: now }),
        );
        return ok({ threadId: existing.view.id, status: existing.view.status, pending: HOLD.test(text) });
      }
      if (existing) return fail(409, 'USTAAD_DM_PENDING');
      const held = HOLD.test(text);
      const view: ThreadView = {
        id: nextId(350),
        status: 'requested',
        mine: true,
        other,
        muted: false,
        unread: false,
        lastMessageAt: new Date().toISOString(),
      };
      threads.push({
        view,
        messages: [
          message(900 + seq, true, text, 0, {
            id: nextId(600),
            pending: held,
            createdAt: new Date().toISOString(),
          }),
        ],
      });
      return ok({ threadId: view.id, status: view.status, pending: held });
    },
    threadAction: (id, action) => {
      const t = findThread(id);
      if (t?.view.status !== 'requested' || t.view.mine) return fail(404, 'NOT_FOUND');
      t.view.status = action === 'accept' ? 'open' : 'declined';
      return ok({ status: t.view.status });
    },
    messages: (id, cursor) => {
      const t = findThread(id);
      if (!t || !visible(t.view.other.id) || (t.view.status === 'declined' && t.view.mine))
        return fail(404, 'NOT_FOUND');
      const p = paged(t.messages, cursor, 20);
      return ok({ thread: { ...t.view }, items: p.items, nextCursor: p.nextCursor });
    },
    send: (id, body) => {
      const t = findThread(id);
      if (!t) return fail(404, 'NOT_FOUND');
      if (t.view.status !== 'open') return fail(409, 'USTAAD_DM_PENDING');
      const text = 'text' in body ? (body.text ?? null) : null;
      const held = text !== null && HOLD.test(text);
      const m: MessageView = {
        id: nextId(600),
        mine: true,
        kind: body.kind,
        text,
        mediaId: 'mediaId' in body ? body.mediaId : null,
        postId: 'postId' in body ? body.postId : null,
        pending: held,
        read: false,
        createdAt: new Date().toISOString(),
      };
      t.messages.unshift(m);
      if (!held) t.view.lastMessageAt = m.createdAt;
      return ok({ messageId: m.id, pending: held });
    },
    markRead: (id) => {
      const t = findThread(id);
      if (t) t.view.unread = false;
      return ok({ ok: true as const });
    },
    muteThread: (id, on) => {
      const t = findThread(id);
      if (!t) return fail(404, 'NOT_FOUND');
      t.view.muted = on;
      return ok({ muted: on });
    },
    follow: (memberId, on) => {
      if (!byId(memberId) || !visible(memberId)) return fail(404, 'NOT_FOUND');
      if (on) following.add(memberId);
      else following.delete(memberId);
      return ok(followResult(memberId));
    },
    follows: (kind, cursor) => {
      const set = kind === 'followers' ? followers : following;
      return ok(
        paged(
          ALL.filter((m) => set.has(m.id) && visible(m.id)),
          cursor,
        ),
      );
    },
    removeFollower: (memberId) => ok({ removed: followers.delete(memberId) }),
    relationship: (memberId) => {
      if (!visible(memberId)) return fail(404, 'NOT_FOUND');
      const c = connections.find(
        (x) => x.other.id === memberId && (x.status === 'requested' || x.status === 'accepted'),
      );
      return ok({
        following: following.has(memberId),
        followsMe: followers.has(memberId),
        connection: c ? { id: c.id, status: c.status, mine: c.mine } : null,
        blocked: false,
        muted: muted.has(memberId),
        threadId: threads.find((t) => t.view.other.id === memberId)?.view.id ?? null,
      });
    },
    connect: (memberId) => {
      const other = byId(memberId);
      if (!other || !visible(memberId)) return fail(404, 'NOT_FOUND');
      if (cooldown.has(memberId)) return fail(409, 'USTAAD_CONNECT_COOLDOWN');
      const open = connections.find(
        (x) => x.other.id === memberId && (x.status === 'requested' || x.status === 'accepted'),
      );
      // Crossed requests become a connection (as in the API); an existing one is answered as it is.
      if (open) {
        if (open.status === 'requested' && !open.mine) open.status = 'accepted';
        return ok({ id: open.id, status: open.status });
      }
      const c: ConnectionView = {
        id: nextId(450),
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
      if (action === 'accept' && c.status === 'requested' && !c.mine) c.status = 'accepted';
      else if (action === 'decline' && c.status === 'requested' && !c.mine) c.status = 'declined';
      else if (action === 'withdraw' && c.status === 'requested' && c.mine) {
        c.status = 'removed';
        cooldown.add(c.other.id);
      } else if (action === 'remove' && c.status === 'accepted') c.status = 'removed';
      else return fail(409, 'CONFLICT');
      c.updatedAt = new Date().toISOString();
      return ok({ id: c.id, status: c.status });
    },
    connections: (box, cursor) => {
      const list = connections.filter(
        (c) =>
          visible(c.other.id) &&
          (box === 'connected'
            ? c.status === 'accepted'
            : c.status === 'requested' && c.mine === (box === 'outgoing')),
      );
      return ok(paged(list, cursor));
    },
    block: (memberId, on) => {
      if (!byId(memberId)) return fail(404, 'NOT_FOUND');
      if (on) {
        blocked.add(memberId);
        following.delete(memberId);
        followers.delete(memberId);
      } else blocked.delete(memberId);
      return ok({ blocked: on });
    },
    muteMember: (memberId, on) => {
      if (on) muted.add(memberId);
      else muted.delete(memberId);
      return ok({ muted: on });
    },
    blocks: () =>
      ok({
        blocked: ALL.filter((m) => blocked.has(m.id)),
        muted: ALL.filter((m) => muted.has(m.id)),
      }),
    discover: (q, cursor) => {
      const needle = q.q?.toLowerCase() ?? null;
      const people: DiscoverPerson[] = ALL.filter((m) => visible(m.id))
        .map((m) => {
          const extra = PROFILE[m.id];
          if (!extra) throw new Error('profile');
          return { ...m, ...extra };
        })
        .filter(
          (p) =>
            (!needle ||
              [p.displayName, p.displayNameHi ?? '', p.handle, p.areaLabel, p.areaLabelHi ?? ''].some((s) =>
                s.toLowerCase().includes(needle),
              )) &&
            (!q.work || (p.specialities as string[]).includes(q.work)) &&
            (!q.level || p.level === q.level),
        )
        .sort(
          (a, b) => b.helpfulAnswers * 2 + b.bestAnswers * 3 - (a.helpfulAnswers * 2 + a.bestAnswers * 3),
        );
      return ok(paged(people, cursor));
    },
    discoverTags: () => ok({ items: TAGS }),
    topPosts: () => ok({ items: TOP.filter((p) => visible(p.author.id)) }),
    report: () => ok({ code: 'UR-RPR-2026-SAMPLE' }),
    findByHandle: (handle) => ok(ALL.find((m) => m.handle === handle && visible(m.id)) ?? null),
    upload: async (file, _meta, onProgress) => {
      for (const pct of [15, 50, 85, 100]) {
        await new Promise((r) => setTimeout(r, 100));
        onProgress(pct);
      }
      const id = crypto.randomUUID();
      media.set(id, URL.createObjectURL(file));
      return { ok: true, data: { mediaId: id } };
    },
    mediaUrl: (id) => ok({ url: media.get(id) ?? (photo ??= samplePhoto()) }),
  };
}
