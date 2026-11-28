/**
 * Typed fixtures of the Mechanic Network member screens Learn, Jobs and Saved (spec 23 § 21i-L, batch D1) for the
 * API-mode audit. Every body carries the shared schema the screen parses with, so a fixture that drifts from the API
 * contract fails the case (hard rule 4). The member is a Chhotu (apprentice) so the Learn strip "N of M videos to
 * become Naya Ustaad" shows. No phone numbers or real people: sample names only.
 *
 * Row states: Learn `lessons=list|empty|error`, `saved=on|off`, `continue=yes|no`; Jobs `list=few|empty|error`,
 * `saved`, `employer=verified|unverified|none`; Saved `list=items|empty|collection|error` (collection = the first
 * collection chip is pressed by the page set-up in `hooks.ts`); every row `stress=long-text` for long en and hi names.
 */
import { MeResponseDto } from '@mechdost/shared/ustaad/dto/members';
import { LearnViewDto } from '@mechdost/shared/ustaad/dto/qa';
import { JobsResponse } from '@mechdost/shared/ustaad/dto/responses';
import { SavedPageDto, SavedSummaryDto } from '@mechdost/shared/ustaad/dto/saved';
import { MyCardDto } from '@mechdost/shared/ustaad/dto/verification';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

export const uuid = (n: number) => `00000000-0000-7000-8000-${String(1200 + n).padStart(12, '0')}`;
export const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export const long = (c: AuditCase) => c.state.stress === 'long-text';
export const LONG_EN =
  'Complete engine overhaul and electrical diagnosis for every two wheeler and four wheeler garage';
export const LONG_HI =
  'हर दोपहिया और चारपहिया गैराज के लिए पूरा इंजन ओवरहाल और बिजली की जाँच का लंबा पाठ्यक्रम';

export type Out<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;
export const get = (
  path: RegExp,
  schema: { parse(value: unknown): unknown },
  body: (c: AuditCase, q: URLSearchParams) => Reply,
): Mock => ({
  method: 'GET',
  path,
  schema,
  reply: ({ c, query }) => body(c, query),
});
export const failed = (): Reply => ({ status: 500, code: 'INTERNAL' });

export const MEMBER = {
  id: uuid(1),
  handle: 'ramesh_rpr',
  displayName: 'Ramesh Sahu',
  displayNameHi: 'रमेश साहू',
  track: 'apprentice',
  level: 'apprentice',
  status: 'active',
  restrictedMode: 'none',
  verificationState: 'unverified',
  cityCode: 'RPR',
  areaLabel: 'Telibandha',
  areaLabelHi: 'तेलीबांधा',
  workPlace: 'shop',
  garageName: null,
  showGarage: false,
  yearsClaimed: 2,
  specialities: ['two_wheeler'],
  dmMode: 'request',
  suggestMe: true,
  lang: 'en',
  official: false,
  founding: false,
  joinedAt: iso(60 * 24 * 40),
  version: 1,
} satisfies Out<typeof MeResponseDto>['member'];

export const meMember = (): Mock =>
  get(/^\/ustaad\/me$/, MeResponseDto, () => ({
    body: { member: MEMBER, staffPreview: false } satisfies Out<typeof MeResponseDto>,
  }));

export const group = {
  minFollowers: 0,
  minBestAnswers: 0,
  minHelpfulPct: 0,
  minVerifiedYears: 0,
  minVideos: 0,
  minRecommendations: 0,
};
const myCard = (): Mock =>
  get(/^\/ustaad\/me\/card$/, MyCardDto, () => ({
    body: {
      member: MEMBER,
      followers: '3',
      qualifiedFollowers: 1,
      izzat: 12,
      answers: 4,
      bestAnswers: 0,
      videos: 2,
      recommendations: 0,
      helpedThisWeek: 0,
      badges: [],
      ladder: [
        {
          level: 'naya',
          name: 'Naya Ustaad',
          perk: 'Verified tick',
          groups: [{ ...group, minVideos: 5 }],
          staffReview: false,
        },
      ],
      current: 'apprentice',
    } satisfies Out<typeof MyCardDto>,
  }));

