/**
 * Local rules for the Ustaad Network (spec 23 § 4 flows 10–11, § 9.6; SR-29–32, SR-36; plan workstream E). Pure
 * functions, no I/O and no dependency, so the API, the worker and the tests share one implementation:
 *
 * - `noisyDistanceBand`: distance → band code after a stable per-pair perturbation (the caller derives `noiseUnit`
 *   from an HMAC of the two member ids, so the same pair always gets the same band, SR-29).
 * - `pinChangeDecision`: the pin-move limits (3 per 24 h, 6 per 30 days, a big move needs a precise GPS fix, SR-30).
 * - `bandZone`: what a member sees for one zone, including per-speciality cells and complementary suppression (SR-31).
 * - `jobScamSignals`: fee phrases and UPI ids in a job text (SR-36; F's word list adds to these defaults).
 */
import { bandCount, distanceBand, type BandedCount, type DistanceBand } from './zones';

/** The largest relative perturbation applied to a distance before banding (± 25 %). */
export const DISTANCE_NOISE_RATIO = 0.25;

/**
 * Band for a true distance after stable noise. `noiseUnit` is a number in [0, 1) derived from the pair (never random
 * per call). The result is only a band code; no number ever leaves the server.
 */
export function noisyDistanceBand(metres: number, noiseUnit: number): DistanceBand {
  const u = Number.isFinite(noiseUnit) ? Math.min(Math.max(noiseUnit, 0), 0.999_999) : 0.5;
  const factor = 1 + (u * 2 - 1) * DISTANCE_NOISE_RATIO;
  return distanceBand(Math.max(0, metres) * factor);
}

/** Band order for "near you" lists (band first, then the caller's score; never exact distance within a band). */
export function distanceBandRank(band: DistanceBand): number {
  return { lt2: 0, '2to5': 1, '5to10': 2, '10plus': 3 }[band];
}

export interface PinChangeRules {
  perDay: number;
  per30d: number;
  gpsMaxM: number;
  bigMoveM: number;
  bigMoveAccuracyM: number;
}

export interface PinChangeInput {
  source: 'gps' | 'manual';
  accuracyM: number;
  /** Metres from the current pin; null for the first pin. */
  moveM: number | null;
  /** When earlier moves happened (pin-change log). */
  recentChanges: readonly Date[];
  now: Date;
}

export type PinChangeDecision =
  | { ok: true; counts: boolean }
  | { ok: false; code: 'USTAAD_PIN_LIMIT' | 'USTAAD_PIN_FIX_REQUIRED' | 'USTAAD_PIN_GPS_WEAK' };

const DAY_MS = 86_400_000;

/**
 * May the member put the pin here? The first pin is free (it is not a change). A GPS reading worse than `gpsMaxM` is
 * not a pin: the member places it by hand with a landmark. A move over `bigMoveM` needs a GPS fix of
 * `bigMoveAccuracyM` or better. A zero-metre save (choices only) never counts against the limits.
 */
export function pinChangeDecision(input: PinChangeInput, rules: PinChangeRules): PinChangeDecision {
  if (input.source === 'gps' && input.accuracyM > rules.gpsMaxM)
    return { ok: false, code: 'USTAAD_PIN_GPS_WEAK' };
  if (input.moveM === null) return { ok: true, counts: false };
  if (input.moveM < 1) return { ok: true, counts: false };
  if (input.moveM > rules.bigMoveM && (input.source !== 'gps' || input.accuracyM > rules.bigMoveAccuracyM))
    return { ok: false, code: 'USTAAD_PIN_FIX_REQUIRED' };
  const now = input.now.getTime();
  const lastDay = input.recentChanges.filter((d) => now - d.getTime() < DAY_MS).length;
  const last30 = input.recentChanges.filter((d) => now - d.getTime() < 30 * DAY_MS).length;
  if (lastDay >= rules.perDay || last30 >= rules.per30d) return { ok: false, code: 'USTAAD_PIN_LIMIT' };
  return { ok: true, counts: true };
}

/** Accuracy band for analytics (never the reading itself). */
export function accuracyBand(m: number): 'lt20' | '20to50' | '50to100' | 'gt100' {
  if (m < 20) return 'lt20';
  if (m < 50) return '20to50';
  if (m <= 100) return '50to100';
  return 'gt100';
}

