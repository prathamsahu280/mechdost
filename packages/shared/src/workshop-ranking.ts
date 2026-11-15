/**
 * Ranked workshop suggestions for admin routing of service requests (spec 06 "Ranking", spec 08; design 2026-11-15,
 * item 7). Pure and integer-only: every factor is turned into basis points (0 to 10 000, higher is better), the
 * weighted mean is the score, and ties are broken the same way every time, so the same inputs always give the same
 * order. A busy workshop and one that is not `approved` (paused, suspended) is never ranked, whatever else it scores.
 *
 * Factors (equal weights to start; `WORKSHOP_RANK_WEIGHTS` is the one place to tune, admin-tunable later, Q151):
 * distance (nearer is better, only inside the radius), rating, acceptance rate, median time to propose, current load
 * (open jobs against capacity). A factor without data scores the neutral 5 000 and says so in its reason, so a new
 * workshop is neither punished nor favoured.
 */

export const RANK_FACTORS = ['distance', 'rating', 'acceptance', 'speed', 'load'] as const;
export type RankFactor = (typeof RANK_FACTORS)[number];

/** Equal weights to start (builder ruling 2026-11-15). */
export const WORKSHOP_RANK_WEIGHTS: Readonly<Record<RankFactor, number>> = {
  distance: 1,
  rating: 1,
  acceptance: 1,
  speed: 1,
  load: 1,
};

/** Nearest within this many km of the customer's pin (the city search radius, builder ruling 2026-11-15). */
export const RANK_RADIUS_KM = 25;
/** A median time to propose of this many minutes or more scores 0. */
export const RANK_SLOW_MINUTES = 240;
/** Live jobs one unit of hourly slot capacity is taken to carry (load = open jobs / (capacity x this)). */
export const RANK_JOBS_PER_CAPACITY = 4;

export const NEUTRAL_BP = 5000;

export interface RankCandidate {
  workshopId: string;
  /** Metres from the customer's pin to the workshop, null when the request has no pin. */
  distanceM: number | null;
  /** Average stars x 100 (450 = 4.5), null without reviews. */
  ratingX100: number | null;
  /** Proposed / (proposed + declined) as a whole percent, null without answered offers. */
  acceptancePercent: number | null;
  medianMinutesToPropose: number | null;
  /** Live jobs now (awaiting a proposal up to billing) and the owner's slot capacity per hour. */
  openJobs: number;
  slotCapacity: number;
  busy: boolean;
  /** `approved` | `paused` | `suspended`. */
  status: string;
}

export interface RankReason {
  factor: RankFactor;
  /** 0 to 10 000. */
  scoreBp: number;
  /** False when the value was missing and the neutral score was used. */
  known: boolean;
}

export interface RankedWorkshop {
  workshopId: string;
  /** 0 to 10 000. */
  scoreBp: number;
  /** 1 = best. */
  rank: number;
  reasons: RankReason[];
}

const clampBp = (n: number): number => Math.max(0, Math.min(10_000, Math.round(n)));

/** Each factor as basis points; `null` when the candidate has no value for it. */
export function factorScoreBp(
  c: RankCandidate,
  factor: RankFactor,
  radiusKm = RANK_RADIUS_KM,
): number | null {
  switch (factor) {
    case 'distance':
      return c.distanceM === null ? null : clampBp(10_000 - (c.distanceM * 10_000) / (radiusKm * 1000));
    case 'rating':
      return c.ratingX100 === null ? null : clampBp((c.ratingX100 * 10_000) / 500);
    case 'acceptance':
      return c.acceptancePercent === null ? null : clampBp(c.acceptancePercent * 100);
    case 'speed':
      return c.medianMinutesToPropose === null
        ? null
        : clampBp(10_000 - (c.medianMinutesToPropose * 10_000) / RANK_SLOW_MINUTES);
    case 'load':
      return clampBp(10_000 - (c.openJobs * 10_000) / (Math.max(1, c.slotCapacity) * RANK_JOBS_PER_CAPACITY));
  }
}

/** Is this workshop allowed in the list at all? (busy, paused, suspended and out-of-radius ones are not.) */
export function isRankable(c: RankCandidate, radiusKm = RANK_RADIUS_KM): boolean {
  if (c.busy || c.status !== 'approved') return false;
  return c.distanceM === null || c.distanceM <= radiusKm * 1000;
}

export function scoreCandidate(
  c: RankCandidate,
  weights: Readonly<Record<RankFactor, number>> = WORKSHOP_RANK_WEIGHTS,
  radiusKm = RANK_RADIUS_KM,
): { scoreBp: number; reasons: RankReason[] } {
  const reasons: RankReason[] = RANK_FACTORS.map((factor) => {
    const s = factorScoreBp(c, factor, radiusKm);
    return { factor, scoreBp: s ?? NEUTRAL_BP, known: s !== null };
  });
  const total = RANK_FACTORS.reduce((n, f) => n + weights[f], 0);
  const sum = reasons.reduce((n, r) => n + r.scoreBp * weights[r.factor], 0);
  return { scoreBp: total === 0 ? 0 : clampBp(sum / total), reasons };
}

/**
 * The ranked list, best first. Ties: higher score, then the nearer workshop (no pin sorts last), then the lower
 * workshop id, so the order never depends on the order the candidates came in.
 */
export function rankWorkshops(
  candidates: readonly RankCandidate[],
  opts: { weights?: Readonly<Record<RankFactor, number>>; radiusKm?: number } = {},
): RankedWorkshop[] {
  const radius = opts.radiusKm ?? RANK_RADIUS_KM;
  const scored = candidates
    .filter((c) => isRankable(c, radius))
    .map((c) => ({ c, ...scoreCandidate(c, opts.weights, radius) }));
  scored.sort(
    (a, b) =>
      b.scoreBp - a.scoreBp ||
      (a.c.distanceM ?? Infinity) - (b.c.distanceM ?? Infinity) ||
      (a.c.workshopId < b.c.workshopId ? -1 : a.c.workshopId > b.c.workshopId ? 1 : 0),
  );
  return scored.map((s, i) => ({
    workshopId: s.c.workshopId,
    scoreBp: s.scoreBp,
    rank: i + 1,
    reasons: s.reasons,
  }));
}
