import type messagesEn from '@mechdost/shared/i18n/en.json';
import {
  USTAAD_SETTINGS,
  USTAAD_SETTING_KEYS,
  USTAAD_VIDEO_RAISE_REASONS,
  ustaadSettingInvariant,
  ustaadSettingProblem,
  type UstaadSettingKey,
  type UstaadSettingSpec,
  type UstaadSettingValue,
  type UstaadSettingValues,
} from '@mechdost/shared/ustaad/settings';

/**
 * View model for Admin → Ustaad Network (spec 23 § 15; task G1). Pure functions so the node-only tests cover them: the
 * ten sections of the admin page (the newer `ustaad-admin.html` order), which section every registry key lives in,
 * its unit, the text keys of its label/help/options, the changed keys of one save, and the same invariant check the
 * server runs (`ustaadSettingInvariant`), so a problem shows at its row before Save.
 *
 * Text lives in `ustaad.admin.*` (en + hi): `lbl_<flat>`, `help_<flat>`, `opt_<flat>_<value>`, `sec_<id>`,
 * `sec_<id>_help`, `unit_<unit>`, `inv_<flat>`; `<flat>` is the key without `ustaad.` with dots as `_`.
 */
export const USTAAD_ADMIN_SECTIONS = [
  'general',
  'levels',
  'verify',
  'posts',
  'corr',
  'loc',
  'feed',
  'promo',
  'mod',
  'jobs',
] as const;
export type UstaadAdminSection = (typeof USTAAD_ADMIN_SECTIONS)[number];

/** The access switch has its own card at the top of the page; it is not a row in a section. */
export const ACCESS_KEY = 'ustaad.access' satisfies UstaadSettingKey;

const SECTION_BY_PREFIX: readonly [string, UstaadAdminSection][] = [
  ['ustaad.general.', 'general'],
  ['ustaad.limits.', 'general'],
  ['ustaad.dm.', 'general'],
  ['ustaad.notify.', 'general'],
  ['ustaad.levels.', 'levels'],
  ['ustaad.izzat.', 'levels'],
  ['ustaad.verify.', 'verify'],
  ['ustaad.security.', 'verify'],
  ['ustaad.posts.', 'posts'],
  ['ustaad.stories.', 'posts'],
  ['ustaad.media.', 'posts'],
  ['ustaad.qa.', 'posts'],
  ['ustaad.learn.', 'posts'],
  ['ustaad.correction.', 'corr'],
  ['ustaad.loc.', 'loc'],
  ['ustaad.zones.', 'loc'],
  ['ustaad.feed.', 'feed'],
  ['ustaad.tags.', 'feed'],
  ['ustaad.discover.', 'feed'],
  ['ustaad.promo.', 'promo'],
  ['ustaad.mod.', 'mod'],
  ['ustaad.jobs.', 'jobs'],
];

/** The section a key is shown in; `null` for the access switch and for a key nobody placed yet (a test fails). */
export function sectionOfKey(key: UstaadSettingKey): UstaadAdminSection | null {
  if (key === ACCESS_KEY) return null;
  return SECTION_BY_PREFIX.find(([p]) => key.startsWith(p))?.[1] ?? null;
}

/** `ustaad.posts.video_max_s` → `posts_video_max_s` (message keys cannot contain dots). */
export const flatKey = (key: string): string => key.replace(/^ustaad\./, '').replaceAll('.', '_');

export type UstaadUnit =
  | 'days'
  | 'months'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'ms'
  | 'mb'
  | 'gb'
  | 'metres'
  | 'pct'
  | 'kbps'
  | 'per_day';

