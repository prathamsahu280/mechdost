/**
 * Operational settings the admin edits (hard rule 8; spec 08 "Settings"). One typed registry: the API validates
 * writes against it, the repositories read the same keys, defaults live here. Scope: global, optionally
 * overridden per city (city value wins). Money in integer paise, durations in minutes.
 */
/** `globalOnly`: the system reads only the global value, so a city override is refused (it would do nothing). */
export type SettingSpec = { globalOnly?: true } & (
  | { kind: 'int'; min: number; max: number; default: number; nullable?: false }
  | { kind: 'int'; min: number; max: number; default: number | null; nullable: true }
  | { kind: 'boolean'; default: boolean }
);

export const OPERATIONAL_SETTINGS = {
  /** Largest cash-on-delivery order total (paise). */
  'checkout.cod_cap_paise': { kind: 'int', min: 0, max: 10_000_000, default: 500_000 },
  /** Fee added to cash-on-delivery orders (paise). */
  'checkout.cod_fee_paise': { kind: 'int', min: 0, max: 50_000, default: 0 },
  /** A shop group's delivery is free from this subtotal (paise); null = never free. */
  'checkout.free_delivery_min_paise': { kind: 'int', min: 0, max: 10_000_000, default: null, nullable: true },
  /** Expiry stamped on a COD order's stock hold (minutes). No sweep frees expired holds yet (spec 04), so today
   *  holds last until accept, reject or cancel; the value takes effect when the sweep is scheduled. */
  'checkout.cod_reservation_minutes': { kind: 'int', min: 30, max: 10_080, default: 1440 },
  /** How long a shop has to accept an offered order (minutes). */
  // Same bounds as the demo `/admin/settings` screen and spec 08 (5–120 min).
  'orders.acceptance_timeout_min': { kind: 'int', min: 5, max: 120, default: 15 },
  /** Launch check: products go live only with complete Hindi texts. */
  // One catalogue for every city: publishing reads the global value only.
  'catalogue.require_hindi_to_publish': { kind: 'boolean', default: false, globalOnly: true },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof OPERATIONAL_SETTINGS;
export const SETTING_KEYS = Object.keys(OPERATIONAL_SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(OPERATIONAL_SETTINGS, key);
}

/** Null when the value fits the setting; otherwise a short reason code. */
export function settingProblem(key: SettingKey, value: unknown): 'type' | 'range' | null {
  const spec: SettingSpec = OPERATIONAL_SETTINGS[key];
  if (spec.kind === 'boolean') return typeof value === 'boolean' ? null : 'type';
  if (value === null) return spec.nullable ? null : 'type';
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 'type';
  return value < spec.min || value > spec.max ? 'range' : null;
}

/** True when the system reads only the global value of `key` (no city overrides). */
export function isGlobalOnly(key: SettingKey): boolean {
  const spec: SettingSpec = OPERATIONAL_SETTINGS[key];
  return spec.globalOnly === true;
}
