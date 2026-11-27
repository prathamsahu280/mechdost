/**
 * Workshop portal tabs (partner portals UI upgrade, batch B; design 2026-11-27 § 6): lanes by status, the job step
 * rail, estimate totals by line state, Today tiles, hour chips, bullet-bar scale and the old links after the split.
 */
import { describe, expect, it } from 'vitest';
import { NOTICE_CATALOGUE, noticeKinds } from '@mechdost/shared/notice-catalogue';
import type { EstimateLine } from '@mechdost/shared/service-bill';
import {
  WORKSHOP_LANES,
  WORKSHOP_TABS,
  bulletScale,
  countText,
  estimateTotals,
  hourChip,
  jobStep,
  laneOf,
  legacyWorkshopTarget,
  lineStateKey,
  pickLane,
  workshopKpis,
  workshopTabFor,
} from '../src/lib/workshop-portal-view';

const line = (
  id: string,
  unitPaise: number,
  decision: EstimateLine['decision'],
  gstRateBp = 0,
): EstimateLine => ({
  id,
  description: id,
  qty: 1,
  unitPaise,
  gstRateBp,
  decision,
});

describe('lanes', () => {
  it('maps every status of the design table to one lane', () => {
    expect(laneOf('proposed')).toBe('proposed');
    expect(laneOf('confirmed')).toBe('confirmed');
    for (const s of [
      'vehicle_received',
      'estimate_sent',
      'approved',
      'no_work_approved',
      'in_progress',
    ] as const)
      expect(laneOf(s)).toBe('in_workshop');
    expect(laneOf('ready')).toBe('ready_bill');
    expect(laneOf('billed')).toBe('ready_bill');
    for (const s of ['paid', 'completed', 'cancelled', 'rejected'] as const) expect(laneOf(s)).toBe('done');
    expect(laneOf('requested')).toBeNull();
    expect(WORKSHOP_LANES).toEqual(['proposed', 'confirmed', 'in_workshop', 'ready_bill', 'done']);
  });

  it('keeps a valid ?lane=, otherwise opens the first lane with work', () => {
    const counts = { proposed: 0, confirmed: 0, in_workshop: 2, ready_bill: 1, done: 4 };
    expect(pickLane('done', counts)).toBe('done');
    expect(pickLane('nonsense', counts)).toBe('in_workshop');
    expect(pickLane(null, { ...counts, in_workshop: 0, ready_bill: 0, done: 0 })).toBe('proposed');
  });

  it('says 20+ when the list has another page', () => {
    expect(countText(20, true)).toBe('20+');
    expect(countText(3, false)).toBe('3');
  });
});

describe('job step rail', () => {
  it('numbers the six steps from the status', () => {
    expect(jobStep('confirmed')).toBeNull();
    expect(jobStep('vehicle_received')).toEqual({ index: 0, allDone: false });
    expect(jobStep('estimate_sent')).toEqual({ index: 1, allDone: false });
    expect(jobStep('no_work_approved')).toEqual({ index: 1, allDone: false });
    expect(jobStep('in_progress')).toEqual({ index: 2, allDone: false });
    expect(jobStep('ready')).toEqual({ index: 3, allDone: false });
    expect(jobStep('billed')).toEqual({ index: 4, allDone: false });
    expect(jobStep('paid')).toEqual({ index: 5, allDone: true });
    expect(jobStep('completed')).toEqual({ index: 5, allDone: true });
  });
});

