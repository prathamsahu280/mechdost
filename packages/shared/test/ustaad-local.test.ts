import { describe, expect, it } from 'vitest';
import {
  accuracyBand,
  bandZone,
  jobScamSignals,
  normaliseDigits,
  noisyDistanceBand,
  pinChangeDecision,
  type PinChangeRules,
} from '../src/ustaad/local';

const RULES: PinChangeRules = { perDay: 3, per30d: 6, gpsMaxM: 100, bigMoveM: 1000, bigMoveAccuracyM: 50 };
const NOW = new Date('2026-11-26T06:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('noisyDistanceBand (SR-29)', () => {
  it('same pair, same noise → same band on every call', () => {
    const bands = Array.from({ length: 20 }, () => noisyDistanceBand(4_800, 0.37));
    expect(new Set(bands).size).toBe(1);
  });
  it('returns only band codes, never a number', () => {
    for (const m of [0, 1_500, 3_000, 7_000, 50_000])
      expect(['lt2', '2to5', '5to10', '10plus']).toContain(noisyDistanceBand(m, 0.9));
  });
  it('noise moves a distance near an edge across it', () => {
    expect(noisyDistanceBand(1_900, 0.99)).toBe('2to5');
    expect(noisyDistanceBand(2_100, 0)).toBe('lt2');
  });
  it('bad noise input falls back to no perturbation', () => {
    expect(noisyDistanceBand(3_000, Number.NaN)).toBe('2to5');
  });
});

describe('pinChangeDecision (SR-30, AT-LOC-1)', () => {
  const gps = { source: 'gps' as const, accuracyM: 20, now: NOW };
  it('first pin is free', () => {
    expect(pinChangeDecision({ ...gps, moveM: null, recentChanges: [] }, RULES)).toEqual({
      ok: true,
      counts: false,
    });
  });
  it('4th change in 24 h → USTAAD_PIN_LIMIT', () => {
    const recent = [hoursAgo(1), hoursAgo(2), hoursAgo(3)];
    expect(pinChangeDecision({ ...gps, moveM: 300, recentChanges: recent }, RULES)).toEqual({
      ok: false,
      code: 'USTAAD_PIN_LIMIT',
    });
  });
  it('7th change in 30 days → USTAAD_PIN_LIMIT', () => {
    const recent = [48, 96, 200, 300, 400, 500].map(hoursAgo);
    expect(pinChangeDecision({ ...gps, moveM: 300, recentChanges: recent }, RULES)).toMatchObject({
      ok: false,
      code: 'USTAAD_PIN_LIMIT',
    });
  });
  it('changes older than 30 days do not count', () => {
    const recent = [800, 900, 1000, 1100, 1200, 1300].map(hoursAgo);
    expect(pinChangeDecision({ ...gps, moveM: 300, recentChanges: recent }, RULES)).toEqual({
      ok: true,
      counts: true,
    });
  });
  it('a move over 1 km needs a ≤ 50 m GPS fix', () => {
    expect(
      pinChangeDecision({ ...gps, accuracyM: 80, moveM: 1_500, recentChanges: [] }, RULES),
    ).toMatchObject({ ok: false, code: 'USTAAD_PIN_FIX_REQUIRED' });
    expect(
      pinChangeDecision({ source: 'manual', accuracyM: 0, moveM: 1_500, recentChanges: [], now: NOW }, RULES),
    ).toMatchObject({ ok: false, code: 'USTAAD_PIN_FIX_REQUIRED' });
    expect(pinChangeDecision({ ...gps, accuracyM: 40, moveM: 1_500, recentChanges: [] }, RULES)).toEqual({
      ok: true,
      counts: true,
    });
  });
  it('weak GPS is not a pin (landmark path)', () => {
    expect(pinChangeDecision({ ...gps, accuracyM: 150, moveM: null, recentChanges: [] }, RULES)).toEqual({
      ok: false,
      code: 'USTAAD_PIN_GPS_WEAK',
    });
  });
  it('a zero-metre save never counts', () => {
    const recent = [hoursAgo(1), hoursAgo(2), hoursAgo(3)];
    expect(pinChangeDecision({ ...gps, moveM: 0, recentChanges: recent }, RULES)).toEqual({
      ok: true,
      counts: false,
    });
  });
  it('accuracy bands for analytics', () => {
    expect([5, 30, 80, 300].map(accuracyBand)).toEqual(['lt20', '20to50', '50to100', 'gt100']);
  });
});