type Lesson = Out<typeof LearnViewDto>['loose'][number];

function lessons(c: AuditCase): Out<typeof LearnViewDto> {
  if (c.state.lessons === 'empty') return { courses: [], loose: [] };
  const saved = c.state.saved === 'on';
  const cont = c.state.continue === 'yes';
  const title = (en: string, hi: string) => ({
    titleEn: long(c) ? `${en}: ${LONG_EN}` : en,
    titleHi: long(c) ? `${hi}: ${LONG_HI}` : hi,
  });
  const base = {
    segmentCode: null,
    workCode: null,
    url: null,
    label: 'mechdost_training',
    savedByMe: saved,
  } satisfies Partial<Lesson>;
  const done: Lesson = {
    ...base,
    id: uuid(51),
    kind: 'hosted_video',
    ...title('Ask a question by voice', 'बोलकर सवाल पूछो'),
    durationS: 75,
    mediaId: uuid(61),
    watchedSeconds: 75,
    completed: true,
    sizeBytes: 3_400_000,
    lastWatchedAt: iso(60 * 24 * 3),
  };
  const half: Lesson = {
    ...base,
    id: uuid(52),
    kind: 'hosted_video',
    ...title('Pin your garage on the map', 'अपना गैराज नक्शे पर लगाओ'),
    durationS: 60,
    mediaId: uuid(62),
    watchedSeconds: cont ? 20 : 0,
    completed: false,
    sizeBytes: 812_000,
    lastWatchedAt: cont ? iso(90) : null,
  };
  const link: Lesson = {
    ...base,
    id: uuid(53),
    kind: 'external_link',
    ...title('EV battery safety checklist', 'EV बैटरी सुरक्षा की जाँच-सूची'),
    segmentCode: 'ev',
    workCode: 'battery',
    label: 'none',
    durationS: 240,
    mediaId: null,
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    watchedSeconds: 0,
    completed: false,
    sizeBytes: null,
    lastWatchedAt: null,
  };
  const big: Lesson = {
    ...base,
    id: uuid(54),
    kind: 'hosted_video',
    ...title('Tubeless puncture repair in 3 minutes', 'ट्यूबलेस पंक्चर 3 मिनट में ठीक करो'),
    segmentCode: 'two_wheeler',
    workCode: 'tyres',
    label: 'none',
    durationS: 180,
    mediaId: uuid(63),
    watchedSeconds: 0,
    completed: false,
    sizeBytes: 18_700_000,
    lastWatchedAt: null,
  };
  return {
    courses: [
      {
        id: uuid(41),
        code: 'how_to_use',
        titleEn: 'How to use Mechanic Network',
        titleHi: 'मैकेनिक नेटवर्क कैसे चलाएँ',
        resources: [done, half],
      },
    ],
    loose: [link, big],
  };
}

export function ustaadLearnMocks(): Mock[] {
  return [
    meMember(),
    myCard(),
    get(/^\/ustaad\/learn$/, LearnViewDto, (c) =>
      c.state.lessons === 'error' ? failed() : { body: lessons(c) },
    ),
  ];
}

type Job = Out<typeof JobsResponse>['items'][number];

function jobs(c: AuditCase): Job[] {
  if (c.state.list === 'empty') return [];
  const saved = c.state.saved === 'on';
  const employer = (name: string, nameHi: string): Job['employer'] => {
    if (c.state.employer === 'none') return null;
    return {
      name: long(c) ? `${name} ${LONG_EN}` : name,
      nameHi: long(c) ? `${nameHi} ${LONG_HI}` : nameHi,
      verified: c.state.employer === 'verified',
    };
  };
  const one = (n: number, roleCode: Job['roleCode'], title: string, name: string, nameHi: string): Job => ({
    id: uuid(70 + n),
    code: `UJ-RPR-2026-AAAA${String(n).padStart(2, '2')}`,
    roleCode,
    title: long(c) ? `${title} ${LONG_EN}` : title,
    description: 'Daily work on bikes and scooters; tools provided.',
    areaLabel: 'Telibandha',
    areaLabelHi: 'तेलीबांधा',
    cityCode: 'RPR',
    payMinPaiseMonth: 1_200_000,
    payMaxPaiseMonth: 1_800_000,
    timing: '10 am to 7 pm, Sunday off',
    experienceMinYears: 1,
    segmentCodes: ['two_wheeler'],
    status: 'open',
    mine: false,
    savedByMe: saved,
    employer: employer(name, nameHi),
    underReview: false,
    expiresAt: iso(-60 * 24 * 20),
    createdAt: iso(60 * 5),
  });
  return [
    one(1, 'mechanic_2w', 'Two wheeler mechanic', 'Shree Auto Works', 'श्री ऑटो वर्क्स'),
    one(2, 'helper', 'Garage helper', 'Raipur Bike Care', 'रायपुर बाइक केयर'),
    one(3, 'electrician', 'Auto electrician', 'Telibandha Motors', 'तेलीबांधा मोटर्स'),
  ];
}

