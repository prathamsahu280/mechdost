/**
 * Ustaad Network settings (spec 23 § 15; hard rule 8). Stored in the same `settings` table as the operational settings
 * (global rows, key prefix `ustaad.`), but kept in this separate registry so the ~100 network keys do not flood the
 * existing Admin → Settings screen; Admin → Ustaad (workstream G1) edits them through `/v1/admin/ustaad/settings`
 * (decision 2026-11-26 "Ustaad settings registry"). Every key is site-wide: reach is per city through
 * `ustaad_reach_cities`, not through city overrides.
 *
 * Order of checks on a save: type → invariants (locked floors, SETTING_INVARIANT; relations, SETTING_RELATION) →
 * range (SETTING_RANGE). Invariants run first so a locked floor always answers with its own code.
 */
import { USTAAD_ACCESS_MODES, USTAAD_CORRECTION_MODES, USTAAD_DM_MODES, USTAAD_LANGS } from './codes';

export type UstaadSettingSpec =
  | { kind: 'int'; min: number; max: number; default: number; locked?: true }
  | { kind: 'boolean'; default: boolean; locked?: true }
  | { kind: 'enum'; values: readonly string[]; default: string };

const int = (min: number, max: number, def: number) => ({ kind: 'int', min, max, default: def }) as const;
const bool = (def: boolean) => ({ kind: 'boolean', default: def }) as const;
const locked = (def: boolean) => ({ kind: 'boolean', default: def, locked: true }) as const;

