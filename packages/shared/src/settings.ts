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
  /**
   * Warnings in the rolling window (below) at which admin is prompted to consider pausing a partner. Only a prompt:
   * nothing pauses by itself (user ruling 2026-11-15).
   */
  'partners.warning_threshold': { kind: 'int', min: 1, max: 20, default: 3, globalOnly: true },
  /** The rolling window, in days (24-hour days from now, UTC), over which warnings count toward the prompt. */
  'partners.warning_window_days': { kind: 'int', min: 7, max: 180, default: 30, globalOnly: true },
  /** Days a seller invite link stays valid. */
  'partners.invite_days': { kind: 'int', min: 1, max: 30, default: 7 },
  /**
   * A new shop must accept the current MechDost seller agreement before it goes live. Off until the agreement text
   * exists (Q77): the admin publishes a version, then turns this on. On with no version published, new shops wait.
   */
  'partners.agreement_required': { kind: 'boolean', default: false },
  /**
   * Customers may cancel their own cash-on-delivery order until the shop confirms it. Off by default: cancelling
   * goes through support (Q25, user 2026-11-13). Copied onto each order at checkout (`orders.cancellable_until_status`).
   */
  'orders.customer_self_cancel_cod': { kind: 'boolean', default: false },
  /** The same rule for orders paid online (refund to the original method on cancel); separate (user 2026-11-14). */
  'orders.customer_self_cancel_online': { kind: 'boolean', default: false },
  /** How long a shop has to accept an offered order (minutes). */
  // Same bounds as the demo `/admin/settings` screen and spec 08 (5–120 min).
  'orders.acceptance_timeout_min': { kind: 'int', min: 5, max: 120, default: 15 },
  /**
   * An order routed to a closed shop waits for it: the shop has until its next opening time plus these minutes to
   * accept (user 2026-11-14, shop working hours; spec 04).
   */
  'orders.closed_shop_grace_min': { kind: 'int', min: 15, max: 240, default: 60 },
  /**
   * A refund request waiting longer than this many hours is flagged overdue in Admin → Refunds (spec 05, decision
   * 2026-11-15: every refund needs approval, so a waiting customer must not be forgotten).
   */
  'refunds.approval_sla_hours': { kind: 'int', min: 1, max: 720, default: 24 },
  /*
   * Notifications (spec 10, design 2026-11-15 bell and push). Site-wide: a person's bell does not depend on a city.
   */
  /** In-app notifications older than this many days are deleted by the daily retention job. */
  'notifications.retention_days': { kind: 'int', min: 7, max: 365, default: 90, globalOnly: true },
  /** "Not now" on the push prompt hides it for this many days. */
  'notifications.push_prompt_snooze_days': { kind: 'int', min: 1, max: 90, default: 14, globalOnly: true },
  /** Promotional notifications a person may get per week (needs their marketing consent too). */
  'notifications.promo_per_week': { kind: 'int', min: 0, max: 14, default: 2, globalOnly: true },
  /** A shop is reminded this many minutes before an order offer expires; 0 turns the reminder off. */
  'notifications.offer_expiry_reminder_min': { kind: 'int', min: 0, max: 60, default: 5, globalOnly: true },
  /** Smallest bulk quote, in units across all its products (spec 19, Q20 default 10). */
  'quotes.min_units': { kind: 'int', min: 2, max: 500, default: 10 },
  /**
   * Largest accepted bulk quote paid by cash on delivery (paise; review 2026-11-14). Above it the customer is asked
   * to contact MechDost (online payment for quotes is pending #18).
   */
  'quotes.cod_cap_paise': { kind: 'int', min: 0, max: 100_000_000, default: 5_000_000 },
  /** Launch check: products go live only with complete Hindi texts. */
  // One catalogue for every city: publishing reads the global value only.
  'catalogue.require_hindi_to_publish': { kind: 'boolean', default: false, globalOnly: true },
  /**
   * Customers must verify their email (not only their phone) before ordering, booking or reviewing. Off by default:
   * phone OTP is enough (user 2026-11-14). Staff and partners always need both.
   */
  'customers.require_verified_email': { kind: 'boolean', default: false, globalOnly: true },
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
  /*
   * MechDost Coins (spec 20; Q24, user 2026-11-13). Coins belong to the customer's account, not a city, so every
   * coin rule is site-wide. Every reward is 0 until the admin sets it. Saving one needs `coins:rules` too.
   */
  /** Discount value of one coin (paise). */
  'coins.value_paise': { kind: 'int', min: 100, max: 1_000, default: 100, globalOnly: true },
  /** Most of an order's product subtotal coins may pay (basis points, 1000 = 10%); 0 turns redemption off. */
  'coins.max_redeem_bp': { kind: 'int', min: 0, max: 5_000, default: 1_000, globalOnly: true },
  /** Smallest product subtotal on which coins can be used (paise). */
  'coins.min_order_paise': { kind: 'int', min: 0, max: 10_000_000, default: 0, globalOnly: true },
  /** Coins earned on a delivered order: this share of what its products cost (basis points, 100 = 1%). */
  'coins.earn_order_bp': { kind: 'int', min: 0, max: 2_000, default: 0, globalOnly: true },
  /** Extra coins for a customer's first delivered order. */
  'coins.first_order_bonus': { kind: 'int', min: 0, max: 10_000, default: 0, globalOnly: true },
  /** Coins for each paid workshop booking. */
  'coins.workshop_booking_bonus': { kind: 'int', min: 0, max: 10_000, default: 0, globalOnly: true },
  /**
   * Anti-abuse for workshop rewards (security review 2026-11-14): "paid at the workshop" is the workshop's own word,
   * so no reward below this bill total (paise) ...
   */
  'coins.workshop_reward_min_bill_paise': {
    kind: 'int',
    min: 0,
    max: 10_000_000,
    default: 50_000,
    globalOnly: true,
  },
  /** ... and at most one reward per customer per workshop in this many days (0 = no limit). */
  'coins.workshop_reward_cooldown_days': { kind: 'int', min: 0, max: 365, default: 30, globalOnly: true },
  /** Most coins staff may grant and deduct together for one customer in one IST day (code review 2026-11-14). */
  'coins.adjust_daily_cap': { kind: 'int', min: 1, max: 1_000_000, default: 5_000, globalOnly: true },
  /** Days before earned coins can be used (after the 7-day claim window, so claims cannot farm coins). */
  'coins.unlock_days': { kind: 'int', min: 0, max: 60, default: 8, globalOnly: true },
  /** Days before unused coins expire. */
  'coins.expiry_days': { kind: 'int', min: 30, max: 1_095, default: 180, globalOnly: true },
  /**
   * The labour promise (user 2026-11-15, Q105): when on, workshop pages, the booking review and the bill say the
   * workshop redoes faulty labour free within `service.labour_promise_days` days. Off until the admin chooses.
   * Site-wide, like the wording it drives.
   */
  'service.labour_promise_enabled': { kind: 'boolean', default: false, globalOnly: true },
  /** Days the labour promise lasts; copied onto each bill when it is made, so a later change never rewrites it. */
  'service.labour_promise_days': { kind: 'int', min: 7, max: 90, default: 30, globalOnly: true },
  /**
   * Home servicing (spec 06, 15): the most a workshop may charge as its home visit fee in this city (paise). Each
   * workshop sets its own fee up to this; 0 means visits must be free.
   */
  'service.home_fee_max_paise': { kind: 'int', min: 0, max: 50_000, default: 50_000 },
  /**
   * Job photos (spec 06, user 2026-11-15): with this on, a workshop needs a before photo to receive the vehicle and an
   * after photo to mark it ready. On by default; the admin may make photos optional. Site-wide.
   */
  'service.photos_required': { kind: 'boolean', default: true, globalOnly: true },
  /** Whether completed jobs' photos show on the workshop's public page. Private by default; the admin alone decides. */
  'service.photos_public': { kind: 'boolean', default: false, globalOnly: true },
  /** Most photos per stage (before, after) for one job. */
  'service.photos_max_per_stage': { kind: 'int', min: 1, max: 12, default: 6, globalOnly: true },
  /**
   * Workshops tier 1 (spec 06): minutes a request waits in `awaiting_workshop` before it goes back to routing and counts
   * against the workshop. Per city.
   */
  'service.acceptance_timeout_min': { kind: 'int', min: 10, max: 1440, default: 60 },
} as const satisfies Record<string, SettingSpec>;

/**
 * Order rewards can be farmed (order, cancel after delivery, re-order) until an anti-abuse guard is chosen (user
 * 2026-11-14: "decide when enabling"; pending decisions). Until then they can only be saved as 0.
 */
export const COIN_GUARDED_SETTINGS: readonly SettingKey[] = [
  'coins.earn_order_bp',
  'coins.first_order_bonus',
];

/** True when `value` would switch on a reward that still needs its guard (COIN_GUARD_REQUIRED). */
export function needsCoinGuard(key: SettingKey, value: unknown): boolean {
  return COIN_GUARDED_SETTINGS.includes(key) && typeof value === 'number' && value > 0;
}

/** Coin rule keys: saving one also needs the `coins:rules` permission (spec 20). */
export const isCoinSettingKey = (key: string): boolean => key.startsWith('coins.');

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
