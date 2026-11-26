import type { ApiResult } from '../orders-api';

/**
 * The light, dependency-free helpers of the Ustaad feed cards (poll shares, WhatsApp link, story stepping,
 * media labels, snapshot expiry). Post cards import only this file, so Home does not load the shared rules
 * (Zod) that the composer's `buildPostInput` and the first-message check need (spec 23 § 17, 2026-11-26).
 */

/** Whole percentages that add up to 100 (largest remainder), so a poll's bars never sum to 99 or 101. */
export function pollShares(votes: readonly number[]): { percents: number[]; total: number } {
  const total = votes.reduce((a, b) => a + b, 0);
  if (total === 0) return { percents: votes.map(() => 0), total };
  const raw = votes.map((v) => (v * 100) / total);
  const percents = raw.map(Math.floor);
  let left = 100 - percents.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest);
  for (const o of order) {
    if (left <= 0) break;
    percents[o.i] = (percents[o.i] ?? 0) + 1;
    left -= 1;
  }
  return { percents, total };
}

/** `https://wa.me/?text=…` with the message and the absolute teaser link (Hindi pages keep `/hi`). */
export function whatsappShareUrl(origin: string, path: string, text: string, locale = 'en'): string {
  const link = `${origin}${locale === 'hi' ? '/hi' : ''}${path}`;
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`;
}

export interface StoryPos {
  ring: number;
  story: number;
}

/** The next (+1) or previous (−1) story across rings; null after the very last one. */
export function nextStory(
  rings: readonly { stories: number }[],
  pos: StoryPos,
  dir: 1 | -1,
): StoryPos | null {
  const count = (r: number) => rings[r]?.stories ?? 0;
  if (dir === 1) {
    if (pos.story + 1 < count(pos.ring)) return { ring: pos.ring, story: pos.story + 1 };
    for (let r = pos.ring + 1; r < rings.length; r += 1) if (count(r) > 0) return { ring: r, story: 0 };
    return null;
  }
  if (pos.story > 0) return { ring: pos.ring, story: pos.story - 1 };
  for (let r = pos.ring - 1; r >= 0; r -= 1) if (count(r) > 0) return { ring: r, story: count(r) - 1 };
  return pos;
}

export function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** The For you snapshot ran out (10 min): start the list again from the top (spec 23 § 21d). */
export function feedExpired(r: ApiResult<unknown>): boolean {
  return !r.ok && r.status === 410 && r.code === 'USTAAD_FEED_EXPIRED';
}
