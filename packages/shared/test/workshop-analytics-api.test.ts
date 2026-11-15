import { describe, expect, it } from 'vitest';
import {
  WORKSHOP_MEDIAN_MIN,
  workshopMedians,
  workshopRates,
  WorkshopStatsDto,
  type WorkshopStats,
} from '../src/workshop-analytics-api';

const base = WorkshopStatsDto.parse({
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
});
const w = (over: Partial<WorkshopStats>): WorkshopStats => ({ ...base, ...over });

describe('workshopRates', () => {
  it('gives null for every rate without data, never 0 % from nothing', () => {
    expect(workshopRates(base)).toEqual({
      acceptancePercent: null,
      approvalPercent: null,
      declinedLinePercent: null,
      averageBillPaise: null,
      returnedPercent: null,
      photosPercent: null,
    });
  });

  it('rounds whole percents and the average bill', () => {
    const r = workshopRates(
      w({
        offersProposed: 2,
        offersDeclined: 1,
        linesSent: 3,
        linesApproved: 1,
        billed: 3,
        billedPaise: 100_000,
        completedJobs: 8,
        returnedWithin30Days: 1,
        funnel: { ...base.funnel, received: 4 },
        withPhotos: 3,
      }),
    );
    expect(r).toMatchObject({
      acceptancePercent: 67,
      approvalPercent: 33,
      averageBillPaise: 33_333,
      returnedPercent: 13,
      photosPercent: 75,
    });
  });
});

describe('workshopMedians', () => {
  it('needs three workshops with requests before it gives any median', () => {
    expect(WORKSHOP_MEDIAN_MIN).toBe(3);
    const two = workshopMedians([w({ requests: 4 }), w({ requests: 9 })]);
    expect(two.workshops).toBe(2);
    expect(Object.values(two.values).every((v) => v === null)).toBe(true);
  });

  it('takes the median of the workshops that have the figure, and only when at least three do', () => {
    const m = workshopMedians([
      w({ requests: 10, medianMinutesToPropose: 20, ratingTenths: 40 }),
      w({ requests: 30, medianMinutesToPropose: 60, ratingTenths: null }),
      w({ requests: 20, medianMinutesToPropose: 30, ratingTenths: 50 }),
      w({ requests: 0, medianMinutesToPropose: 5 }),
    ]);
    expect(m.workshops).toBe(3);
    expect(m.values.requests).toBe(20);
    // 20, 30, 60 -> 30; the workshop without requests is left out
    expect(m.values.minutesToPropose).toBe(30);
    // Only two workshops have a rating: a median of two would reveal the other one's figure (security review).
    expect(m.values.ratingTenths).toBeNull();
    expect(m.values.averageBillPaise).toBeNull();
  });

  it("leaves the asking workshop out, so it cannot work back to another workshop's figure", () => {
    const row = (id: string, requests: number) => ({ ...w({ requests }), id });
    const four = [row('a', 10), row('b', 20), row('c', 30), row('d', 40)];
    // Without "a": 20, 30, 40 -> 30.
    expect(workshopMedians(four, { excludeId: 'a' }).values.requests).toBe(30);
    // With "a" left out only two others remain: no benchmark.
    expect(workshopMedians(four.slice(0, 3), { excludeId: 'a' }).values.requests).toBeNull();
  });
});