/** The unit shown after a number input; `null` for plain counts, switches and choices. */
export function unitOf(key: UstaadSettingKey): UstaadUnit | null {
  const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
  if (spec.kind !== 'int') return null;
  const k = key.replace(/^ustaad\./, '');
  if (/(^|\.)w_/.test(k) || k.endsWith('_pct')) return 'pct';
  if (k.endsWith('_days')) return 'days';
  if (k.endsWith('_months')) return 'months';
  if (k.endsWith('_hours') || k.endsWith('_h') || k === 'stories.hours') return 'hours';
  if (k.endsWith('_10min')) return null;
  if (k.endsWith('_min')) return 'minutes';
  if (k.endsWith('_ms')) return 'ms';
  if (k.endsWith('_s')) return 'seconds';
  if (k.endsWith('_mb')) return 'mb';
  if (k.endsWith('_gb')) return 'gb';
  if (k.endsWith('_m')) return 'metres';
  if (k.endsWith('_kbps')) return 'kbps';
  if (k.endsWith('per_day')) return 'per_day';
  return null;
}

/** Locked registry keys (on and fixed): shown read-only with a lock, never sent. */
export function isLockedKey(key: UstaadSettingKey): boolean {
  const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
  return spec.kind === 'boolean' && spec.locked === true;
}

/** Keys of one section in registry order, the access switch left out. */
export function keysOfSection(section: UstaadAdminSection): UstaadSettingKey[] {
  return USTAAD_SETTING_KEYS.filter((k) => sectionOfKey(k) === section);
}

/** A stored value as the input holds it. */
export function toInput(value: UstaadSettingValue): string {
  return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
}

/** The input text back to a value of the key's kind (`null` = not a valid value of that kind). */
export function fromInput(key: UstaadSettingKey, text: string): UstaadSettingValue | null {
  const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
  if (spec.kind === 'boolean') return text === 'true' ? true : text === 'false' ? false : null;
  if (spec.kind === 'enum') return spec.values.includes(text) ? text : null;
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  return Number(text.trim());
}

export interface SavedRow {
  key: string;
  value: UstaadSettingValue;
  version: number | null;
}

/** The edited values of the registry (a key the draft does not hold keeps its saved value). */
export function draftValues(saved: readonly SavedRow[], draft: Readonly<Record<string, string>>) {
  const out: Partial<Record<UstaadSettingKey, UstaadSettingValue>> = {};
  for (const key of USTAAD_SETTING_KEYS) {
    const row = saved.find((r) => r.key === key);
    const base = row?.value ?? USTAAD_SETTINGS[key].default;
    const text = draft[key];
    const parsed = text === undefined ? base : fromInput(key, text);
    out[key] = parsed ?? base;
  }
  return out as UstaadSettingValues;
}

export interface Change {
  key: UstaadSettingKey;
  value: UstaadSettingValue;
  version: number | null;
}

/** Only the keys whose edited value differs from the saved one, each with the version it was read at. */
export function changesOf(saved: readonly SavedRow[], draft: Readonly<Record<string, string>>): Change[] {
  const out: Change[] = [];
  for (const key of USTAAD_SETTING_KEYS) {
    const text = draft[key];
    if (text === undefined || isLockedKey(key)) continue;
    const row = saved.find((r) => r.key === key);
    const before = row?.value ?? USTAAD_SETTINGS[key].default;
    const value = fromInput(key, text);
    if (value === null || value === before) continue;
    out.push({ key, value, version: row?.version ?? null });
  }
  return out;
}

export type FieldProblem =
  | { kind: 'type' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'invariant'; message: `inv_${string}` }
  | { kind: 'relation'; message: `inv_${string}` };

/** The message key of an invariant or relation problem on `key`. */
export function invariantMessage(key: string): `inv_${string}` {
  if (key.startsWith('ustaad.feed.w_')) return 'inv_feed_weights';
  if (key.startsWith('ustaad.discover.w_')) return 'inv_discover_weights';
  if (isUstaadKey(key) && isLockedKey(key)) return 'inv_locked';
  const known: Record<string, `inv_${string}`> = {
    'ustaad.zones.hide_below': 'inv_zones_hide_below',
    'ustaad.zones.exact_from': 'inv_zones_exact_from',
    'ustaad.promo.every_n': 'inv_promo_every_n',
    'ustaad.media.video_max_mb': 'inv_media_video_max_mb',
    'ustaad.media.url_ttl_min': 'inv_media_url_ttl_min',
    'ustaad.posts.video_max_s': 'inv_posts_video_max_s',
    'ustaad.correction.default_mode': 'inv_correction_default_mode',
  };
  return known[key] ?? 'inv_locked';
}

