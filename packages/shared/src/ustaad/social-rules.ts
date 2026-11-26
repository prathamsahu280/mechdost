/**
 * Ustaad social rules without Zod (workstream D2; spec 23 § 4 flows 7–8, § 9.4, SR-33, SR-37, SR-41). Used by the db
 * repositories at runtime, so this module builds no Zod schema at load (L313). Pure functions only.
 */
import { maskPersonalData } from '../privacy';
import { jobScamSignals, normaliseDigits } from './local';
import { isSafeInternalPath } from './paths';

/** Symmetric pairs are stored ordered (`low_id < high_id`, CHECK in the schema). */
export function orderedPair(a: string, b: string): { lowId: string; highId: string } {
  return a < b ? { lowId: a, highId: b } : { lowId: b, highId: a };
}

// A link: a scheme, `www.`, a known short/redirect host, or `name.tld/…` with a common top-level domain. Checked on
// NFKC text (full-width letters fold), so "ｈｔｔｐｓ://" counts too.
const LINK =
  /([a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b(?:bit\.ly|wa\.me|t\.me|tinyurl\.com|goo\.gl|rb\.gy|is\.gd)\b|\b[a-z0-9-]{2,}\.(?:com|in|net|org|co|io|me|ly|xyz|app|link|site|info|biz|online|shop|store|top|club)\b)/i;
// UPI handles after emails are already masked: `name@psp` (no `.tld` after it).
const UPI_HANDLE = /[a-z0-9._-]{2,}@[a-z]{2,}(?![a-z0-9]|[.][a-z])/gi;

export interface DmTextCheck {
  /** The text to store (masked while the thread is still a request). */
  text: string;
  /** A link was found (refused in a request, SR-33). */
  link: boolean;
  /** Hold for staff: fee phrase, UPI id or pay-app ask (any thread state; the sender sees no reason). */
  hold: boolean;
}

/**
 * Message text rules (SR-33, AT-DM-1): while a thread is `requested` the text may not carry a link and any phone
 * number, email or UPI id is masked to "#" (the receiver has not agreed to talk yet). After acceptance members may
 * share their own details; scam signals still hold the message for staff.
 */
export function dmTextCheck(
  text: string,
  opts: { requested: boolean; scamPhrases?: readonly string[] },
): DmTextCheck {
  const phrases = opts.scamPhrases ?? [];
  if (!opts.requested) return { text, link: false, hold: jobScamSignals(text, phrases).length > 0 };
  const link = LINK.test(normaliseDigits(text));
  // A request is masked first; what is left (a fee phrase, a pay-app ask) still holds it.
  const masked = maskPersonalData(text).replace(UPI_HANDLE, '#');
  return { text: masked, link, hold: jobScamSignals(masked, phrases).length > 0 };
}

/** Wilson score lower bound (95 %) of `pos` successes in `n` trials; 0 when there is no evidence. */
export function wilsonLower(pos: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = Math.min(1, Math.max(0, pos / n));
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

export interface DiscoverWeights {
  helpful: number;
  best: number;
  breadth: number;
  trust: number;
  newcomer: number;
}

export interface DiscoverStats {
  answers: number;
  helpfulAnswers: number;
  bestAnswers: number;
  /** Best answers in the last 30 days (refreshed nightly by B's counters): the recent half of the decayed rate. */
  bestAnswers30d: number;
  distinctAskers: number;
  verified: boolean;
  level: string;
  daysSinceJoin: number;
  /** Shown on cards, never scored (spec 23 § 9.4: followers weigh 0 in Discover). */
  followers: number;
}

const LEVEL_TRUST: Record<string, number> = {
  apprentice: 0,
  ustaad_pending: 0.1,
  naya: 0.4,
  pakka: 0.6,
  bada: 0.8,
  master: 1,
};

/**
 * Discover score (spec 23 § 9.4), 0–100 when the weights sum to 100: Wilson of helpful answers over answers, a best
 * rate weighting the last 30 days double (the 90-day half-life approximated from the counters we keep), distinct
 * askers helped (log-scaled, 50 askers ≈ full), trust (verification + level), and a new-member boost fading over
 * 30 days. Followers and likes weigh 0.
 */
export function discoverScore(s: DiscoverStats, w: DiscoverWeights): number {
  const helpful = wilsonLower(s.helpfulAnswers, s.answers);
  const bestRate =
    s.answers > 0 ? Math.min(1, (s.bestAnswers + s.bestAnswers30d) / (s.answers + s.bestAnswers30d)) : 0;
  const breadth = Math.min(1, Math.log1p(Math.max(0, s.distinctAskers)) / Math.log1p(50));
  const trust = (s.verified ? 0.5 : 0) + 0.5 * (LEVEL_TRUST[s.level] ?? 0);
  const newcomer = s.daysSinceJoin < 30 ? 1 - Math.max(0, s.daysSinceJoin) / 30 : 0;
  return (
    w.helpful * helpful + w.best * bestRate + w.breadth * breadth + w.trust * trust + w.newcomer * newcomer
  );
}

/** SR-37: 20 per page, cursor only, no total. */
export const DISCOVER_PAGE_SIZE = 20;

/**
 * One page of a ranked list with `newSlots` places per page kept for members under 30 days (spec 23 § 9.4). The
 * list is ordered once (score desc, id asc); pages are cut from that order so paging never repeats or skips. The
 * cursor is the offset into the interleaved order.
 */
export function rankDiscover(
  rows: readonly { id: string; score: number; isNew: boolean }[],
  opts: { newSlots: number; offset: number; pageSize?: number },
): { ids: string[]; nextOffset: number | null } {
  const size = opts.pageSize ?? DISCOVER_PAGE_SIZE;
  const sorted = [...rows].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const fresh = sorted.filter((r) => r.isNew);
  const rest = sorted.filter((r) => !r.isNew);
  const order: string[] = [];
  const slots = Math.max(0, Math.min(opts.newSlots, size));
  while (fresh.length > 0 || rest.length > 0) {
    const page: string[] = [];
    // Guaranteed new-member places first, then the best of everyone else (new members included by score).
    for (let i = 0; i < slots && fresh.length > 0; i += 1) page.push((fresh.shift() as { id: string }).id);
    while (page.length < size && (rest.length > 0 || fresh.length > 0)) {
      const a = rest[0];
      const b = fresh[0];
      const takeFresh = b !== undefined && (a === undefined || b.score > a.score);
      page.push(((takeFresh ? fresh : rest).shift() as { id: string }).id);
    }
    order.push(...page);
  }
  const ids = order.slice(opts.offset, opts.offset + size);
  const next = opts.offset + size;
  return { ids, nextOffset: next < order.length ? next : null };
}

/** The locked promotion label (SR-41, ASCI): first line of every promotion card; never a setting or a column. */
export const SPONSORED_LABEL = { en: 'Sponsored', hi: 'प्रायोजित' } as const;

const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Where a promotion leads: always a MechDost internal path, built on the server from the target (open-redirect
 * safe: no absolute URL, no `//host`, no backslash or control character). Null when the target cannot be resolved;
 * such a promotion is not served.
 */
export function promotionHref(target: string, targetId: string): string | null {
  let href: string | null = null;
  if (target === 'product' && SLUG.test(targetId)) href = `/shop/${targetId}`;
  else if (target === 'category' && SLUG.test(targetId)) href = `/shop?category=${targetId}`;
  else if (target === 'coupon') href = '/offers';
  else if (target === 'learning')
    href = UUID.test(targetId) ? `/ustaad/learn?resource=${targetId}` : '/ustaad/learn';
  else if (target === 'url_internal') href = targetId;
  return href !== null && isSafeInternalPath(href) ? href : null;
}