/** Workstream owners in comments: A ships every key with its default; B–G read them. */
export const USTAAD_SETTINGS = {
  // ── Access and general (A) ─────────────────────────────────────────────────────────────────────────────────
  /**
   * Who reaches `/ustaad` and `/v1/ustaad/*` (founder 2026-11-26): `off` = nobody (a 404 for everyone),
   * `staff_preview` = MechDost staff only (default until launch), `open` = every signed-in mechanic.
   */
  'ustaad.access': { kind: 'enum', values: USTAAD_ACCESS_MODES, default: 'staff_preview' },
  /** Off hides the network for every member (content kept). Staff preview still works while access allows it. */
  'ustaad.general.enabled': bool(true),
  'ustaad.general.mechanics_only': locked(true),
  'ustaad.general.all_state': bool(false),
  'ustaad.general.join_mode': {
    kind: 'enum',
    values: ['all', 'verified_only', 'invite_only'],
    default: 'all',
  },
  'ustaad.general.default_lang': { kind: 'enum', values: USTAAD_LANGS, default: 'hi' },
  // ── Levels and Izzat (B) ──────────────────────────────────────────────────────────────────────────────────
  'ustaad.levels.follower_min_age_days': int(7, 180, 30),
  'ustaad.levels.follower_exclude_same_garage': bool(true),
  'ustaad.levels.inactive_pause_days': int(30, 365, 90),
  'ustaad.izzat.answer_posted': int(0, 100, 2),
  'ustaad.izzat.best_answer': int(0, 100, 10),
  'ustaad.izzat.helpful_received': int(0, 100, 1),
  'ustaad.izzat.follower_gained': int(0, 100, 1),
  'ustaad.izzat.video_completed': int(0, 100, 0),
  // ── Verification (B) ──────────────────────────────────────────────────────────────────────────────────────
  'ustaad.verify.owner_enabled': bool(true),
  'ustaad.verify.vouch_enabled': bool(true),
  'ustaad.verify.certificate_enabled': bool(false),
  'ustaad.verify.vouches_needed': int(1, 5, 2),
  'ustaad.verify.vouch_min_level': {
    kind: 'enum',
    values: ['naya', 'pakka', 'bada', 'master'],
    default: 'pakka',
  },
  'ustaad.verify.evidence_retention_days': int(7, 180, 30),
  'ustaad.verify.attest_per_owner_quarter': int(1, 50, 10),
  'ustaad.verify.attest_photo_max_m': int(50, 1000, 200),
  'ustaad.verify.vouch_min_account_days': int(30, 365, 60),
  'ustaad.verify.vouch_per_month': int(1, 10, 3),
  'ustaad.verify.fast_track_approved_apps': bool(true),
  'ustaad.security.high_level_freeze_hours': int(24, 168, 72),
  // ── Posts, stories and media (A media, D posts) ───────────────────────────────────────────────────────────
  /** Above 180 (to 300) only by a super admin with a reason code (invariant below). */
  'ustaad.posts.video_max_s': int(15, 300, 180),
  'ustaad.posts.max_photos': int(1, 10, 6),
  'ustaad.posts.per_day': int(1, 100, 20),
  'ustaad.posts.types.voice': bool(true),
  'ustaad.posts.types.photo': bool(true),
  'ustaad.posts.types.video': bool(true),
  'ustaad.posts.types.text': bool(true),
  'ustaad.posts.types.document': bool(true),
  'ustaad.posts.types.poll': bool(true),
  'ustaad.posts.types.question': bool(true),
  'ustaad.posts.types.stories': bool(true),
  'ustaad.posts.types.mixed': bool(true),
  'ustaad.posts.types.link': bool(true),
  'ustaad.stories.hours': int(1, 72, 24),
  'ustaad.stories.purge_grace_hours': int(0, 168, 24),
  'ustaad.stories.min_account_days': int(0, 90, 30),
  'ustaad.media.data_saver_default': bool(true),
  'ustaad.media.video_kbps': int(300, 3000, 1000),
  /** Locked ceiling 150 (SR-15). */
  'ustaad.media.video_max_mb': int(10, 150, 150),
  'ustaad.media.voice_max_s': int(10, 300, 120),
  'ustaad.media.doc_max_mb': int(1, 5, 5),
  'ustaad.media.image_max_mb': int(1, 3, 3),
  'ustaad.media.member_quota_mb': int(50, 5000, 500),
  'ustaad.media.network_budget_gb': int(1, 1000, 10),
  'ustaad.media.budget_warn_pct': int(50, 95, 80),
  'ustaad.media.video_archive_months': int(0, 60, 0),
  /** Upper bound 10 locked (SR-21). */
  'ustaad.media.url_ttl_min': int(2, 10, 10),
  'ustaad.media.uploads_per_day': int(1, 200, 40),
  'ustaad.media.videos_per_day': int(0, 20, 3),
  // ── Smart correction (F) ──────────────────────────────────────────────────────────────────────────────────
  'ustaad.correction.default_mode': { kind: 'enum', values: USTAAD_CORRECTION_MODES, default: 'suggest' },
  'ustaad.correction.member_can_change': bool(true),
  'ustaad.correction.langs.hi': bool(true),
  'ustaad.correction.langs.en': bool(true),
  'ustaad.correction.langs.hinglish': bool(true),
  'ustaad.correction.langs.cg': bool(true),
  'ustaad.correction.timeout_ms': int(500, 10_000, 2000),
  'ustaad.correction.llm_daily_calls': int(0, 100_000, 5000),
  'ustaad.correction.per_member_per_10min': int(1, 200, 30),
  'ustaad.correction.max_length_change_pct': int(5, 60, 30),
  // ── Location and zones (E) ────────────────────────────────────────────────────────────────────────────────
  'ustaad.loc.default_display': {
    kind: 'enum',
    values: ['area_circle', 'city_only'],
    default: 'area_circle',
  },
  'ustaad.loc.allow_exact_optin': bool(true),
  'ustaad.loc.gps_max_m': int(20, 500, 100),
  'ustaad.loc.pin_changes_per_day': int(1, 10, 3),
  'ustaad.loc.pin_changes_per_30d': int(1, 30, 6),
  'ustaad.loc.exact_audience_default': {
    kind: 'enum',
    values: ['connections', 'all_verified'],
    default: 'connections',
  },
  'ustaad.loc.exact_fuzz_m': int(20, 200, 50),
  /** Metres (the spec's 0.5–5 km). */
  'ustaad.loc.big_move_m': int(500, 5000, 1000),
  'ustaad.loc.big_move_accuracy_m': int(10, 100, 50),
  'ustaad.zones.exact_from': int(6, 200, 20),
  /** Floor 5 locked (SR-31): checked as an invariant. */
  'ustaad.zones.hide_below': int(1, 100, 5),
  'ustaad.zones.round_above_exact': bool(true),
  'ustaad.zones.cell_edge_m': int(500, 5000, 1400),
  'ustaad.zones.verified_only': bool(true),
  // ── Feed, Discover, tags (D) ──────────────────────────────────────────────────────────────────────────────
  'ustaad.feed.show_like_counts': bool(true),
  'ustaad.feed.show_follower_counts': bool(true),
  'ustaad.feed.w_follows': int(0, 100, 30),
  'ustaad.feed.w_city': int(0, 100, 25),
  'ustaad.feed.w_tag': int(0, 100, 20),
  'ustaad.feed.w_recency': int(0, 100, 15),
  'ustaad.feed.w_helpful': int(0, 100, 10),
  'ustaad.feed.window_days': int(3, 60, 14),
  'ustaad.tags.max_per_post': int(1, 5, 5),
  'ustaad.discover.w_helpful': int(0, 100, 45),
  'ustaad.discover.w_best': int(0, 100, 25),
  'ustaad.discover.w_breadth': int(0, 100, 15),
  'ustaad.discover.w_trust': int(0, 100, 10),
  'ustaad.discover.w_new': int(0, 100, 5),
  'ustaad.discover.new_slots': int(0, 5, 2),
  'ustaad.discover.profiles_per_day': int(50, 1000, 200),
  // ── Promotions (D) ────────────────────────────────────────────────────────────────────────────────────────
  'ustaad.promo.enabled': bool(true),
  /** Floor 8 locked (SR-41): checked as an invariant. */
  'ustaad.promo.every_n': int(1, 50, 12),
  'ustaad.promo.place.feed': bool(true),
  'ustaad.promo.place.stories': bool(false),
  'ustaad.promo.place.search': bool(false),
  'ustaad.promo.place.jobs': bool(true),
  'ustaad.promo.place.learn': bool(true),
  'ustaad.promo.daily_cap_per_member': int(0, 20, 3),
  'ustaad.promo.whatsapp_per_week': int(0, 7, 2),
  // ── Moderation (F) ────────────────────────────────────────────────────────────────────────────────────────
  'ustaad.mod.retention_days': int(30, 730, 180),
  'ustaad.mod.restrict_days': int(1, 90, 3),
  'ustaad.mod.four_eyes_from_ban_days': int(1, 365, 7),
  'ustaad.mod.clock_intimate_h': int(1, 24, 2),
  'ustaad.mod.clock_legal_h': int(1, 72, 3),
  'ustaad.mod.clock_standard_h': int(1, 168, 24),
  'ustaad.mod.clock_grievance_days': int(1, 30, 7),
  /** F2: Rule 3(1)(b) removal grievances (security review L4; counsel to confirm). */
  'ustaad.mod.clock_removal_h': int(1, 72, 36),
  /** F2: the Community Rules reminder to every member (IT Rules, every 3 months per research). */
  'ustaad.mod.rules_reminder_days': int(30, 180, 90),
  /** F2: dismissed "someone under 18" reports by one member before a `false_report` strike. */
  'ustaad.mod.false_report_strike_after': int(2, 20, 3),
  'ustaad.mod.premod_first_posts': int(0, 20, 3),
  'ustaad.mod.premod_account_days': int(0, 180, 30),
  /** Score × 100 (0.70 → 70); integers only in the registry. */
  'ustaad.mod.nsfw_hold_score_pct': int(1, 100, 70),
  'ustaad.mod.links_min_account_days': int(0, 60, 7),
  'ustaad.mod.minor_report_restricts': locked(true),
  // ── Jobs (E) ──────────────────────────────────────────────────────────────────────────────────────────────
  'ustaad.jobs.enabled': bool(true),
  'ustaad.jobs.employer_verification': bool(true),
  'ustaad.jobs.never_charge_candidates': locked(true),
  'ustaad.jobs.require_adult_attestation': locked(true),
  'ustaad.jobs.expiry_days': int(7, 90, 30),
  // ── Q&A and Learn (C) ─────────────────────────────────────────────────────────────────────────────────────
  'ustaad.qa.voice_max_s': int(10, 300, 120),
  'ustaad.qa.notify_ustaads': int(1, 50, 10),
  'ustaad.qa.widen_after_h': int(1, 168, 24),
  'ustaad.qa.auto_close_days': int(7, 365, 60),
  'ustaad.qa.best_per_week': int(1, 50, 5),
  'ustaad.qa.apprentice_can_answer': bool(false),
  'ustaad.learn.self_mark_daily_cap': int(0, 50, 5),
  // ── Limits and messages (A rate limits, D messages) ───────────────────────────────────────────────────────
  'ustaad.limits.dm_min_account_days': int(0, 60, 7),
  'ustaad.limits.new_threads_per_day': int(5, 50, 20),
  'ustaad.limits.follows_per_day': int(5, 200, 20),
  // D2 (security review 2026-11-26): connection requests a day and the wait after a declined or withdrawn request.
  'ustaad.limits.connect_requests_per_day': int(5, 100, 20),
  'ustaad.limits.connect_cooldown_days': int(0, 90, 7),
  'ustaad.limits.joins_per_day': int(1, 10, 3),
  'ustaad.dm.default_mode': { kind: 'enum', values: USTAAD_DM_MODES, default: 'request' },
  // ── Notifications (A) ─────────────────────────────────────────────────────────────────────────────────────
  'ustaad.notify.digest': bool(true),
} as const satisfies Record<`ustaad.${string}`, UstaadSettingSpec>;

