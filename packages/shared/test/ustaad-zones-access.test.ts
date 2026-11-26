import { describe, expect, it } from 'vitest';
import { ustaadAccessDecision } from '../src/ustaad/access';
import { bandCount, distanceBand, zoneCell, zoneCellAreaKm2, zoneNeighbours } from '../src/ustaad/zones';

describe('zoneCell (spec 23 § 6.5, pure hex grid)', () => {
  it('gives stable ids for fixed Raipur points', () => {
    // Jaistambh Chowk and the railway station: same answer on every call.
    const a = zoneCell(21.2381, 81.6337, 1400);
    expect(zoneCell(21.2381, 81.6337, 1400)).toBe(a);
    expect(a).toMatch(/^hx:-?\d+:-?\d+$/);
    // The grid origin is a cell centre.
    expect(zoneCell(21.25, 81.63, 1400)).toBe('hx:0:0');
    // ~9 km away is a different cell.
    expect(zoneCell(21.2514, 81.5536, 1400)).not.toBe(zoneCell(21.25, 81.63, 1400));
  });

  it('edge 1400 m gives an area of about 5.1 km²', () => {
    expect(zoneCellAreaKm2(1400)).toBeCloseTo(5.09, 1);
  });

  it('has six distinct neighbours, each adjacent back', () => {
    const n = zoneNeighbours('hx:0:0');
    expect(new Set(n).size).toBe(6);
    for (const c of n) expect(zoneNeighbours(c)).toContain('hx:0:0');
  });

  it('points very near one centre fall in that cell', () => {
    expect(zoneCell(21.2501, 81.6301, 1400)).toBe('hx:0:0');
  });
});

describe('bandCount (SR-31)', () => {
  const rules = { hideBelow: 5, exactFrom: 20, round: false };
  it('4 → few, 5 → band, 19 → band, 20 → exact', () => {
    expect(bandCount(4, rules)).toEqual({ kind: 'few' });
    expect(bandCount(5, rules)).toEqual({ kind: 'band', value: 5 });
    expect(bandCount(19, rules)).toEqual({ kind: 'band', value: 5 });
    expect(bandCount(20, rules)).toEqual({ kind: 'exact', value: 20 });
  });
  it('rounds to 5 above exact_from when rounding is on (23 → 25)', () => {
    expect(bandCount(23, { ...rules, round: true })).toEqual({ kind: 'exact', value: 25 });
    expect(bandCount(20, { ...rules, round: true })).toEqual({ kind: 'exact', value: 20 });
  });
  it('a hide_below under 5 is treated as 5 (the floor is locked)', () => {
    expect(bandCount(4, { ...rules, hideBelow: 2 })).toEqual({ kind: 'few' });
  });
});

describe('distanceBand (SR-29, locked edges)', () => {
  it('maps metres to band codes', () => {
    expect(distanceBand(0)).toBe('lt2');
    expect(distanceBand(1999)).toBe('lt2');
    expect(distanceBand(2000)).toBe('2to5');
    expect(distanceBand(4999)).toBe('2to5');
    expect(distanceBand(5000)).toBe('5to10');
    expect(distanceBand(9999)).toBe('5to10');
    expect(distanceBand(10_000)).toBe('10plus');
  });
});

describe('ustaadAccessDecision (staff preview switch + preview testers)', () => {
  const anon = { signedIn: false, staff: false, tester: false } as const;
  const customer = { signedIn: true, staff: false, tester: false } as const;
  const staff = { signedIn: true, staff: true, tester: false } as const;
  const tester = { signedIn: true, staff: false, tester: true } as const;
  // A tester flag without a session never counts (the API only knows testers by their signed-in user id).
  const anonTester = { signedIn: false, staff: false, tester: true } as const;
  it('off hides the network from everyone, staff and testers included', () => {
    for (const v of [anon, customer, staff, tester, anonTester])
      expect(ustaadAccessDecision('off', v)).toBe('hidden');
  });
  it('staff_preview: staff and listed testers are let in; anonymous and everyone else see "not found"', () => {
    expect(ustaadAccessDecision('staff_preview', staff)).toBe('allow');
    expect(ustaadAccessDecision('staff_preview', tester)).toBe('allow');
    expect(ustaadAccessDecision('staff_preview', customer)).toBe('hidden');
    expect(ustaadAccessDecision('staff_preview', anon)).toBe('hidden');
    expect(ustaadAccessDecision('staff_preview', anonTester)).toBe('hidden');
  });
  it('open: signed-in people go on to the member checks; anonymous must sign in', () => {
    expect(ustaadAccessDecision('open', customer)).toBe('allow');
    expect(ustaadAccessDecision('open', staff)).toBe('allow');
    expect(ustaadAccessDecision('open', tester)).toBe('allow');
    expect(ustaadAccessDecision('open', anon)).toBe('sign_in');
    expect(ustaadAccessDecision('open', anonTester)).toBe('sign_in');
  });
});
