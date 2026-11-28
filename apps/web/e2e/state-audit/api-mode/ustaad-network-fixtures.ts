/**
 * Typed fixtures of the Mechanic Network messages, conversation, My network and Discover screens (spec 23 § 21i-L,
 * batch H) for the API-mode audit. Every body carries the shared schema the screen parses with, so a fixture that
 * drifts from the API contract fails the case (hard rule 4). Sample names only; no phone numbers or real people.
 * No module-level mutable state: a fixture reads the case, never remembers a call.
 *
 * Row states: Messages `box=inbox|requests|sent|empty|more|error` (`requests` and `sent` are the address `?box=`),
 * `to=none|form|form-errors|not-found|existing` (the address `?to=somebody`; `form-errors` = the page set-up in
 * `hooks.ts` sends the empty form); Thread `thread=open|held|decide|waiting|closed|blocked|older|error` and
 * `panel=text|voice|photo|more|report|block-confirm` (the page set-up opens it; `blocked` = More, Block, Yes);
 * Network `tab`, `list=empty|one|more|error`; Discover `discover=top|search|filters|no-match|more|cap|error`
 * (`cap` = the page set-up presses Connect and the API answers the daily cap); every row `stress=long-text`.
 */
import { DiscoverPageDto, DiscoverTagsDto, TopPostsDto } from '@mechdost/shared/ustaad/dto/discover';
import { MessagePageDto, ThreadPageDto } from '@mechdost/shared/ustaad/dto/messages';
import { ReportCreatedDto } from '@mechdost/shared/ustaad/dto/moderation';
import {
  BlockListDto,
  ConnectionPageDto,
  FollowResultDto,
  MemberPageDto,
  RelationshipDto,
} from '@mechdost/shared/ustaad/dto/social';
import type { MemberCardDto } from '@mechdost/shared/ustaad/dto/social';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { mediaMocks } from './ustaad-social-fixtures.ts';
import {
  failed,
  get,
  iso,
  LONG_EN,
  LONG_HI,
  long,
  meMember,
  type Out,
  uuid,
} from './ustaad-member-fixtures.ts';

/** The conversation the Thread row opens (also the one an existing request links to). */
export const THREAD_ID = '0193a000-0000-7000-8000-000000000301';

type Card = Out<typeof MemberCardDto>;
type Thread = Out<typeof MessagePageDto>['thread'];
type Message = Out<typeof MessagePageDto>['items'][number];
type Person = Out<typeof DiscoverPageDto>['items'][number];

const name = (c: AuditCase, en: string) => (long(c) ? `${en} ${LONG_EN}` : en);
const nameHi = (c: AuditCase, hi: string) => (long(c) ? `${hi} ${LONG_HI}` : hi);

/** Member 1 is the handle the `?to=somebody` row looks for. */
const NAMES: readonly (readonly [string, string])[] = [
  ['Suresh Verma', 'सुरेश वर्मा'],
  ['Imran Khan', 'इमरान खान'],
  ['Deepak Yadav', 'दीपक यादव'],
  ['Anil Tandon', 'अनिल टंडन'],
  ['Mohan Sahu', 'मोहन साहू'],
  ['Kavita Netam', 'कविता नेताम'],
];

function card(c: AuditCase, n: number, level: Card['level'] = 'pakka', verified = true): Card {
  const [en, hi] = NAMES[(n - 1) % NAMES.length] ?? NAMES[0] ?? ['Member', 'सदस्य'];
  return {
    id: uuid(1000 + n),
    handle: n === 1 ? 'somebody' : `member_${String(n)}`,
    displayName: name(c, en),
    displayNameHi: nameHi(c, hi),
    track: 'ustaad',
    level,
    verified,
    official: false,
    areaLabel: 'Telibandha',
    areaLabelHi: 'तेलीबांधा',
    photoMediaId: null,
  };
}

const LEVELS: readonly Card['level'][] = ['pakka', 'master', 'naya', 'bada', 'pakka', 'naya'];
const memberAt = (c: AuditCase, n: number) =>
  card(c, n, LEVELS[(n - 1) % LEVELS.length] ?? 'pakka', n % 3 !== 0);

// ── Messages ──────────────────────────────────────────────────────────────────────────────────────────────────

function thread(c: AuditCase, n: number, over: Partial<Thread> = {}): Thread {
  return {
    id: uuid(1100 + n),
    status: 'open',
    mine: n % 2 === 0,
    other: memberAt(c, n),
    muted: false,
    unread: false,
    lastMessageAt: iso(10 + n * 90),
    last: null,
    ...over,
  };
}

const preview = (c: AuditCase, text: string) => (long(c) ? `${text} ${LONG_EN}`.slice(0, 80) : text);