const isUstaadKey = (key: string): key is UstaadSettingKey => Object.hasOwn(USTAAD_SETTINGS, key);

/**
 * Problems per key for the edited set, as the server would answer them: type, range, then the invariants over the
 * merged values (video above 180 s checked only when it changes). `protectedWords` = active protected words.
 */
export function fieldProblems(
  saved: readonly SavedRow[],
  draft: Readonly<Record<string, string>>,
  opts: { superAdmin: boolean; reasonCode: string; protectedWords: number },
): Partial<Record<UstaadSettingKey, FieldProblem>> {
  const out: Partial<Record<UstaadSettingKey, FieldProblem>> = {};
  for (const key of USTAAD_SETTING_KEYS) {
    const text = draft[key];
    if (text === undefined) continue;
    const value = fromInput(key, text);
    const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
    if (value === null) out[key] = { kind: 'type' };
    else if (ustaadSettingProblem(key, value) === 'range' && spec.kind === 'int')
      out[key] = { kind: 'range', min: spec.min, max: spec.max };
  }
  const changed = changesOf(saved, draft).map((c) => c.key);
  const problem = ustaadSettingInvariant(
    draftValues(saved, draft),
    opts.superAdmin ? 'super_admin' : 'staff',
    {
      ...(opts.reasonCode ? { reasonCode: opts.reasonCode } : {}),
      protectedWords: opts.protectedWords,
      changedKeys: changed,
    },
  );
  if (problem && !out[problem.key])
    out[problem.key] = {
      kind: problem.code === 'SETTING_RELATION' ? 'relation' : 'invariant',
      message: invariantMessage(problem.key),
    };
  return out;
}

/** The video length goes above 180 s in this save: a reason code is asked for (super admin only). */
export function needsVideoReason(changes: readonly Change[]): boolean {
  return changes.some(
    (c) => c.key === 'ustaad.posts.video_max_s' && typeof c.value === 'number' && c.value > 180,
  );
}

export const VIDEO_REASONS = USTAAD_VIDEO_RAISE_REASONS;

/** Changes that need a second look before saving (the confirm dialog lists them). */
export type UstaadRisk = 'risk_access' | 'risk_network_off' | 'risk_video' | 'risk_feature_off';
const FEATURE_SWITCHES: readonly UstaadSettingKey[] = ['ustaad.jobs.enabled', 'ustaad.promo.enabled'];

export function riskOf(change: Change): UstaadRisk | null {
  if (change.key === ACCESS_KEY) return 'risk_access';
  if (change.key === 'ustaad.general.enabled' && change.value === false) return 'risk_network_off';
  if (change.key === 'ustaad.posts.video_max_s' && typeof change.value === 'number' && change.value > 180)
    return 'risk_video';
  if (FEATURE_SWITCHES.includes(change.key) && change.value === false) return 'risk_feature_off';
  return null;
}

/** A message key of `ustaad.admin` built from a registry key or a code; the unit test checks every one exists. */
export type UstaadAdminMessage = keyof (typeof messagesEn)['ustaad']['admin'];
export const adminMessage = (id: string): UstaadAdminMessage => id as UstaadAdminMessage;

/** The save bar's message: "Fix the highlighted settings first" goes away once nothing is highlighted (SIM-B2). */
export function barStatus<S extends { fixFirst?: boolean } | null>(
  status: S,
  problemCount: number,
): S | null {
  return status?.fixFirst === true && problemCount === 0 ? null : status;
}

/** The section named by `?sec=` (unknown or missing = the first). */
export function sectionFromQuery(value: string | null): UstaadAdminSection {
  return USTAAD_ADMIN_SECTIONS.find((s) => s === value) ?? 'general';
}