export type UstaadSettingKey = keyof typeof USTAAD_SETTINGS;
export const USTAAD_SETTING_KEYS = Object.keys(USTAAD_SETTINGS) as UstaadSettingKey[];
export type UstaadSettingValue = number | boolean | string;
export type UstaadSettingValues = Record<UstaadSettingKey, UstaadSettingValue>;

export function isUstaadSettingKey(key: string): key is UstaadSettingKey {
  return Object.hasOwn(USTAAD_SETTINGS, key);
}

/** Every key at its default. */
export function ustaadDefaults(): UstaadSettingValues {
  const out: Partial<UstaadSettingValues> = {};
  for (const key of USTAAD_SETTING_KEYS) out[key] = USTAAD_SETTINGS[key].default;
  return out as UstaadSettingValues;
}

/** Stored rows (any shape) → usable values: a missing or invalid stored value falls back to its default. */
export function ustaadValuesFrom(stored: Partial<Record<string, unknown>>): UstaadSettingValues {
  const out = ustaadDefaults();
  for (const key of USTAAD_SETTING_KEYS) {
    const v = stored[key];
    if (v !== undefined && ustaadSettingProblem(key, v) === null) out[key] = v as UstaadSettingValue;
  }
  return out;
}

/** Null when the value fits the key's kind and range; otherwise 'type' or 'range'. */
export function ustaadSettingProblem(key: UstaadSettingKey, value: unknown): 'type' | 'range' | null {
  const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
  if (spec.kind === 'boolean') return typeof value === 'boolean' ? null : 'type';
  if (spec.kind === 'enum') {
    if (typeof value !== 'string') return 'type';
    return spec.values.includes(value) ? null : 'range';
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 'type';
  return value < spec.min || value > spec.max ? 'range' : null;
}

const FEED_WEIGHTS = [
  'ustaad.feed.w_follows',
  'ustaad.feed.w_city',
  'ustaad.feed.w_tag',
  'ustaad.feed.w_recency',
  'ustaad.feed.w_helpful',
] as const satisfies readonly UstaadSettingKey[];
const DISCOVER_WEIGHTS = [
  'ustaad.discover.w_helpful',
  'ustaad.discover.w_best',
  'ustaad.discover.w_breadth',
  'ustaad.discover.w_trust',
  'ustaad.discover.w_new',
] as const satisfies readonly UstaadSettingKey[];

export interface UstaadInvariantProblem {
  key: UstaadSettingKey;
  code: 'SETTING_INVARIANT' | 'SETTING_RELATION';
}

/** Reason codes a super admin gives when raising the video length above 180 s (audited). */
export const USTAAD_VIDEO_RAISE_REASONS = ['founder_request', 'training_content', 'pilot'] as const;

const num = (v: UstaadSettingValue): number => (typeof v === 'number' ? v : Number.NaN);

/**
 * Server-side invariants on the whole set of values after a save (SR-40; spec 23 § 15 "Invariants"). `actorRole` is
 * the saver's role code; `reasonCode` comes with a video length above 180 s; `protectedWords` is the count of active
 * protected words (auto correction needs at least one). Returns the first problem or null.
 */
export function ustaadSettingInvariant(
  values: UstaadSettingValues,
  actorRole: string,
  opts: {
    reasonCode?: string;
    protectedWords?: number;
    /**
     * The keys this save changes (Admin → Ustaad, task G1). When given, the super admin + reason rule for a video
     * length above 180 s applies only if the video key is among them: an earlier raise does not block later saves of
     * other keys. Omitted = checked on every save (the single-key caller).
     */
    changedKeys?: readonly UstaadSettingKey[];
  } = {},
): UstaadInvariantProblem | null {
  const invariant = (key: UstaadSettingKey): UstaadInvariantProblem => ({ key, code: 'SETTING_INVARIANT' });
  for (const key of USTAAD_SETTING_KEYS) {
    const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
    if (spec.kind === 'boolean' && spec.locked === true && values[key] !== spec.default)
      return invariant(key);
  }
  const hideBelow = num(values['ustaad.zones.hide_below']);
  if (!(hideBelow >= 5)) return invariant('ustaad.zones.hide_below');
  if (!(num(values['ustaad.zones.exact_from']) > hideBelow)) return invariant('ustaad.zones.exact_from');
  if (!(num(values['ustaad.promo.every_n']) >= 8)) return invariant('ustaad.promo.every_n');
  if (!(num(values['ustaad.media.video_max_mb']) <= 150)) return invariant('ustaad.media.video_max_mb');
  if (!(num(values['ustaad.media.url_ttl_min']) <= 10)) return invariant('ustaad.media.url_ttl_min');
  const videoChanged = opts.changedKeys?.includes('ustaad.posts.video_max_s') ?? true;
  if (videoChanged && num(values['ustaad.posts.video_max_s']) > 180) {
    const reasonOk = (USTAAD_VIDEO_RAISE_REASONS as readonly string[]).includes(opts.reasonCode ?? '');
    if (actorRole !== 'super_admin' || !reasonOk) return invariant('ustaad.posts.video_max_s');
  }
  if (values['ustaad.correction.default_mode'] === 'auto' && (opts.protectedWords ?? 0) < 1)
    return invariant('ustaad.correction.default_mode');
  for (const group of [FEED_WEIGHTS, DISCOVER_WEIGHTS]) {
    const sum = group.reduce((s, k) => s + num(values[k]), 0);
    if (sum !== 100) {
      const first = group.find((k) => values[k] !== USTAAD_SETTINGS[k].default) ?? group[0];
      return { key: first, code: 'SETTING_RELATION' };
    }
  }
  return null;
}
