/** Real-API QA pass 3 (2026-11-16), bugs 4 to 6: payment wording, the job card's estimate, the before photo gate. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { billPaidKey } from '../src/lib/bill-paid';
import { estimateSummary } from '../src/lib/estimate-summary';
import { beforePhotoMissing, photoStageNeeded } from '../src/lib/service-views';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const line = (
  id: string,
  unitPaise: number,
  decision: 'pending' | 'approved' | 'declined',
  gstRateBp = 0,
) => ({
  id,
  lineNo: 1,
  description: id,
  serviceKey: null,
  qty: 1,
  unitPaise,
  gstRateBp,
  decision,
});

describe('bug 4: how the bill was paid', () => {
  it('online payments are not "at the workshop"', () => {
    expect(billPaidKey('online')).toBe('billPaidOnline');
    for (const m of ['cash', 'upi', 'card', null]) expect(billPaidKey(m)).toBe('billPaid');
  });
  it('both languages have the online sentence and the screen uses the helper', () => {
    expect(en.request.billPaidOnline).toMatch(/online/i);
    expect(hi.request.billPaidOnline).not.toBe(en.request.billPaidOnline);
    expect(read('components/workshops/service-estimate.tsx')).toMatch(/billPaidKey\(/);
  });
});

describe('bug 5: the job card estimate', () => {
  const items = [
    line('a', 100_000, 'approved'),
    line('b', 65_000, 'declined'),
    line('c', 25_000, 'approved'),
  ];
  it('totals the approved lines only once the customer decided (integer paise, same as the bill)', () => {
    const s = estimateSummary({ status: 'decided', items }, null);
    expect(s.totalPaise).toBe(125_000);
    expect(s.lines.map((l) => l.decision)).toEqual(['approved', 'declined', 'approved']);
  });
  it('counts every line while the customer has not decided yet', () => {
    const pending = items.map((l) => ({ ...l, decision: 'pending' as const }));
    expect(estimateSummary({ status: 'sent', items: pending }, null).totalPaise).toBe(190_000);
  });
  it('uses the stored bill total when a bill exists', () => {
    const bill = { totalPaise: 125_000, gstRegistered: false };
    expect(estimateSummary({ status: 'decided', items }, bill).totalPaise).toBe(125_000);
    expect(estimateSummary({ status: 'decided', items }, bill).withGst).toBe(false);
  });
  it('says GST only when the workshop charges it', () => {
    const plain = estimateSummary({ status: 'sent', items: [line('a', 100_000, 'pending')] }, null);
    expect(plain.withGst).toBe(false);
    const gst = estimateSummary({ status: 'sent', items: [line('a', 100_000, 'pending', 1800)] }, null);
    expect(gst.withGst).toBe(true);
    expect(gst.totalPaise).toBe(118_000);
  });
  it('the card shows a mark per line and has a no-GST sentence in both languages', () => {
    expect(read('components/portal/workshop-portal-api.tsx')).toMatch(/estimateSummary\(/);
    for (const k of ['estimateSummaryNoGst', 'lineApproved', 'lineDeclined', 'linePending'] as const) {
      expect(en.portal[k]).toBeTruthy();
      expect(hi.portal[k]).toBeTruthy();
    }
  });
});

describe('bug 6: a before photo gates "Vehicle received"', () => {
  it('missing only when required and no before photo', () => {
    expect(beforePhotoMissing({ required: true, photos: [] })).toBe(true);
    expect(beforePhotoMissing({ required: true, photos: [{ stage: 'after' }] })).toBe(true);
    expect(beforePhotoMissing({ required: true, photos: [{ stage: 'before' }] })).toBe(false);
    expect(beforePhotoMissing({ required: false, photos: [] })).toBe(false);
  });
  it('the "Needed" badge goes once the stage has a photo', () => {
    expect(photoStageNeeded(true, 0)).toBe(true);
    expect(photoStageNeeded(true, 1)).toBe(false);
    expect(photoStageNeeded(false, 0)).toBe(false);
    expect(read('components/photos/job-photos-panel.tsx')).toMatch(/photoStageNeeded\(/);
  });
  it('the receive form re-checks when photos change', () => {
    const f = read('components/portal/workshop-job-api.tsx');
    expect(f).toMatch(/beforePhotoMissing\(/);
    expect(read('components/portal/workshop-portal-api.tsx')).toMatch(/<OdometerFormApi[^>]*photosTick/);
  });
});