describe('estimate totals by line state', () => {
  it('splits approved, waiting and declined; approved matches the bill maths', () => {
    const t = estimateTotals([
      line('a', 180_000, 'approved', 1800),
      line('b', 65_000, 'approved'),
      line('c', 30_000, 'pending'),
      line('d', 70_000, 'declined'),
    ]);
    // 1800 + 18 % = 2124, + 650 = 2774 (rounded to the rupee like the bill).
    expect(t.approvedPaise).toBe(277_400);
    expect(t.waitingPaise).toBe(30_000);
    expect(t.declinedPaise).toBe(70_000);
    expect(t.anyApproved).toBe(true);
  });

  it('never claims an approved total before a line is approved', () => {
    const t = estimateTotals([line('a', 10_000, 'pending')]);
    expect(t.anyApproved).toBe(false);
    expect(t.approvedPaise).toBe(0);
  });

  it('names each state in words', () => {
    expect(lineStateKey('approved')).toBe('line_approved');
    expect(lineStateKey('pending')).toBe('line_waiting');
    expect(lineStateKey('declined')).toBe('line_declined');
  });
});

describe('Today tiles', () => {
  // Each tile counts exactly the lane it opens (builder ruling 2026-11-27): "Waiting for the customer" = the Proposed
  // lane; an estimate waiting for the customer is work in the workshop; a confirmed visit has its own lane.
  it('counts from the new and active lists, one lane per tile', () => {
    const row = (status: string, waitingForCustomer = false) => ({ status, waitingForCustomer }) as const;
    const k = workshopKpis(
      { count: 2, more: false },
      {
        items: [
          row('proposed', true),
          row('proposed', true),
          row('confirmed'),
          row('estimate_sent', true),
          row('in_progress'),
          row('vehicle_received'),
          row('ready'),
          row('billed'),
        ],
        more: true,
      },
    );
    expect(k).toEqual({
      new_requests: '2',
      waiting_customer: '2+',
      in_workshop: '3+',
      to_bill: '2+',
    });
  });
});

describe('hour chips', () => {
  it('says how many places are free or that the hour is full', () => {
    expect(hourChip({ hour: 9, free: 2 })).toEqual({ time: '09:00', full: false, free: 2 });
    expect(hourChip({ hour: 14, free: 0 })).toEqual({ time: '14:00', full: true, free: 0 });
  });
});

describe('bullet bar scale', () => {
  it('percent measures use 0–100', () => {
    expect(bulletScale(80, 60, 'percent')).toEqual({ valuePct: 80, medianPct: 60 });
  });
  it('other measures leave headroom over the larger of value and median', () => {
    expect(bulletScale(40, 50, 'count')).toEqual({ valuePct: 64, medianPct: 80 });
  });
  it('has no marker without a city median', () => {
    expect(bulletScale(10, null, 'count').medianPct).toBeNull();
    expect(bulletScale(0, null, 'count')).toEqual({ valuePct: 0, medianPct: null });
  });
});

describe('tabs and old links after the split', () => {
  it('has the v1 tabs of the design (no calendar until the API carries the accepted hour)', () => {
    expect(WORKSHOP_TABS.map((t) => t.key)).toEqual(['today', 'jobs', 'numbers', 'profile']);
    expect(WORKSHOP_TABS.map((t) => t.path)).toEqual([
      '/partner/workshop',
      '/partner/workshop/jobs',
      '/partner/workshop/numbers',
      '/partner/workshop/profile',
    ]);
  });

  it('maps the old anchors of the one-page portal to their tab', () => {
    expect(legacyWorkshopTarget('#jobs-title')).toBe('/partner/workshop/jobs');
    expect(legacyWorkshopTarget('#completed-jobs')).toBe('/partner/workshop/jobs?lane=done');
    expect(legacyWorkshopTarget('#new-requests')).toBeNull();
    expect(legacyWorkshopTarget('')).toBeNull();
  });

  it('every stored workshop notice opens Today, which keeps roadside offers and new requests', () => {
    const kinds = noticeKinds().filter((k) => NOTICE_CATALOGUE[k].link({}).startsWith('/partner/workshop'));
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(workshopTabFor(NOTICE_CATALOGUE[k].link({}))).toBe('today');
    expect(workshopTabFor('/partner/workshop/jobs?job=SR-1')).toBe('jobs');
  });
});
