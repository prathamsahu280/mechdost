/**
 * Ustaad moderation rules as pure functions (spec 23 § 7.6, § 13; SR-18, SR-36, SR-39; plan task F2). No Zod, no I/O.
 *
 * - `normaliseForScreen`: one normaliser for both sides of every match (NFKC, format characters stripped, every
 *   script's digits → ASCII, lower case, spaces collapsed). Stored `phrase_norm` stays as G1 wrote it (NFC + lower
 *   case, the unique index depends on it); the screen re-normalises the phrase at match time (review focus 5).
 * - `screenTextSignals` + `screenDecision`: the automatic first pass. Holds never tell the author why (no filter
 *   oracle); blocks are only for things the author can fix (a phone number or number plate in public text, a link
 *   from a new account or to a denied domain).
 * - Clocks: which clock a report gets and its due time from the admin settings; the overdue stage (50 % / 100 %).
 * - Four-eyes: which actions need a second staff member.
 */
import { hasPayAppAsk, hasUpiId, normaliseDigits } from './local';
import type { REPORT_CLOCKS, UstaadReportReason, UstaadReportSource } from './codes';

export type UstaadClock = (typeof REPORT_CLOCKS)[number];

/** NFKC, no format characters, ASCII digits, lower case, single spaces. */
export function normaliseForScreen(text: string): string {
  return normaliseDigits(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Illegal-modification phrases (spec 23 § 13 report reason; Motor Vehicles Act s.52, emission and odometer rules).
 * Matched after normalisation; the admin list (`banned` words) adds to these. A hit holds the item for review.
 */
export const ILLEGAL_MODIFICATION_PHRASES: readonly string[] = [
  'silencer cut',
  'silencer kaat',
  'silencer modify',
  'pressure horn lagao',
  'odometer rollback',
  'odometer back',
  'meter back kar',
  'km kam kar',
  'km ghata',
  'reading kam kar',
  'dpf delete',
  'dpf remove',
  'cat delete',
  'catalytic converter remove',
  'catalytic hata',
  'egr delete',
  'egr block',
  'adblue delete',
  'adblue bypass',
  'emission bypass',
  'puc jugaad',
  'number plate badal',
  'plate change kar',
  'fake plate',
  'chassis number badal',
  'engine number badal',
  'मीटर पीछे',
  'साइलेंसर काट',
];

/** "Share the OTP" asks in English, Hinglish and Hindi (scam controls, SR-36). */
const OTP_ASK =
  /\b(otp|o\.t\.p|one time password|verification code)\b.{0,30}\b(share|bhej|bata|batao|send|de do|dedo|do|dijiye|batana|forward)\b|\b(share|bhej|bata|batao|send|de do|dedo|forward)\b.{0,30}\b(otp|o\.t\.p)\b|ओटीपी/i;

/**
 * An Indian mobile number written the way people write phone numbers: optional +91 / 0, then 10 digits starting 6–9,
 * contiguous or split by spaces (`98765 43210`). Blocked in public text.
 */
const PHONE = /(?<![0-9-])(?:(?:\+|00)?91[\s]?|0)?[6-9](?:\s?[0-9]){9}(?![0-9]|-[0-9])/;
/**
 * Anything else shaped like a mobile number: an optional +91 / 0 prefix, then 10 digits starting 6–9 with any mix of
 * spaces and dashes (`+91-98765-43210`, `9-8-7-6-5-4-3-2-1-0`). Part numbers share the shape (`94109-12000`), so this
 * only holds the item (security review 2026-11-26); staff masking uses it too, so no number reaches a staff screen.
 */
const PHONE_LIKE = /(?<![0-9])(?:(?:\+|00)?91[\s-]?|0[\s-]?)?[6-9](?:[\s-]?[0-9]){9}(?![0-9])/;

/**
 * Staff views never show a phone number (SR-38): every phone-like run and e-mail address becomes `[phone]` /
 * `[email]`. Digits of any script are mapped first, so Devanagari digits are masked too.
 */
export function maskContactsInText(text: string): string {
  return normaliseDigits(text)
    .replace(new RegExp(PHONE_LIKE.source, 'g'), '[phone]')
    .replace(new RegExp(PHONE.source, 'g'), '[phone]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]');
}

/** Registration state codes (MoRTH), so ordinary words ("rs 50 se 2000") never look like a plate. */
const STATE_CODES =
  'an|ap|ar|as|br|cg|ch|dd|dl|dn|ga|gj|hp|hr|jh|jk|ka|kl|la|ld|mh|ml|mn|mp|mz|nl|od|or|pb|py|rj|sk|tn|tr|ts|uk|up|wb';
/**
 * A registration plate written as one token (`CG04AB1234`, `cg04ab1234`) or spaced in capitals (`CG 04 AB 1234`), or
 * a Bharat-series plate (`22 BH 1234 AA`). Spaced lower-case text ("ka 97 cc 2018 model") is ordinary Hinglish.
 */
const PLATE_COMPACT = new RegExp(
  `(?<![a-z0-9])(?:${STATE_CODES})[0-9]{1,2}[a-z]{1,3}[0-9]{4}(?![a-z0-9])`,
  'i',
);
const PLATE_SPACED_UPPER = new RegExp(
  `(?<![A-Za-z0-9])(?:${STATE_CODES.toUpperCase()})[\\s-][0-9]{1,2}[\\s-][A-Z]{1,3}[\\s-][0-9]{4}(?![A-Za-z0-9])`,
);
const PLATE_BH = /(?<![a-z0-9])[0-9]{2}[\s-]?bh[\s-]?[0-9]{4}[\s-]?[a-z]{1,2}(?![a-z0-9])/i;
/**
 * Any case with at least one separator after a valid state code (`cg 04 ab 1234`, `cg-04-ab-1234`): ordinary
 * Hinglish can look like this ("ka 97 cc 2018"), so it only holds (`plate_like`, security review 2026-11-26).
 */
const PLATE_SEPARATED = new RegExp(
  `(?<![a-z0-9])(?:${STATE_CODES})[\\s-]+[0-9]{1,2}[\\s-]*[a-z]{1,3}[\\s-]*[0-9]{4}(?![a-z0-9])`,
  'i',
);

/**
 * A link: a scheme, `www.`, or a bare domain with a top-level domain people rarely type by accident (`hai.me`,
 * `kal.co` are ordinary Hinglish typos, so `.me`, `.co`, `.top`, `.live`, `.club`, `.biz` count only with a scheme).
 */
const LINK =
  /\bhttps?:\/\/|\bwww\.|(?<![@a-z0-9-])[a-z0-9][a-z0-9-]{2,62}\.(?:com|in|net|org|xyz|io|app|link|ly|info|site|online|shop|store)(?![a-z0-9-])/;

/**
 * Short redirector and messaging domains always count as links, also written with spaces or "dot"
 * (`t . me`, `wa dot me`, `bit (dot) ly`; security review 2026-11-26).
 */
const REDIRECTOR =
  /(?<![a-z0-9])(?:t\.me|wa\.me|bit\.ly|tinyurl(?:\.com)?|goo\.gl|rb\.gy|cutt\.ly)(?![a-z0-9])/;

/** Undo "dot" spellings and spaces around dots, so `wa dot me` and `t . me` read as `wa.me` and `t.me`. */
function collapseDots(t: string): string {
  return t.replace(/\s*(?:\.|\(dot\)|\[dot\]|\bdot\b)\s*/g, '.');
}

export type ScreenSignal =
  | 'banned_word'
  | 'scam_phrase'
  | 'upi_id'
  | 'pay_app'
  | 'otp_ask'
  | 'phone_number'
  | 'phone_like'
  | 'number_plate'
  | 'plate_like'
  | 'link'
  | 'link_denied'
  | 'illegal_modification';

export interface ScreenLists {
  banned: readonly string[];
  scamPhrases: readonly string[];
  /** Denied link domains (admin `link_domain` list). */
  linkDomains: readonly string[];
}

/** A phrase hit on normalised text; Latin phrases must start and end on a word edge ("deposit" ≠ "redeposited"). */
export function phraseHit(textNorm: string, phrase: string): boolean {
  const p = normaliseForScreen(phrase);
  if (p.length < 2) return false;
  if (!/^[a-z0-9 ]+$/.test(p)) return textNorm.includes(p);
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(textNorm);
}

/** Every signal in a text. Pure; the repository adds the account facts (age, media count). */
export function screenTextSignals(text: string, lists: ScreenLists): ScreenSignal[] {
  const t = normaliseForScreen(text);
  if (!t) return [];
  const out = new Set<ScreenSignal>();
  if (lists.banned.some((p) => phraseHit(t, p))) out.add('banned_word');
  if (lists.scamPhrases.some((p) => phraseHit(t, p))) out.add('scam_phrase');
  if (ILLEGAL_MODIFICATION_PHRASES.some((p) => phraseHit(t, p))) out.add('illegal_modification');
  if (hasUpiId(t)) out.add('upi_id');
  if (hasPayAppAsk(t)) out.add('pay_app');
  if (OTP_ASK.test(t)) out.add('otp_ask');
  if (PHONE.test(t)) out.add('phone_number');
  else if (PHONE_LIKE.test(t)) out.add('phone_like');
  // Plates are checked on the un-lowered text too (spaced capitals); normalised digits either way.
  const cased = normaliseDigits(text);
  if (PLATE_COMPACT.test(t) || PLATE_BH.test(t) || PLATE_SPACED_UPPER.test(cased)) out.add('number_plate');
  else if (PLATE_SEPARATED.test(t)) out.add('plate_like');
  const dotted = collapseDots(t);
  if (LINK.test(t) || REDIRECTOR.test(dotted)) out.add('link');
  // The denylist runs on the whole text, dotted spellings included, whether or not a link shape matched.
  const denied = lists.linkDomains.map((d) => normaliseForScreen(d)).filter((d) => d.length > 3);
  if (denied.some((d) => t.includes(d) || dotted.includes(d))) {
    out.add('link');
    out.add('link_denied');
  }
  return [...out];
}

export type ScreenKind = 'post' | 'story' | 'comment' | 'question' | 'answer' | 'message' | 'job';
export type ScreenOutcome = 'ok' | 'hold' | 'block';

/** Account facts the repository reads (never the member's text or phone). */
export interface ScreenAccount {
  accountAgeDays: number;
  /** Visible media posts the author already has. */
  priorMediaPosts: number;
  hasMedia: boolean;
  premodFirstPosts: number;
  premodAccountDays: number;
  linksMinAccountDays: number;
}

/** Kinds other members see in public (a phone number or plate here is blocked, spec 23 § 13). */
const PUBLIC_KINDS: readonly ScreenKind[] = ['post', 'story', 'question', 'answer', 'comment', 'job'];
/** Pre-moderation covers media posts (spec 23 § 10 step 4), not voice notes on questions or answers. */
const PREMOD_KINDS: readonly ScreenKind[] = ['post', 'story', 'comment'];

export interface ScreenVerdict {
  outcome: ScreenOutcome;
  /** Why (for the auto report and the staff queue; never shown to the author). */
  signals: (ScreenSignal | 'new_account_media' | 'new_account_link')[];
}

export function screenDecision(
  kind: ScreenKind,
  signals: readonly ScreenSignal[],
  account: ScreenAccount,
): ScreenVerdict {
  const all: ScreenVerdict['signals'] = [...signals];
  const has = (s: ScreenSignal) => signals.includes(s);
  const block =
    has('link_denied') ||
    (has('link') && account.accountAgeDays < account.linksMinAccountDays) ||
    (kind !== 'message' && kind !== 'job' && kind !== 'comment' && has('phone_number')) ||
    (PUBLIC_KINDS.includes(kind) && has('number_plate'));
  if (has('link') && account.accountAgeDays < account.linksMinAccountDays) all.push('new_account_link');
  if (block) return { outcome: 'block', signals: all };
  const premod =
    account.hasMedia &&
    PREMOD_KINDS.includes(kind) &&
    (account.accountAgeDays < account.premodAccountDays ||
      account.priorMediaPosts < account.premodFirstPosts);
  if (premod) all.push('new_account_media');
  const hold =
    premod ||
    has('banned_word') ||
    has('scam_phrase') ||
    has('illegal_modification') ||
    has('upi_id') ||
    has('pay_app') ||
    has('otp_ask') ||
    has('phone_number') ||
    has('phone_like') ||
    (kind !== 'message' && has('plate_like'));
  return { outcome: hold ? 'hold' : 'ok', signals: all };
}

/** The report source of an automatic hold: scam signals → `auto_scam`, the rest → `auto_word`. */
export function autoReportSource(signals: readonly string[]): 'auto_scam' | 'auto_word' {
  return signals.some((s) =>
    ['scam_phrase', 'upi_id', 'pay_app', 'otp_ask', 'phone_number', 'phone_like'].includes(s),
  )
    ? 'auto_scam'
    : 'auto_word';
}

/** The report reason of an automatic hold. */
export function autoReportReason(signals: readonly string[]): UstaadReportReason {
  if (signals.includes('plate_like')) return 'privacy';
  if (signals.includes('illegal_modification')) return 'illegal_modification';
  if (autoReportSource(signals) === 'auto_scam') return 'spam';
  if (signals.includes('new_account_media')) return 'other';
  return 'abuse';
}

// ── Clocks ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ClockSettings {
  'ustaad.mod.clock_intimate_h': number;
  'ustaad.mod.clock_legal_h': number;
  'ustaad.mod.clock_removal_h': number;
  'ustaad.mod.clock_standard_h': number;
  'ustaad.mod.clock_grievance_days': number;
}

const HOUR = 3_600_000;

/** Length of a clock in milliseconds from the admin settings (counsel can change every one). */
export function clockMs(clock: UstaadClock, s: ClockSettings): number {
  switch (clock) {
    case 'intimate_2h':
      return s['ustaad.mod.clock_intimate_h'] * HOUR;
    case 'legal_3h':
      return s['ustaad.mod.clock_legal_h'] * HOUR;
    case 'removal_36h':
      return s['ustaad.mod.clock_removal_h'] * HOUR;
    case 'standard_24h':
      return s['ustaad.mod.clock_standard_h'] * HOUR;
    case 'grievance_7d':
      return s['ustaad.mod.clock_grievance_days'] * 24 * HOUR;
  }
}

/**
 * Which clock a report runs on: a legal order 3 h; an intimate-image or impersonation complaint 2 h; a grievance
 * the clock staff picked (36 h for removal, 7 days otherwise); anything else the reason's default (admin table).
 */
export function clockFor(input: {
  source: UstaadReportSource;
  reason: UstaadReportReason;
  reasonDefault: UstaadClock;
  grievanceClock?: 'removal_36h' | 'grievance_7d';
}): UstaadClock {
  if (input.source === 'legal_order') return 'legal_3h';
  if (input.reason === 'ncii_impersonation' || input.source === 'auto_safety') return 'intimate_2h';
  if (input.source === 'grievance') return input.grievanceClock ?? 'grievance_7d';
  return input.reasonDefault;
}

/** 0 = within the first half, 50 = half the clock used, 100 = overdue. */
export function overdueStage(createdAt: Date, dueAt: Date, now: Date): 0 | 50 | 100 {
  const total = dueAt.getTime() - createdAt.getTime();
  const used = now.getTime() - createdAt.getTime();
  if (used >= total) return 100;
  if (used * 2 >= total) return 50;
  return 0;
}

// ── Four-eyes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A ban of `fromDays` or longer (or permanent) needs a second staff member (spec 23 § 3, 403 `FOUR_EYES`). */
export function banNeedsFourEyes(days: number | null, fromDays: number): boolean {
  return days === null || days >= fromDays;
}

/** A minor report restricts at once only from a verified member with an account this old (spec 23 § 13, locked). */
export const MINOR_REPORTER_MIN_ACCOUNT_DAYS = 30;