/** The chats: a text (unread), a voice note, a photo, a shared post, a muted one with no message yet. */
const chats = (c: AuditCase): Thread[] => [
  thread(c, 1, {
    unread: true,
    last: {
      kind: 'text',
      text: preview(c, 'Bhai, kal subah garage aaoge kya?'),
      durationMs: null,
      mine: false,
    },
  }),
  thread(c, 2, { last: { kind: 'voice', text: null, durationMs: 42_000, mine: true } }),
  thread(c, 3, { last: { kind: 'photo', text: null, durationMs: null, mine: false }, unread: true }),
  thread(c, 4, { last: { kind: 'post_share', text: null, durationMs: null, mine: true } }),
  thread(c, 5, { muted: true }),
];

const incoming = (c: AuditCase): Thread[] => [
  thread(c, 6, { status: 'requested', mine: false, unread: true }),
  thread(c, 7, { status: 'requested', mine: false }),
];
const outgoing = (c: AuditCase): Thread[] => [
  thread(c, 8, { status: 'requested', mine: true }),
  thread(c, 9, { status: 'requested', mine: true }),
];

function threadPage(c: AuditCase, box: string, cursor: string | null): Out<typeof ThreadPageDto> {
  const empty = c.state.box === 'empty';
  if (box === 'requests') return { items: empty ? [] : incoming(c), nextCursor: null };
  if (box === 'sent') return { items: empty ? [] : outgoing(c), nextCursor: null };
  if (empty) return { items: [], nextCursor: null };
  if (c.state.box === 'more')
    return cursor
      ? { items: [thread(c, 10), thread(c, 11)], nextCursor: null }
      : { items: chats(c), nextCursor: 'next1' };
  return { items: chats(c), nextCursor: null };
}

/** The discover search `?to=` uses: only an exact handle opens the form, so "not found" answers an empty list. */
function handleSearch(c: AuditCase): Out<typeof DiscoverPageDto> {
  if (c.state.to === 'not-found') return { items: [], nextCursor: null };
  return { items: [person(c, 1)], nextCursor: null };
}

export function ustaadMessagesMocks(): Mock[] {
  return [
    meMember(),
    ...mediaMocks(),
    get(/^\/ustaad\/threads$/, ThreadPageDto, (c, q) =>
      c.state.box === 'error' ? failed() : { body: threadPage(c, q.get('box') ?? 'inbox', q.get('cursor')) },
    ),
    // `?to=somebody`: the typed search finds the member, the relationship says whether a conversation exists.
    get(/^\/ustaad\/discover$/, DiscoverPageDto, (c) => ({ body: handleSearch(c) })),
    get(/^\/ustaad\/members\/[^/]+\/relationship$/, RelationshipDto, (c) => ({
      body: {
        following: false,
        followsMe: false,
        connection: null,
        blocked: false,
        muted: false,
        threadId: c.state.to === 'existing' ? THREAD_ID : null,
      } satisfies Out<typeof RelationshipDto>,
    })),
    get(/^\/ustaad\/threads\/[^/]+\/messages$/, MessagePageDto, (c) => ({ body: conversation(c, null) })),
    {
      method: 'POST',
      path: /^\/ustaad\/threads$/,
      reply: (): Reply => ({
        body: { threadId: THREAD_ID, status: 'requested', messageId: uuid(1500), pending: false },
      }),
    },
  ];
}

// ── Conversation ──────────────────────────────────────────────────────────────────────────────────────────────

const minutes = (days: number, extra = 0) => days * 24 * 60 + extra;

function message(c: AuditCase, n: number, mine: boolean, ago: number, over: Partial<Message> = {}): Message {
  return {
    id: uuid(1500 + n),
    mine,
    kind: 'text',
    text: null,
    mediaId: null,
    voice: null,
    postId: null,
    pending: false,
    read: false,
    createdAt: iso(ago),
    ...over,
    ...(long(c) && over.text ? { text: `${over.text} ${LONG_EN} ${LONG_HI}` } : {}),
  };
}

/** Newest first, like the API; over three IST days; one of every bubble kind and every tick word. */
function openMessages(c: AuditCase): Message[] {
  return [
    message(c, 1, true, 5, { text: 'Theek hai, kal 10 baje aata hoon.' }),
    message(c, 2, false, 9, { text: 'Gaadi ka kaam ho gaya, kal le jaana.' }),
    message(c, 3, true, 40, { kind: 'post_share', postId: uuid(1700), read: true }),
    message(c, 4, false, minutes(1, 60), { kind: 'photo', mediaId: uuid(1600) }),
    message(c, 5, true, minutes(1, 90), {
      kind: 'voice',
      mediaId: uuid(1601),
      read: true,
      voice: { durationMs: 42_000, bytes: 120_000, summary: 'Engine knocking at idle' },
    }),
    message(c, 6, false, minutes(3, 30), { text: 'Namaste, aapka number kisne diya?' }),
    message(c, 7, true, minutes(3, 45), { text: 'Namaste, main Telibandha ka mechanic hoon.', read: true }),
  ];
}

