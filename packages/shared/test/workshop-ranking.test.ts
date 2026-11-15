/** Ranked workshop suggestions (item 7): never busy/paused/suspended, deterministic ties, property checks. */
import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_BP,
  RANK_RADIUS_KM,
  rankWorkshops,
  scoreCandidate,
  type RankCandidate,
} from '../src/workshop-ranking';

const base = (id: string, over: Partial<RankCandidate> = {}): RankCandidate => ({
  workshopId: id,
  distanceM: 2000,
  ratingX100: 450,
  acceptancePercent: 80,
  medianMinutesToPropose: 30,
  openJobs: 1,
  slotCapacity: 2,
  busy: false,
  status: 'approved',
  ...over,
});

/** Small seeded PRNG (mulberry32) so the property runs are reproducible; fast-check is not a dependency. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const maybe = (r: () => number, n: number): number | null => (r() < 0.2 ? null : Math.round(r() * n));

function randomCandidates(seed: number): RankCandidate[] {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 12);
  return Array.from({ length: n }, (_, i) => ({
    workshopId: `w-${String(Math.floor(r() * 1000)).padStart(4, '0')}-${String(i)}`,
    distanceM: maybe(r, 40_000),
    ratingX100: maybe(r, 500),
    acceptancePercent: maybe(r, 100),
    medianMinutesToPropose: maybe(r, 600),
    openJobs: Math.floor(r() * 30),
    slotCapacity: 1 + Math.floor(r() * 5),
    busy: r() < 0.3,
    status: pick(r, ['approved', 'approved', 'paused', 'suspended']),
  }));
}

describe('rankWorkshops', () => {
  it('puts the nearer, better, faster, less loaded workshop first and explains every factor', () => {
    const out = rankWorkshops([
      base('far', { distanceM: 20_000, ratingX100: 300, openJobs: 7 }),
      base('best', { distanceM: 500, ratingX100: 490 }),
    ]);
    expect(out.map((x) => x.workshopId)).toEqual(['best', 'far']);
    expect(out[0]?.rank).toBe(1);
    expect(out[0]?.reasons.map((x) => x.factor)).toEqual([
      'distance',
      'rating',
      'acceptance',
      'speed',
      'load',
    ]);
  });

  it('scores a missing value neutrally and marks it unknown (a new workshop is not punished)', () => {
    const { reasons } = scoreCandidate(base('new', { ratingX100: null, acceptancePercent: null }));
    const rating = reasons.find((x) => x.factor === 'rating');
    expect(rating).toEqual({ factor: 'rating', scoreBp: NEUTRAL_BP, known: false });
  });

  it('leaves out workshops beyond the radius but keeps one with no pin to measure from', () => {
    const out = rankWorkshops([
      base('out', { distanceM: (RANK_RADIUS_KM + 1) * 1000 }),
      base('nopin', { distanceM: null }),
    ]);
    expect(out.map((x) => x.workshopId)).toEqual(['nopin']);
  });

  it('breaks exact ties by distance, then by id, whatever the input order', () => {
    const a = base('a', { distanceM: 1000 });
    const b = base('b', { distanceM: 1000 });
    const near = base('z', { distanceM: 900, ratingX100: 450 });
    const flip = rankWorkshops([b, a]).map((x) => x.workshopId);
    expect(flip).toEqual(['a', 'b']);
    // Same score on every factor but distance cannot tie; equal scores fall through to distance.
    const eq1 = base('m', { distanceM: null });
    const eq2 = base('n', { distanceM: null });
    expect(rankWorkshops([eq2, eq1]).map((x) => x.workshopId)).toEqual(['m', 'n']);
    expect(rankWorkshops([a, b, near])[0]?.workshopId).toBe('z');
  });

  it('property: busy, paused or suspended workshops are never ranked (300 random sets)', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const out = rankWorkshops(randomCandidates(seed));
      const byId = new Map(randomCandidates(seed).map((c) => [c.workshopId, c]));
      for (const x of out) {
        const c = byId.get(x.workshopId);
        expect(c?.busy).toBe(false);
        expect(c?.status).toBe('approved');
      }
    }
  });

  it('property: deterministic, input order never matters, scores sorted, ranks 1..n (300 random sets)', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const cands = randomCandidates(seed);
      const a = rankWorkshops(cands);
      const b = rankWorkshops([...cands].reverse());
      expect(b).toEqual(a);
      expect(a.map((x) => x.rank)).toEqual(a.map((_, i) => i + 1));
      for (let i = 1; i < a.length; i += 1)
        expect((a[i - 1]?.scoreBp ?? 0) >= (a[i]?.scoreBp ?? 0)).toBe(true);
      for (const x of a) {
        expect(Number.isInteger(x.scoreBp)).toBe(true);
        expect(x.scoreBp).toBeGreaterThanOrEqual(0);
        expect(x.scoreBp).toBeLessThanOrEqual(10_000);
      }
    }
  });

  it('property: a nearer workshop with otherwise identical numbers never ranks below a farther one', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const r = rng(seed);
      const d1 = Math.floor(r() * 20_000);
      const d2 = d1 + 1 + Math.floor(r() * 4000);
      const out = rankWorkshops([base('far', { distanceM: d2 }), base('near', { distanceM: d1 })]);
      expect(out.map((x) => x.workshopId)).toEqual(['near', 'far']);
    }
  });
});
