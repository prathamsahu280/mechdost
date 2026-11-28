/**
 * Typed fixtures of the Mechanic Network home feed, member profile and my-card screens (spec 23 § 21i-L, batch G) for
 * the API-mode audit. Every body carries the shared schema the screen parses with, so a fixture that drifts from the
 * API contract fails the case (hard rule 4). Sample names only; no phone numbers or real people.
 *
 * Row states: Feed `feed=loading|empty|kinds|held-own|expired|error|not-member`, `tab`, `counts=shown|hidden`,
 * `promo=none|served|hidden` (hidden = the page set-up in `hooks.ts` presses "Hide this" and a reason);
 * Profile `profile=other|mine|following|requested|incoming|connected|muted|gone`, `counts`; Me
 * `card=chhotu|pending|pakka|master|no-badges|error`; every row `stress=long-text` for long en and hi names.
 * The "New posts" pill needs a 90 s poll and is not reachable in a shot (the fresh call answers 0).
 */
import { FeedFreshDto, FeedPageDto } from '@mechdost/shared/ustaad/dto/feed';
import type { PostView, StoryRing } from '@mechdost/shared/ustaad/dto/feed';
import { MeResponseDto } from '@mechdost/shared/ustaad/dto/members';
import { PromotionClickResultDto, ServePromotionResultDto } from '@mechdost/shared/ustaad/dto/promotions';
import {
  PromotionHiddenResponse,
  SignedUrlResponse,
  StoryRingsResponse,
} from '@mechdost/shared/ustaad/dto/responses';
import { ProfileViewDto } from '@mechdost/shared/ustaad/dto/social';
import { MyCardDto } from '@mechdost/shared/ustaad/dto/verification';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { AUDIT_API_ORIGIN } from './session.ts';
import {
  failed,
  get,
  group,
  iso,
  LONG_EN,
  LONG_HI,
  long,
  MEMBER,
  meMember,
  type Out,
  uuid,
} from './ustaad-member-fixtures.ts';

/** A 1x1 PNG: every post photo, thumbnail and avatar request answers with it. */
export const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const mediaMocks = (): Mock[] => [
  get(/^\/ustaad\/media\/[^/]+\/url$/, SignedUrlResponse, () => ({
    body: {
      url: `${AUDIT_API_ORIGIN}/v1/ustaad/media/pixel`,
      expiresAt: iso(-10),
    } satisfies Out<typeof SignedUrlResponse>,
  })),
  {
    method: 'GET',
    path: /^\/ustaad\/media\/pixel$/,
    reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
  },
];

export const name = (c: AuditCase, en: string) => (long(c) ? `${en} ${LONG_EN}` : en);
export const nameHi = (c: AuditCase, hi: string) => (long(c) ? `${hi} ${LONG_HI}` : hi);

type Author = PostView['author'];
export const author = (c: AuditCase, n: number, en: string, hi: string, level = 'pakka'): Author => ({
  id: uuid(300 + n),
  handle: `member_${String(n)}`,
  displayName: name(c, en),
  displayNameHi: nameHi(c, hi),
  level,
  track: 'ustaad',
  official: false,
  photoMediaId: null,
});

const stat = (c: AuditCase, likes: number) => ({
  likes: c.state.counts === 'hidden' ? null : likes,
  useful: 2,
  comments: 3,
  saves: null,
});