export function ustaadJobsMocks(): Mock[] {
  return [
    meMember(),
    get(/^\/ustaad\/jobs$/, JobsResponse, (c) =>
      c.state.list === 'error' ? failed() : { body: { items: jobs(c), next: null } },
    ),
  ];
}

const KINDS = ['post', 'question', 'answer', 'job', 'lesson'] as const;
const COLLECTION = uuid(90);

type SavedItem = Out<typeof SavedPageDto>['items'][number];

function savedItems(c: AuditCase): SavedItem[] {
  if (c.state.list === 'empty') return [];
  const withCollection = c.state.list === 'collection' || c.state.list === 'items';
  const words = (s: string) => (long(c) ? `${s} ${LONG_EN}` : s);
  return KINDS.map((kind, i): SavedItem => {
    const lesson = kind === 'lesson';
    return {
      kind,
      id: uuid(100 + i),
      savedAt: iso(30 + i * 400),
      text: words(
        {
          post: 'Changed the clutch plate on a Splendor today, here is what I found',
          question: 'Why does my Activa idle rough after the rain?',
          answer: 'Check the spark plug cap first, water gets in there',
          job: 'Two wheeler mechanic wanted in Telibandha',
          lesson: 'Tubeless puncture repair in 3 minutes',
        }[kind],
      ),
      textHi: lesson ? words('ट्यूबलेस पंक्चर 3 मिनट में ठीक करो') : null,
      code:
        kind === 'question' || kind === 'answer'
          ? 'UQ-RPR-2026-AAAAA2'
          : kind === 'job'
            ? 'UJ-RPR-2026-AAAAA2'
            : null,
      collectionIds: withCollection && i < 2 ? [COLLECTION] : [],
    };
  });
}

function summary(c: AuditCase): Out<typeof SavedSummaryDto> {
  const items = savedItems(c);
  const counts = Object.fromEntries(
    KINDS.map((k) => [k, items.filter((i) => i.kind === k).length]),
  ) as Record<(typeof KINDS)[number], number>;
  const collections =
    items.length === 0
      ? []
      : [
          {
            id: COLLECTION,
            name: long(c) ? `Engine tips ${LONG_EN}` : 'Engine tips',
            count: items.filter((i) => i.collectionIds.includes(COLLECTION)).length,
            version: 1,
          },
        ];
  return { total: items.length, counts, collections };
}

export function ustaadSavedMocks(): Mock[] {
  return [
    meMember(),
    get(/^\/ustaad\/saves\/summary$/, SavedSummaryDto, (c) =>
      c.state.list === 'error' ? failed() : { body: summary(c) },
    ),
    get(/^\/ustaad\/saves$/, SavedPageDto, (c, q) => {
      if (c.state.list === 'error') return failed();
      const kind = q.get('kind');
      const collection = q.get('collectionId');
      const word = (q.get('q') ?? '').toLowerCase();
      const items = savedItems(c).filter(
        (i) =>
          (!kind || i.kind === kind) &&
          (!collection || i.collectionIds.includes(collection)) &&
          (!word || i.text.toLowerCase().includes(word)),
      );
      return { body: { items, nextCursor: null } };
    }),
  ];
}
