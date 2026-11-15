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

  it('takes the median of the workshops that have the figure, ignoring those without', () => {
    const m = workshopMedians([
      w({ requests: 10, medianMinutesToPropose: 20, ratingTenths: 40 }),
      w({ requests: 30, medianMinutesToPropose: 60, ratingTenths: null }),
      w({ requests: 20, medianMinutesToPropose: null, ratingTenths: 50 }),
      w({ requests: 0, medianMinutesToPropose: 5 }),
    ]);
    expect(m.workshops).toBe(3);
    expect(m.values.requests).toBe(20);
    // 20 and 60 -> 40; the workshop without a figure and the one without requests are left out
    expect(m.values.minutesToPropose).toBe(40);
    expect(m.values.ratingTenths).toBe(45);
    expect(m.values.averageBillPaise).toBeNull();
  });
});
