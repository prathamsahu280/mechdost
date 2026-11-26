/**
 * Level engine (spec 23 § 9.2, SR-8, SR-9; plan task B5). Pure: the repository reads the facts in one query, calls
 * these, and writes the outcome through the level machine with a conditional UPDATE. Workstream A shipped the ladder
 * helpers; workstream B added `qualifiedFollowers()`, `levelFor()`, `levelRuleRefusal()` and `perksActive()`.
 */
import { USTAAD_LEVELS, type UstaadLevel, type UstaadMemberStatus } from './codes';

/** Position on the ladder (apprentice 0 … master 5). */
export function levelRank(level: UstaadLevel): number {
  return USTAAD_LEVELS.indexOf(level);
}

/** True when `level` is `min` or higher (Pakka+ checks for vouches, best answers). */
export function levelAtLeast(level: UstaadLevel, min: UstaadLevel): boolean {
  return levelRank(level) >= levelRank(min);
}

/** Levels whose promotion always needs a staff approval row (locked, SR-8). */
export const STAFF_REVIEW_LEVELS: readonly UstaadLevel[] = ['bada', 'master'];

/** The level a new member starts at for the track picked at join. */
export function startLevel(track: 'apprentice' | 'ustaad'): UstaadLevel {
  return track === 'ustaad' ? 'ustaad_pending' : 'apprentice';
}

/** The earned ladder above the start levels, in order. */
export const EARNED_LEVELS = ['naya', 'pakka', 'bada', 'master'] as const satisfies readonly UstaadLevel[];
export type EarnedLevel = (typeof EARNED_LEVELS)[number];

// ── Qualified followers (SR-9) ────────────────────────────────────────────────────────────────────────────────

export interface FollowerFacts {
  followerId: string;
  /** The follower's verification_state is `verified`. */
  verified: boolean;
  /** When the follower's MechDost account was created. */
  accountCreatedAt: Date;
  /** The follower's workshop (same-garage check); null = not on MechDost or home/roadside. */
  workshopId: string | null;
  status: UstaadMemberStatus;
  /** `ustaad_follows.counted`: false when the ring check removed the follow from level counting. */
  counted: boolean;
}