function conversation(c: AuditCase, cursor: string | null): Out<typeof MessagePageDto> {
  // The Messages row (an existing request) shows a plain open conversation; only the Thread row sets a state.
  const state = c.code === 'API-USTAAD-THREAD' ? c.state.thread : 'open';
  const other = card(c, 1);
  const head = (over: Partial<Thread>): Thread => ({
    id: THREAD_ID,
    status: 'open',
    mine: true,
    other,
    muted: false,
    unread: false,
    lastMessageAt: iso(5),
    last: null,
    ...over,
  });
  if (state === 'older') {
    const page = openMessages(c);
    return cursor
      ? {
          thread: head({}),
          items: [
            message(c, 20, false, minutes(9), { text: 'Pehli baar baat kar rahe hain.' }),
            message(c, 21, true, minutes(9, 10), { text: 'Ji bilkul.', read: true }),
          ],
          nextCursor: null,
        }
      : { thread: head({}), items: page, nextCursor: 'older1' };
  }
  if (state === 'held')
    return {
      thread: head({}),
      items: [
        message(c, 30, true, 2, { text: 'Is number par call karo.', pending: true }),
        ...openMessages(c),
      ],
      nextCursor: null,
    };
  if (state === 'decide')
    return {
      thread: head({ status: 'requested', mine: false, unread: true }),
      items: [message(c, 31, false, 20, { text: 'Namaste, kya aap clutch plate ka kaam karte hain?' })],
      nextCursor: null,
    };
  if (state === 'waiting')
    return {
      thread: head({ status: 'requested', mine: true }),
      items: [message(c, 32, true, 20, { text: 'Namaste, kya aap clutch plate ka kaam karte hain?' })],
      nextCursor: null,
    };
  if (state === 'closed')
    return {
      thread: head({ status: 'declined', mine: true }),
      items: [
        message(c, 33, true, minutes(1), { text: 'Namaste, kya aap clutch plate ka kaam karte hain?' }),
      ],
      nextCursor: null,
    };
  return { thread: head({}), items: openMessages(c), nextCursor: null };
}

export function ustaadThreadMocks(): Mock[] {
  const write = (method: Mock['method'], path: RegExp, body: unknown): Mock => ({
    method,
    path,
    reply: (): Reply => ({ body }),
  });
  return [
    meMember(),
    ...mediaMocks(),
    get(/^\/ustaad\/threads\/[^/]+\/messages$/, MessagePageDto, (c, q) =>
      c.state.thread === 'error' ? failed() : { body: conversation(c, q.get('cursor')) },
    ),
    write('POST', /^\/ustaad\/threads\/[^/]+\/read$/, { ok: true }),
    write('POST', /^\/ustaad\/threads\/[^/]+\/accept$/, { status: 'open' }),
    write('POST', /^\/ustaad\/threads\/[^/]+\/decline$/, { status: 'declined' }),
    write('POST', /^\/ustaad\/threads\/[^/]+\/messages$/, { messageId: uuid(1599), pending: false }),
    write('PUT', /^\/ustaad\/threads\/[^/]+\/mute$/, { muted: true }),
    write('PUT', /^\/ustaad\/blocks\/[^/]+$/, { blocked: true }),
    write('DELETE', /^\/ustaad\/blocks\/[^/]+$/, { blocked: false }),
    {
      method: 'POST',
      path: /^\/ustaad\/reports$/,
      schema: ReportCreatedDto,
      reply: (): Reply => ({
        body: { code: 'UR-RPR-2026-AAAAAA', status: 'open' } satisfies Out<typeof ReportCreatedDto>,
      }),
    },
  ];
}

// ── My network ────────────────────────────────────────────────────────────────────────────────────────────────

/** How many rows a list state serves on its first page (empty: none; one: one; more: four and a cursor). */
const rowsFor = (c: AuditCase, cursor: string | null) =>
  c.state.list === 'empty' ? 0 : c.state.list === 'one' ? 1 : cursor ? 2 : 4;
const nextFor = (c: AuditCase, cursor: string | null) =>
  c.state.list === 'more' && !cursor ? 'next1' : null;
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