let seq = 0;
export function post(c: AuditCase, a: Author, over: Partial<PostView>): PostView {
  seq += 1;
  return {
    id: uuid(400 + seq),
    kind: 'text',
    template: null,
    contentType: 'ugc',
    body: null,
    bodyOriginal: null,
    correction: 'none',
    fix: null,
    segmentCode: 'two_wheeler',
    vehicleModelId: null,
    link: null,
    media: [],
    poll: null,
    tags: [{ slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', group: 'work' }],
    counts: stat(c, 12),
    likedByMe: false,
    usefulByMe: false,
    savedByMe: false,
    mine: false,
    status: 'published',
    author: a,
    createdAt: iso(90),
    expiresAt: null,
    ...over,
  };
}

export const medium = (kind: string, n: number, over: Partial<PostView['media'][number]> = {}) => ({
  mediaId: uuid(500 + n),
  kind,
  role: null,
  position: 0,
  durationMs: kind === 'audio' || kind === 'video' ? 42_000 : null,
  width: kind === 'image' || kind === 'video' ? 1080 : null,
  height: kind === 'image' || kind === 'video' ? 1350 : null,
  bytes: 480_000,
  lqip: null,
  ...over,
});

/** One post of every kind, in the order the feed shows them. */
function kinds(c: AuditCase): PostView[] {
  const a = author(c, 1, 'Suresh Verma', 'सुरेश वर्मा');
  const b = author(c, 2, 'Imran Khan', 'इमरान खान', 'master');
  const text = name(c, 'Cleaned the carburettor and the idle is smooth again');
  return [
    post(c, a, { kind: 'text', body: text }),
    post(c, b, {
      kind: 'voice',
      body: 'Listen to this knocking sound',
      media: [medium('audio', 1, { summary: 'Knocking from the left side at idle' })],
    }),
    post(c, a, {
      kind: 'video',
      body: 'Changing a chain sprocket in two minutes',
      media: [
        medium('video', 2, {
          captionsLang: 'en',
          captionsVtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nFirst, loosen the nut.',
        }),
      ],
    }),
    post(c, b, {
      kind: 'photo',
      body: 'Worn brake pads, replace at this level',
      media: [medium('image', 3)],
    }),
    post(c, a, {
      kind: 'poll',
      body: 'Which engine oil do you use for a Splendor?',
      poll: {
        id: uuid(600),
        closesAt: iso(-60 * 20),
        closed: false,
        options: [
          { id: uuid(601), label: '10W-30', votes: 8 },
          { id: uuid(602), label: '20W-40', votes: 5 },
        ],
        myOptionId: null,
      },
    }),
    post(c, b, {
      kind: 'link',
      body: 'Official service manual',
      link: {
        url: 'https://www.example.com/manual',
        host: 'example.com',
        preview: { title: 'Service manual', description: 'Torque values and intervals' },
      },
    }),
    post(c, a, {
      kind: 'link',
      body: 'How a clutch cable is adjusted',
      link: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        host: 'youtube.com',
        preview: null,
        video: {
          provider: 'youtube',
          videoId: 'dQw4w9WgXcQ',
          startS: 0,
          title: 'Clutch cable adjustment',
          author: 'Garage Guru',
        },
      },
    }),
    post(c, b, {
      kind: 'text',
      template: 'fix_log',
      body: null,
      fix: {
        symptom: name(c, 'Activa does not start in the morning'),
        cause: 'Weak battery terminal',
        fix: 'Cleaned the terminals and tightened them',
      },
    }),
    post(c, a, { kind: 'text', template: 'tip', body: 'Check the tyre pressure when the tyres are cold.' }),
    post(c, b, {
      kind: 'photo',
      template: 'before_after',
      body: 'Radiator flushed',
      media: [
        medium('image', 4, { role: 'before', position: 0 }),
        medium('image', 5, { role: 'after', position: 1 }),
      ],
    }),
    post(c, a, { kind: 'document', body: 'Wiring diagram (PDF)', media: [medium('document', 6)] }),
  ];
}

const heldOwn = (c: AuditCase): PostView[] => [
  post(
    c,
    { ...author(c, 9, 'Ramesh Sahu', 'रमेश साहू', 'apprentice'), id: MEMBER.id, handle: MEMBER.handle },
    {
      kind: 'text',
      body: name(c, 'My first post about a clutch plate'),
      status: 'held',
      mine: true,
    },
  ),
  ...kinds(c).slice(0, 2),
];

function feedItems(c: AuditCase): PostView[] {
  seq = 0;
  switch (c.state.feed) {
    case 'empty':
      return [];
    case 'held-own':
      return heldOwn(c);
    default:
      return kinds(c);
  }
}

const rings = (c: AuditCase): StoryRing[] => {
  if (c.state.feed === 'empty') return [];
  const story = (n: number) => ({
    id: uuid(700 + n),
    body: n === 1 ? 'Open till 8 pm today' : null,
    media: [medium('image', 10 + n)],
    seen: false,
    seenBy: null,
    createdAt: iso(120),
    expiresAt: iso(-60 * 20),
  });
  return [
    { author: author(c, 1, 'Suresh Verma', 'सुरेश वर्मा'), mine: false, allSeen: false, stories: [story(1)] },
    {
      author: author(c, 2, 'Imran Khan', 'इमरान खान', 'master'),
      mine: false,
      allSeen: true,
      stories: [{ ...story(2), seen: true }],
    },
  ];
};

const promotion = (c: AuditCase): Out<typeof ServePromotionResultDto> => ({
  promotion:
    c.state.promo === 'none'
      ? null
      : {
          id: uuid(800),
          slot: 'feed',
          label: { en: 'Sponsored', hi: 'प्रायोजित' },
          titleEn: 'Genuine batteries, delivered',
          titleHi: 'असली बैटरी, घर तक',
          bodyEn: 'Order a battery on MechDost and we fit it for free.',
          bodyHi: 'मैकेनिकदोस्त पर बैटरी मँगाएँ, लगवाना मुफ़्त।',
          href: '/shop/batteries',
        },
});

const meNone = (): Mock =>
  get(/^\/ustaad\/me$/, MeResponseDto, () => ({
    body: { member: null, staffPreview: false } satisfies Out<typeof MeResponseDto>,
  }));

function feedGate(): Mock {
  return {
    method: 'GET',
    path: /^\/ustaad\/me$/,
    schema: MeResponseDto,
    reply: (ctx) => (ctx.c.state.feed === 'not-member' ? meNone().reply(ctx) : meMember().reply(ctx)),
  };
}

export function ustaadFeedMocks(): Mock[] {
  // How many times the For you snapshot was asked: the first ask is "expired", then it works. The count lives in this
  // closure, so it belongs to one page install (one test attempt) and a Playwright retry starts again at zero.
  let asked = 0;
  return [
    // The gate: a visitor who has not joined sees the join screen, never the feed.
    feedGate(),
    ...mediaMocks(),
    get(/^\/ustaad\/stories$/, StoryRingsResponse, (c) => ({
      body: { rings: rings(c) } satisfies Out<typeof StoryRingsResponse>,
    })),
    get(/^\/ustaad\/feed$/, FeedPageDto, (c) => {
      if (c.state.feed === 'error') return failed();
      if (c.state.feed === 'expired') {
        asked += 1;
        if (asked === 1) return { status: 410, code: 'USTAAD_FEED_EXPIRED' };
      }
      const body = { items: feedItems(c), nextCursor: null } satisfies Out<typeof FeedPageDto>;
      return c.state.feed === 'loading' ? { body, delayMs: 15_000 } : { body };
    }),
    get(/^\/ustaad\/feed\/fresh$/, FeedFreshDto, () => ({
      body: { count: 0 } satisfies Out<typeof FeedFreshDto>,
    })),
    get(/^\/ustaad\/promotions$/, ServePromotionResultDto, (c) => ({ body: promotion(c) })),
    {
      method: 'POST',
      path: /^\/ustaad\/promotions\/[^/]+\/hide$/,
      schema: PromotionHiddenResponse,
      reply: (): Reply => ({ body: { hidden: true } satisfies Out<typeof PromotionHiddenResponse> }),
    },
    {
      method: 'POST',
      path: /^\/ustaad\/promotions\/[^/]+\/click$/,
      schema: PromotionClickResultDto,
      reply: (): Reply => ({ body: { href: '/shop/batteries' } }),
    },
  ];
}

// ── Profile ───────────────────────────────────────────────────────────────────────────────────────────────────

type Relationship = NonNullable<Out<typeof ProfileViewDto>['relationship']>;

function relationship(c: AuditCase): Relationship | null {
  const p = String(c.state.profile);
  if (p === 'mine') return null;
  const connection = (status: 'requested' | 'accepted', mine: boolean) => ({ id: uuid(900), status, mine });
  return {
    following: p === 'following' || p === 'connected',
    followsMe: p === 'connected' || p === 'incoming',
    connection:
      p === 'requested'
        ? connection('requested', true)
        : p === 'incoming'
          ? connection('requested', false)
          : p === 'connected'
            ? connection('accepted', false)
            : null,
    blocked: false,
    muted: p === 'muted',
    threadId: p === 'connected' ? uuid(901) : null,
  };
}

function profile(c: AuditCase): Out<typeof ProfileViewDto> {
  const mine = c.state.profile === 'mine';
  const verified = ['following', 'connected', 'mine'].includes(String(c.state.profile));
  const hidden = c.state.counts === 'hidden';
  return {
    member: {
      id: mine ? MEMBER.id : uuid(950),
      handle: mine ? MEMBER.handle : 'somebody',
      displayName: name(c, 'Suresh Verma'),
      displayNameHi: nameHi(c, 'सुरेश वर्मा'),
      track: 'ustaad',
      level: verified ? 'pakka' : 'naya',
      verified,
      official: false,
      areaLabel: name(c, 'Telibandha'),
      areaLabelHi: nameHi(c, 'तेलीबांधा'),
      photoMediaId: null,
    },
    mine,
    specialities: ['two_wheeler', 'battery'],
    followers: hidden ? null : 128,
    following: hidden ? null : 36,
    posts: 14,
    helpfulAnswers: 41,
    bestAnswers: 9,
    relationship: relationship(c),
  };
}

export function ustaadProfileMocks(): Mock[] {
  return [
    meMember(),
    ...mediaMocks(),
    get(/^\/ustaad\/profiles\/[^/]+$/, ProfileViewDto, (c) =>
      c.state.profile === 'gone' ? { status: 404, code: 'NOT_FOUND' } : { body: profile(c) },
    ),
    get(/^\/ustaad\/members\/[^/]+\/posts$/, FeedPageDto, (c) => {
      seq = 0;
      const a = author(c, 1, 'Suresh Verma', 'सुरेश वर्मा');
      return {
        body: {
          items: [
            post(c, a, { body: name(c, 'Cleaned the carburettor and the idle is smooth again') }),
            post(c, a, { kind: 'photo', body: 'Worn brake pads', media: [medium('image', 3)] }),
          ],
          nextCursor: null,
        } satisfies Out<typeof FeedPageDto>,
      };
    }),
  ];
}

// ── My card ───────────────────────────────────────────────────────────────────────────────────────────────────

const LEVELS = {
  chhotu: { current: 'apprentice', level: 'apprentice', state: 'unverified', track: 'apprentice' },
  pending: {
    current: 'ustaad_pending',
    level: 'ustaad_pending',
    state: 'pending_verification',
    track: 'ustaad',
  },
  pakka: { current: 'pakka', level: 'pakka', state: 'verified', track: 'ustaad' },
  master: { current: 'master', level: 'master', state: 'verified', track: 'ustaad' },
  'no-badges': { current: 'naya', level: 'naya', state: 'verified', track: 'ustaad' },
} as const;

const levelOf = (c: AuditCase) => {
  const k = String(c.state.card);
  return k in LEVELS ? LEVELS[k as keyof typeof LEVELS] : LEVELS.chhotu;
};

function card(c: AuditCase): Out<typeof MyCardDto> {
  const l = levelOf(c);
  const top = l.current === 'master';
  const need = (n: number) => ({ ...group, minFollowers: n * 10, minBestAnswers: n, minVideos: n });
  const badge = (code: string, en: string, held: boolean) => ({
    code,
    name: name(c, en),
    rule: 'Answer five questions that other mechanics mark helpful',
    icon: 'star',
    held,
  });
  const none = c.state.card === 'no-badges';
  return {
    member: {
      ...MEMBER,
      displayName: name(c, MEMBER.displayName),
      displayNameHi: nameHi(c, MEMBER.displayNameHi),
      level: l.level,
      track: l.track,
      verificationState: l.state,
      specialities: ['two_wheeler', 'battery', 'electrical'],
    },
    followers: top ? '1.2k' : '38',
    qualifiedFollowers: top ? 300 : 17,
    izzat: top ? 940 : 120,
    answers: top ? 210 : 24,
    bestAnswers: top ? 80 : 6,
    videos: top ? 40 : 3,
    recommendations: top ? 12 : 1,
    helpedThisWeek: c.state.card === 'master' || c.state.card === 'pakka' ? 7 : 0,
    badges: [
      badge('helper', 'Helper', !none),
      badge('storyteller', 'Storyteller', !none && top),
      badge('guru', 'Guru', false),
    ],
    ladder: [
      { level: 'naya', name: 'Naya Ustaad', perk: 'Verified tick', groups: [need(1)], staffReview: false },
      {
        level: 'pakka',
        name: 'Pakka Ustaad',
        perk: 'Higher in search',
        groups: [need(2)],
        staffReview: false,
      },
      { level: 'bada', name: 'Bada Ustaad', perk: 'Answer badge', groups: [need(5)], staffReview: true },
      { level: 'master', name: 'Master Ustaad', perk: 'Mentor mark', groups: [need(10)], staffReview: true },
    ],
    current: l.current,
  };
}

export function ustaadMeMocks(): Mock[] {
  return [
    get(/^\/ustaad\/me$/, MeResponseDto, (c) => {
      const l = levelOf(c);
      return {
        body: {
          member: {
            ...MEMBER,
            level: l.level,
            track: l.track,
            verificationState: l.state,
          },
          staffPreview: false,
        } satisfies Out<typeof MeResponseDto>,
      };
    }),
    get(/^\/ustaad\/me\/card$/, MyCardDto, (c) => (c.state.card === 'error' ? failed() : { body: card(c) })),
  ];
}