export interface QualifyOptions {
  /** `ustaad.levels.follower_min_age_days`. */
  minAgeDays: number;
  /** `ustaad.levels.follower_exclude_same_garage`. */
  excludeSameGarage: boolean;
  /** The followee's own workshop; null excludes nobody. */
  followeeWorkshopId: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Followers that count for levels: verified, account ≥ min age, active or restricted (banned and departed never,
 * locked), not ring-flagged, and (setting) not from the followee's own garage. The profile still shows the plain count.
 */
export function qualifiedFollowers(
  followers: readonly FollowerFacts[],
  now: Date,
  opts: QualifyOptions,
): number {
  const cutoff = now.getTime() - opts.minAgeDays * DAY_MS;
  let n = 0;
  for (const f of followers) {
    if (!f.verified || !f.counted) continue;
    if (f.status === 'banned' || f.status === 'left') continue;
    if (f.accountCreatedAt.getTime() > cutoff) continue;
    if (
      opts.excludeSameGarage &&
      opts.followeeWorkshopId !== null &&
      f.workshopId === opts.followeeWorkshopId
    )
      continue;
    n += 1;
  }
  return n;
}

// ── Level rules ───────────────────────────────────────────────────────────────────────────────────────────────

/** One rule group of `ustaad_level_rules` (a level is reached when every number of any one group is met). */
export interface LevelRule {
  level: EarnedLevel;
  ruleGroup: string;
  minFollowers: number;
  minBestAnswers: number;
  minHelpfulPct: number;
  minVerifiedYears: number;
  minVideos: number;
  minRecommendations: number;
  needsStaffReview: boolean;
  coinMultiplierBp: number;
}

const rule = (level: EarnedLevel, ruleGroup: string, over: Partial<LevelRule>): LevelRule => ({
  level,
  ruleGroup,
  minFollowers: 0,
  minBestAnswers: 0,
  minHelpfulPct: 0,
  minVerifiedYears: 0,
  minVideos: 0,
  minRecommendations: 0,
  needsStaffReview: level === 'bada' || level === 'master',
  coinMultiplierBp: 10_000,
  ...over,
});

/** The founder's demo rules (§ 9.2 table): the seed of `ustaad_level_rules` and the engine's fallback. */
export const DEFAULT_LEVEL_RULES: readonly LevelRule[] = [
  rule('naya', 'A', { minVerifiedYears: 3 }),
  rule('naya', 'B', { minRecommendations: 1, minVideos: 10 }),
  rule('pakka', 'A', { minFollowers: 100, minBestAnswers: 25 }),
  rule('bada', 'A', { minFollowers: 500, minBestAnswers: 100, minHelpfulPct: 80 }),
  rule('master', 'A', { minFollowers: 2000, minBestAnswers: 300 }),
];

export interface LevelStats {
  level: UstaadLevel;
  /** verification_state = verified (an approved staff decision). */
  verified: boolean;
  qualifiedFollowers: number;
  bestAnswers: number;
  /** Helpful votes ÷ answers seen by others over 12 months, 0–100. */
  helpfulPct: number;
  verifiedYears: number;
  videos: number;
  recommendations: number;
}

export interface LevelOutcome {
  /** The level after this step (unchanged when a review or a verification is needed). */
  level: UstaadLevel;
  /** True when a staff level review must be queued instead of promoting. */
  needsReview: boolean;
  /** The level the review is for. */
  reviewLevel: EarnedLevel | null;
  /** True when a Chhotu meets Naya but has no approved verification: open a request for them. */
  needsVerification: boolean;
}

function groupMet(r: LevelRule, s: LevelStats): boolean {
  return (
    s.qualifiedFollowers >= r.minFollowers &&
    s.bestAnswers >= r.minBestAnswers &&
    s.helpfulPct >= r.minHelpfulPct &&
    s.verifiedYears >= r.minVerifiedYears &&
    s.videos >= r.minVideos &&
    s.recommendations >= r.minRecommendations
  );
}

function nextEarned(level: UstaadLevel): EarnedLevel | null {
  if (level === 'apprentice') return 'naya';
  if (level === 'ustaad_pending') return null; // staff approval of the verification moves it
  const i = (EARNED_LEVELS as readonly UstaadLevel[]).indexOf(level);
  return EARNED_LEVELS[i + 1] ?? null;
}

/**
 * One step up the ladder (the level machine has single-step edges; the caller loops while it promotes). Never
 * drops. Naya and up need an approved verification; Bada and Master always need a staff review (locked, even if a
 * rule row says otherwise).
 */
export function levelFor(stats: LevelStats, rules: readonly LevelRule[]): LevelOutcome {
  const stay: LevelOutcome = {
    level: stats.level,
    needsReview: false,
    reviewLevel: null,
    needsVerification: false,
  };
  const next = nextEarned(stats.level);
  if (!next) return stay;
  const groups = rules.filter((r) => r.level === next);
  const met = groups.filter((r) => groupMet(r, stats));
  if (met.length === 0) return stay;
  if (!stats.verified) return { ...stay, needsVerification: true };
  const review = STAFF_REVIEW_LEVELS.includes(next) || met.every((r) => r.needsStaffReview);
  if (review) return { ...stay, needsReview: true, reviewLevel: next };
  return { ...stay, level: next };
}

/** Refusal code for an admin edit of a level rule, or null. */
export function levelRuleRefusal(r: LevelRule): 'COIN_GUARD_REQUIRED' | 'SETTING_INVARIANT' | null {
  // Money perks stay off until spec 20's order-reward guard is decided (PENDING #19).
  if (r.coinMultiplierBp > 10_000) return 'COIN_GUARD_REQUIRED';
  if (STAFF_REVIEW_LEVELS.includes(r.level) && !r.needsStaffReview) return 'SETTING_INVARIANT';
  return null;
}

/**
 * Perks run only for an active member (inactivity pauses them after `levels.inactive_pause_days`, the level stays)
 * and never during a security freeze (SR-2). Checked at use time (SR-11).
 */
export function perksActive(
  m: { lastActiveAt: Date | null; perksFrozenUntil: Date | null },
  now: Date,
  pauseDays: number,
): boolean {
  if (m.perksFrozenUntil && m.perksFrozenUntil.getTime() > now.getTime()) return false;
  if (!m.lastActiveAt) return false;
  return now.getTime() - m.lastActiveAt.getTime() <= pauseDays * DAY_MS;
}