export interface ZoneRules {
  hideBelow: number;
  exactFrom: number;
  round: boolean;
}

export interface BandedZone {
  total: BandedCount;
  /** Per-speciality cells; a suppressed cell reads `few` exactly like an empty one. */
  segments: Record<string, BandedCount>;
}

/**
 * What a member sees for a zone (SR-31). Every cell under the floor reads "few". Complementary suppression: while the
 * suppressed cells together hold a small non-zero count, the smallest still-visible cell is suppressed too, so a
 * total minus the visible cells can never pin down a small group. With any cell suppressed the total is shown as a
 * band or a multiple of five, never an exact small difference.
 */
export function bandZone(
  zone: { members: number; bySegment: Record<string, number> },
  rules: ZoneRules,
): BandedZone {
  const floor = Math.max(5, rules.hideBelow);
  const entries = Object.entries(zone.bySegment).filter(([, n]) => Number.isInteger(n) && n >= 0);
  const suppressed = new Set(entries.filter(([, n]) => n < floor).map(([k]) => k));
  const hiddenSum = () => entries.filter(([k]) => suppressed.has(k)).reduce((s, [, n]) => s + n, 0);
  while (hiddenSum() > 0 && hiddenSum() < floor) {
    const visible = entries.filter(([k]) => !suppressed.has(k)).sort((a, b) => a[1] - b[1]);
    const next = visible[0];
    if (!next) break;
    suppressed.add(next[0]);
  }
  const segments: Record<string, BandedCount> = {};
  for (const [k, n] of entries)
    segments[k] = suppressed.has(k) ? { kind: 'few' } : bandCount(n, { ...rules, round: true });
  const anyHidden = hiddenSum() > 0;
  return {
    total: bandCount(zone.members, { ...rules, round: rules.round || anyHidden }),
    segments,
  };
}

/** Devanagari (and other common Indic) digits → ASCII, for the filters only; the stored text is never changed. */
export function normaliseDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

const FEE_PATTERNS: readonly RegExp[] = [
  /\b(registration|joining|security|training|processing|form|interview|application)\s*(fee|fees|charge|charges|deposit|amount)\b/i,
  /\b(deposit|advance)\s*(of|rs\.?|₹|\d)/i,
  /\bpay\s*(rs\.?|₹|inr)?\s*\d+\s*(to|for)\s*(apply|join|register|confirm)/i,
  /(पंजीकरण|रजिस्ट्रेशन|जॉइनिंग|सिक्योरिटी|ट्रेनिंग|फॉर्म)\s*(शुल्क|फीस|फ़ीस|चार्ज|राशि)/,
  /(शुल्क|फीस|फ़ीस)\s*(जमा|भरें|भरना|दें|देना)/,
  /(पैसे|रुपये|रुपए)\s*(जमा|भेजो|भेजें|भेजना)/,
];
const UPI_ID = /\b[a-z0-9._-]{2,}@(?!gmail|yahoo|outlook|hotmail|rediffmail)[a-z]{2,}\b(?!\.)/i;
const PAY_APP = /\b(paytm|phonepe|gpay|google\s*pay|bhim)\s*(kar|karo|kare|number|no\.?|pe|par|to)\b/i;

export type JobScamSignal = 'fee_phrase' | 'upi_id' | 'pay_app';

/**
 * Signals that a job text asks candidates for money (spec 23 flow 11, AT-JOB-1). Any signal holds the job for staff
 * review; the poster only hears "Our team will check it first" (no filter oracle).
 */
export function jobScamSignals(text: string, extraPhrases: readonly string[] = []): JobScamSignal[] {
  const t = normaliseDigits(text);
  const out = new Set<JobScamSignal>();
  if (FEE_PATTERNS.some((p) => p.test(t))) out.add('fee_phrase');
  const lower = t.toLowerCase();
  if (extraPhrases.some((p) => p.trim().length > 2 && lower.includes(p.trim().toLowerCase())))
    out.add('fee_phrase');
  if (UPI_ID.test(t)) out.add('upi_id');
  if (PAY_APP.test(t)) out.add('pay_app');
  return [...out];
}

/** A stored setting read as an integer, with the caller's default for a wrong type (the registry validates saves). */
export function settingInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** A stored setting read as a boolean, with the caller's default for a wrong type. */
export function settingBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
