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
  /** How long a COD order's stock hold lasts (minutes, from checkout or the latest routing). The worker's sweep
   *  then puts the stock back on sale; a later accept re-reserves it or is refused (spec 04). */
  'checkout.cod_reservation_minutes': { kind: 'int', min: 30, max: 10_080, default: 1440 },
  /** Minutes to finish an online payment; the stock hold lasts as long, then the worker cancels the unpaid
   *  order and puts the stock back (Razorpay, plan 2026-11-12). */
  'checkout.online_payment_minutes': { kind: 'int', min: 10, max: 120, default: 30 },
  /** Delivery charge pre-filled for each PIN when approving a new shop (paise; design 2026-11-13). */
  'partners.default_shipping_paise': { kind: 'int', min: 0, max: 50_000, default: 4_000 },
  /** Delivery days pre-filled for each PIN when approving a new shop. */
  'partners.default_lead_days': { kind: 'int', min: 0, max: 14, default: 2 },
  /** Days a seller invite link stays valid. */
  'partners.invite_days': { kind: 'int', min: 1, max: 30, default: 7 },
  /**
   * A new shop must accept the current MechDost seller agreement before it goes live. Off until the agreement text
   * exists (Q77): the admin publishes a version, then turns this on. On with no version published, new shops wait.
   */
  'partners.agreement_required': { kind: 'boolean', default: false },
  /**
   * Customers may cancel their own order until the shop confirms it. Off by default: cancelling goes through
   * support (Q25, user 2026-11-13). Copied onto each order at checkout (`orders.cancellable_until_status`).
   */
  'orders.customer_self_cancel': { kind: 'boolean', default: false },
  /** How long a shop has to accept an offered order (minutes). */
  // Same bounds as the demo `/admin/settings` screen and spec 08 (5–120 min).
  'orders.acceptance_timeout_min': { kind: 'int', min: 5, max: 120, default: 15 },
  /** Smallest bulk quote, in units across all its products (spec 19, Q20 default 10). */
  'quotes.min_units': { kind: 'int', min: 2, max: 500, default: 10 },
  /** Launch check: products go live only with complete Hindi texts. */
  // One catalogue for every city: publishing reads the global value only.
  'catalogue.require_hindi_to_publish': { kind: 'boolean', default: false, globalOnly: true },
  /** Customer messages (the first one included) allowed on one support request in 24 hours (review B9). */
  'support.customer_messages_per_ticket_per_day': {
    kind: 'int',
    min: 5,
    max: 100,
    default: 20,
    globalOnly: true,
  },
  /**
   * Messages the shoppers' AI assistant may answer per day for the whole site (cost cap, security review
   * 2026-11-14, Q91); 0 turns the AI answers off. Over the cap the website shows its built-in answers.
   */
  'assistant.daily_messages': { kind: 'int', min: 0, max: 100_000, default: 500, globalOnly: true },
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