describe('bandZone (SR-31, AT-LOC-2)', () => {
  const rules = { hideBelow: 5, exactFrom: 20, round: true };
  it('a zone of 4 shows few', () => {
    expect(bandZone({ members: 4, bySegment: {} }, rules).total).toEqual({ kind: 'few' });
  });
  it('a 1-member speciality cell is suppressed', () => {
    const z = bandZone({ members: 30, bySegment: { ev: 1, two_wheeler: 29 } }, rules);
    expect(z.segments.ev).toEqual({ kind: 'few' });
  });
  it('complementary suppression: total minus visible cells never reveals a small cell', () => {
    const z = bandZone({ members: 33, bySegment: { ev: 2, two_wheeler: 21, car: 10 } }, rules);
    expect(z.segments.ev).toEqual({ kind: 'few' });
    // The next smallest cell is suppressed too, so ev + car (12) is hidden together.
    expect(z.segments.car).toEqual({ kind: 'few' });
    expect(z.segments.two_wheeler?.kind).toBe('exact');
    // The total is rounded to five.
    expect(z.total).toEqual({ kind: 'exact', value: 35 });
  });
  it('the floor 5 holds even when a lower value is stored', () => {
    expect(bandZone({ members: 3, bySegment: {} }, { ...rules, hideBelow: 1 }).total).toEqual({
      kind: 'few',
    });
  });
  it('5–19 reads "5+"', () => {
    expect(bandZone({ members: 12, bySegment: {} }, rules).total).toEqual({ kind: 'band', value: 5 });
  });
});

describe('jobScamSignals (AT-JOB-1)', () => {
  it('holds fee phrases in English and Hindi', () => {
    expect(jobScamSignals('Registration fee 500 rupees before joining')).toContain('fee_phrase');
    expect(jobScamSignals('जॉइन करने से पहले रजिस्ट्रेशन फीस जमा करें')).toContain('fee_phrase');
    expect(jobScamSignals('पहले ५०० रुपये भेजो')).toContain('fee_phrase');
  });
  it('holds a UPI id but not an email address', () => {
    expect(jobScamSignals('send to ramesh123@okaxis')).toContain('upi_id');
    expect(jobScamSignals('mail me at owner@garage.in')).not.toContain('upi_id');
  });
  it('UPI ids at sentence end, followed by text, or with zero-width characters inside', () => {
    expect(jobScamSignals('pay 50 to ramesh@ybl.')).toContain('upi_id');
    expect(jobScamSignals('Send to ramesh@okaxis. Then come')).toContain('upi_id');
    expect(jobScamSignals('ram\u200besh@ok\u200daxis')).toContain('upi_id');
    expect(jobScamSignals('id: shop.owner@someupi please')).toContain('upi_id');
    expect(jobScamSignals('write to hr@mechdost.in or hr@garage.co.in')).not.toContain('upi_id');
  });
  it('normalises digits of any script for the filters', () => {
    expect(normaliseDigits('६३०१ and ৬৩')).toBe('6301 and 63');
  });
  it('holds "paytm karo"', () => {
    expect(jobScamSignals('paytm karo 300')).toContain('pay_app');
  });
  it('admin phrases add to the defaults', () => {
    expect(jobScamSignals('kit charge lagega', ['kit charge'])).toEqual(['fee_phrase']);
  });
  it('a clean job passes', () => {
    expect(jobScamSignals('Need a 2-wheeler mechanic, 10am to 7pm, salary 15000 to 20000 per month')).toEqual(
      [],
    );
  });
});
