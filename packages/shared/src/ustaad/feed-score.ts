/**
 * Feed ranking (spec 23 § 9.5): a pure, unit-tested score. Weights come from the admin settings `ustaad.feed.w_*`
 * (sum 100, checked on save). Terms, each in [0, 1] before its weight:
 *  - follows: the viewer follows the author;
 *  - city: the post is from the viewer's city;
 *  - tag: the post carries a tag the viewer follows, or its vehicle segment is one of the viewer's specialities;
 *  - recency: 0.5^(age / 3 days);
 *  - helpful: Wilson lower bound of (likes + saves) over max(views, likes + saves). Nothing counts post views yet
 *    (story views only), so n is at least the positives; with no reactions the term is 0.
 * Likes never touch levels or Izzat (founder ruling); here they only order the feed.
 */

export interface FeedWeights {
  follows: number;
  city: number;
  tag: number;
  recency: number;
  helpful: number;
}

export interface FeedCandidate {
  followed: boolean;
  sameCity: boolean;
  tagMatch: boolean;
  ageHours: number;
  likes: number;
  saves: number;
  views: number;
}

export const FEED_RECENCY_HALF_LIFE_HOURS = 72;
/** The ranked snapshot holds at most this many post ids (§ 9.5). */
export const FEED_SNAPSHOT_MAX = 300;

/** Wilson score interval lower bound (95 %); 0 when there is no data. */
export function wilsonLowerBound(positive: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = Math.min(Math.max(positive / n, 0), 1);
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export function feedScore(c: FeedCandidate, w: FeedWeights): number {
  const positives = Math.max(0, c.likes) + Math.max(0, c.saves);
  const n = Math.max(c.views, positives);
  const recency = Math.pow(0.5, Math.max(0, c.ageHours) / FEED_RECENCY_HALF_LIFE_HOURS);
  return (
    w.follows * (c.followed ? 1 : 0) +
    w.city * (c.sameCity ? 1 : 0) +
    w.tag * (c.tagMatch ? 1 : 0) +
    w.recency * recency +
    w.helpful * wilsonLowerBound(positives, n)
  );
}

export type RankInput = Omit<FeedCandidate, 'ageHours'> & { id: string; createdAt: Date };

/** Ids by score desc, then newest, then id desc (deterministic); at most `limit`. */
export function rankFeed(
  candidates: readonly RankInput[],
  w: FeedWeights,
  nowMs: number,
  limit = FEED_SNAPSHOT_MAX,
): string[] {
  return candidates
    .map((c) => ({
      id: c.id,
      at: c.createdAt.getTime(),
      score: feedScore({ ...c, ageHours: (nowMs - c.createdAt.getTime()) / 3_600_000 }, w),
    }))
    .sort((a, b) => b.score - a.score || b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, limit)
    .map((c) => c.id);
}
