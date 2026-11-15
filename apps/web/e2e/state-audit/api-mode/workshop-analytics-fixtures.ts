/**
 * Typed fixtures of the workshop analytics audit rows (design 2026-11-15): Admin → Analytics → Workshops
 * (`API-ADM-WORKSHOPS`: `wsa=empty|one|few|many|city-scoped|error`, long text) and the workshop portal's Performance
 * (`API-WS-PERFORMANCE`: `perf=empty|full|no-median|error|staff|ninety`). Every value is typed with the shared DTO
 * and every mock carries its schema. The portal rows also answer the job lists and home settings (both empty), so
 * only the Performance section is under test.
 */
import { HomeSettingsListDto, ServiceRequestPageDto } from '@mechdost/shared/service-api';
import {
  AdminWorkshopAnalyticsDto,
  PortalWorkshopAnalyticsDto,
  workshopMedians,
  type WorkshopStats,
} from '@mechdost/shared/workshop-analytics-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { roleMock } from './home-fixtures.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const LONG_EN =
  'Sharma Doorstep Two-Wheeler Garage and Authorised Service Centre, Telibandha Main Road, Raipur';
const LONG_HI = 'शर्मा डोरस्टेप दोपहिया गैराज और अधिकृत सर्विस सेंटर, तेलीबांधा मुख्य मार्ग, रायपुर';

const ZERO: WorkshopStats = {
  requests: 0,
  byMode: { workshop: 0, home: 0 },
  funnel: {
    requested: 0,
    proposed: 0,
    confirmed: 0,
    received: 0,
    estimateSent: 0,
    approved: 0,
    completed: 0,
  },
  cancelled: 0,
  cancelReasons: [],
  rejected: 0,
  rejectReasons: [],
  offersProposed: 0,
  offersDeclined: 0,
  medianMinutesToPropose: null,
  medianMinutesToEstimate: null,
  medianMinutesJob: null,
  estimates: 0,
  estimatesWithDeclinedLine: 0,
  linesSent: 0,
  linesApproved: 0,
  linesSentPaise: 0,
  linesApprovedPaise: 0,
  billed: 0,
  billedPaise: 0,
  visitFeesPaise: 0,
  paidCash: 0,
  paidUpi: 0,
  paidCard: 0,
  billsUnpaid: 0,
  ratingTenths: null,
  ratingCount: 0,
  completedJobs: 0,
  returnedWithin30Days: 0,
  withPhotos: 0,
};

/** A busy workshop; `k` (1..) varies the numbers so a table of them is not a column of equal values. */
function busy(k: number): WorkshopStats {
  const requests = 20 + k * 7;
  return {
    ...ZERO,
    requests,
    byMode: { workshop: requests - 5, home: 5 },
    funnel: {
      requested: requests,
      proposed: requests - 4,
      confirmed: requests - 8,
      received: requests - 10,
      estimateSent: requests - 12,
      approved: requests - 15,
      completed: requests - 18,
    },
    cancelled: 4,
    cancelReasons: [
      { code: 'changed_mind', count: 2 },
      { code: 'found_another_workshop', count: 1 },
      { code: 'something_new', count: 1 },
    ],
    rejected: 1,
    rejectReasons: [{ code: 'no_workshop_nearby', count: 1 }],
    offersProposed: requests - 4,
    offersDeclined: 2 + (k % 3),
    medianMinutesToPropose: 25 + k * 11,
    medianMinutesToEstimate: 45 + k,
    medianMinutesJob: 150 + k * 20,
    estimates: requests - 12,
    estimatesWithDeclinedLine: 5,
    linesSent: 4 * (requests - 12),
    linesApproved: 3 * (requests - 12),
    linesSentPaise: 600_000 * (requests - 12),
    linesApprovedPaise: 450_000 * (requests - 12),
    billed: requests - 18,
    billedPaise: 520_000 * (requests - 18),
    visitFeesPaise: 9_900 * 3,
    paidCash: 6,
    paidUpi: 7,
    paidCard: 1,
    billsUnpaid: 2,
    ratingTenths: 38 + (k % 12),
    ratingCount: 9 + k,
    completedJobs: requests - 18,
    returnedWithin30Days: 2,
    withPhotos: requests - 14,
  };
}

const range = (query: URLSearchParams) => ({
  from: query.get('from') ?? '2026-10-17',
  to: query.get('to') ?? '2026-11-15',
  days: 30,
});

/** The city total of a fixture list: the busy shape with the summed request count (the screen only displays it). */
function sumOf(all: readonly WorkshopStats[]): WorkshopStats {
  if (all.length === 0) return ZERO;
  return { ...busy(all.length), requests: all.reduce((a, s) => a + s.requests, 0) };
}

export function adminWorkshopAnalyticsMocks(c: AuditCase): Mock[] {
  const mode = c.state.wsa ?? 'many';
  const long = c.state.stress === 'long-text';
  const names = (i: number) => ({
    name: long ? LONG_EN : `Workshop ${String(i)}`,
    nameHi: long ? LONG_HI : `वर्कशॉप ${String(i)}`,
  });
  const count = mode === 'empty' ? 0 : mode === 'one' ? 1 : mode === 'few' ? 2 : 12;
  const rows = Array.from({ length: count }, (_, i) => ({
    id: uuid(300 + i),
    ...names(i + 1),
    // One quiet workshop at the end of a long list: zero requests, nothing to divide by.
    ...(mode === 'many' && i === count - 1 ? ZERO : busy(i + 1)),
  }));
  return [
    {
      method: 'GET',
      path: /^\/admin\/analytics\/workshops$/,
      schema: AdminWorkshopAnalyticsDto,
      reply: ({ query }): Reply => {
        if (mode === 'error') return { status: 503, code: 'QUERY_TIMEOUT' };
        return {
          body: {
            range: range(query),
            city: 'RPR',
            cities:
              mode === 'city-scoped'
                ? [{ code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' }]
                : [
                    { code: 'BHI', name: 'Bhilai', nameHi: 'भिलाई' },
                    { code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' },
                  ],
            totals: sumOf(rows),
            medians: workshopMedians(rows),
            workshops: rows,
          } satisfies Dto<typeof AdminWorkshopAnalyticsDto>,
        };
      },
    },
  ];
}

export function workshopPerformanceMocks(c: AuditCase): Mock[] {
  const mode = c.state.perf ?? 'full';
  const empty = mode === 'empty';
  const stats = empty ? ZERO : busy(2);
  const others = Array.from({ length: mode === 'no-median' ? 1 : 5 }, (_, i) => busy(i + 3));
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/workshop\/requests$/,
      schema: ServiceRequestPageDto,
      reply: (): Reply => ({
        body: { items: [], nextCursor: null } satisfies Dto<typeof ServiceRequestPageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/home-settings$/,
      schema: HomeSettingsListDto,
      reply: (): Reply => ({ body: { workshops: [] } satisfies Dto<typeof HomeSettingsListDto> }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/analytics$/,
      schema: PortalWorkshopAnalyticsDto,
      reply: ({ query }): Reply => {
        if (mode === 'error') return { status: 503, code: 'QUERY_TIMEOUT' };
        if (mode === 'staff') return { status: 403, code: 'FORBIDDEN' };
        const days = mode === 'ninety' ? 90 : 30;
        return {
          body: {
            range: { ...range(query), days },
            workshop: { id: uuid(21), name: 'Home Garage 1', nameHi: 'होम गैराज 1' },
            stats,
            cityMedians: workshopMedians(empty ? [] : [stats, ...others]),
          } satisfies Dto<typeof PortalWorkshopAnalyticsDto>,
        };
      },
    },
  ];
}