export function ustaadNetworkMocks(): Mock[] {
  return [
    meMember(),
    get(/^\/ustaad\/follows$/, MemberPageDto, (c, q) => {
      if (c.state.list === 'error') return failed();
      const cursor = q.get('cursor');
      const from = q.get('kind') === 'following' ? 20 : 1;
      return {
        body: {
          items: range(rowsFor(c, cursor), from + (cursor ? 4 : 0)).map((n) => memberAt(c, n)),
          nextCursor: nextFor(c, cursor),
        } satisfies Out<typeof MemberPageDto>,
      };
    }),
    get(/^\/ustaad\/connections$/, ConnectionPageDto, (c, q) => {
      if (c.state.list === 'error') return failed();
      const cursor = q.get('cursor');
      const box = q.get('box') ?? 'connected';
      const from = { connected: 30, incoming: 40, outgoing: 50 }[box] ?? 30;
      return {
        body: {
          items: range(rowsFor(c, cursor), from + (cursor ? 4 : 0)).map((n) => ({
            id: uuid(1800 + n),
            status: box === 'connected' ? ('accepted' as const) : ('requested' as const),
            mine: box === 'outgoing',
            other: memberAt(c, n),
            updatedAt: iso(60 * n),
          })),
          nextCursor: nextFor(c, cursor),
        } satisfies Out<typeof ConnectionPageDto>,
      };
    }),
    get(/^\/ustaad\/blocks$/, BlockListDto, (c) => {
      if (c.state.list === 'error') return failed();
      const n = c.state.list === 'empty' ? 0 : c.state.list === 'one' ? 1 : 3;
      return {
        body: {
          blocked: range(n, 60).map((i) => memberAt(c, i)),
          muted: range(n, 70).map((i) => memberAt(c, i)),
        } satisfies Out<typeof BlockListDto>,
      };
    }),
  ];
}

// ── Discover ──────────────────────────────────────────────────────────────────────────────────────────────────

function person(c: AuditCase, n: number, over: Partial<Person> = {}): Person {
  return {
    ...memberAt(c, n),
    specialities: ['two_wheeler', 'battery'],
    followers: 128,
    helpfulAnswers: 41,
    bestAnswers: 9,
    isNew: false,
    distanceBand: null,
    ...over,
  };
}

/** New member, near one, a verified master, one with counts hidden. */
const people = (c: AuditCase, from = 1): Person[] => [
  person(c, from, { distanceBand: '2to5' }),
  person(c, from + 1, { isNew: true, followers: 3, helpfulAnswers: 0, bestAnswers: 0 }),
  person(c, from + 2, { distanceBand: 'lt2', followers: null }),
  person(c, from + 3, { distanceBand: '10plus', specialities: ['electrical'] }),
];

function discoverPage(c: AuditCase, cursor: string | null): Out<typeof DiscoverPageDto> {
  if (c.state.discover === 'no-match') return { items: [], nextCursor: null };
  if (c.state.discover === 'more')
    return cursor
      ? { items: [person(c, 10), person(c, 11)], nextCursor: null }
      : { items: people(c), nextCursor: 'next1' };
  return { items: people(c), nextCursor: null };
}

export function ustaadDiscoverMocks(): Mock[] {
  return [
    meMember(),
    get(/^\/ustaad\/discover$/, DiscoverPageDto, (c, q) =>
      c.state.discover === 'error' ? failed() : { body: discoverPage(c, q.get('cursor')) },
    ),
    get(/^\/ustaad\/discover\/tags$/, DiscoverTagsDto, () => ({
      body: {
        items: [
          { slug: 'battery', nameEn: 'Battery', nameHi: 'बैटरी', uses: 14 },
          { slug: 'clutch', nameEn: 'Clutch', nameHi: 'क्लच', uses: 9 },
          { slug: 'wiring', nameEn: 'Wiring', nameHi: 'वायरिंग', uses: 4 },
        ],
      } satisfies Out<typeof DiscoverTagsDto>,
    })),
    get(/^\/ustaad\/discover\/top-posts$/, TopPostsDto, (c) => ({
      body: {
        items: [
          { id: uuid(1900), kind: 'photo', author: card(c, 2), likes: 31, saves: 6, createdAt: iso(60 * 20) },
          {
            id: uuid(1901),
            kind: 'text',
            author: card(c, 3),
            likes: null,
            saves: 2,
            createdAt: iso(60 * 30),
          },
        ],
      } satisfies Out<typeof TopPostsDto>,
    })),
    {
      method: 'PUT',
      path: /^\/ustaad\/follows\/[^/]+$/,
      schema: FollowResultDto,
      reply: (): Reply => ({
        body: { following: true, followers: 129 } satisfies Out<typeof FollowResultDto>,
      }),
    },
    {
      method: 'POST',
      path: /^\/ustaad\/connections$/,
      reply: ({ c }): Reply =>
        c.state.discover === 'cap'
          ? { status: 429, code: 'USTAAD_DAILY_CAP' }
          : { body: { id: uuid(1950), status: 'requested' } },
    },
  ];
}
