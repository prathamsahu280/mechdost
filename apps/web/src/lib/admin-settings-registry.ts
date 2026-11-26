import {
  Building2,
  Bell,
  CreditCard,
  Coins,
  Handshake,
  LifeBuoy,
  MapPin,
  Package,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Siren,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/**
 * The categories of Admin → Settings (spec 08 "Settings", design 2026-11-24). One registry: adding a category is one
 * entry here (plus its two messages `cat_<id>` and `cat_<id>_help` in the `adminSettings` namespace). A category with
 * no settings and no panel is not shown, so a feature branch can register its category before its keys exist.
 *
 * A setting joins a category by key prefix (`prefixes`) unless `KEY_CATEGORY` names it explicitly. Every key of the
 * operational registry must land in a category; `test/admin-settings-registry.test.ts` fails otherwise.
 */
export const SETTINGS_CATEGORY_IDS = [
  'store',
  'orders',
  'payments',
  'coins',
  'partners',
  'service',
  'area',
  'notifications',
  'catalogue',
  'support',
  'limits',
  'roadside',
  'other',
] as const;
export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

export interface SettingsCategory {
  id: SettingsCategoryId;
  /** Icon beside the name (decorative, aria-hidden; the name carries the meaning). */
  icon: LucideIcon;
  /** Key prefixes of the operational settings that belong here (`other` takes whatever no category claims). */
  prefixes: readonly string[];
  /** Admin section that holds this category's own screens (templates, texts), linked from the category. */
  link?: { section: 'notifications' | 'catalogue' | 'coins' };
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: 'store', icon: Building2, prefixes: ['customers.'] },
  { id: 'orders', icon: Package, prefixes: ['orders.', 'checkout.', 'quotes.'] },
  { id: 'payments', icon: CreditCard, prefixes: ['refunds.'] },
  { id: 'coins', icon: Coins, prefixes: ['coins.'], link: { section: 'coins' } },
  // Delivery agents (spec 24) sit with the partners until the Delivery section has its own settings screen.
  { id: 'partners', icon: Handshake, prefixes: ['partners.', 'delivery.'] },
  { id: 'service', icon: Wrench, prefixes: ['service.'] },
  { id: 'area', icon: MapPin, prefixes: [] },
  {
    id: 'notifications',
    icon: Bell,
    prefixes: ['notifications.'],
    link: { section: 'notifications' },
  },
  {
    id: 'catalogue',
    icon: ShoppingBag,
    prefixes: ['catalogue.'],
    link: { section: 'catalogue' },
  },
  { id: 'support', icon: LifeBuoy, prefixes: ['support.'] },
  { id: 'limits', icon: ShieldCheck, prefixes: ['api.', 'assistant.'] },
  // Roadside assistance (user 2026-11-23): its settings land here once the keys exist (prefix `roadside.`).
  { id: 'roadside', icon: Siren, prefixes: ['roadside.'] },
  { id: 'other', icon: Settings2, prefixes: [] },
];

/** Keys whose prefix would put them elsewhere: money going in and out is under Payments. */
const KEY_CATEGORY: Partial<Record<string, SettingsCategoryId>> = {
  'checkout.cod_cap_paise': 'payments',
  'checkout.cod_everyone': 'payments',
  'checkout.cod_approved_customers': 'payments',
  'checkout.cod_ustaad_verified': 'payments',
  'checkout.cod_ustaad_min_level': 'payments',
  'checkout.cod_min_order_paise': 'payments',
  'checkout.cod_min_items': 'payments',
  'checkout.cod_request_reapply_days': 'payments',
  'checkout.cod_fee_paise': 'payments',
  'checkout.online_payment_minutes': 'payments',
  'quotes.cod_cap_paise': 'payments',
};

/** The category a setting key belongs to (`other` when nothing claims it, so no setting is ever hidden). */
export function categoryOfKey(key: string): SettingsCategoryId {
  const explicit = KEY_CATEGORY[key];
  if (explicit) return explicit;
  for (const category of SETTINGS_CATEGORIES)
    if (category.prefixes.some((prefix) => key.startsWith(prefix))) return category.id;
  return 'other';
}

/** Search match: every word of the query appears in the setting's text (case-insensitive, Devanagari-safe). */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = query.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack.normalize('NFC').toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * Changes that deserve a second look before they save (design 2026-11-24): each returns a reason message key
 * (namespace `adminSettings`) when the change `from → to` is risky, else null. The same rules for the demo and the API.
 */
export type RiskReason =
  | 'risk_codOff'
  | 'risk_codEveryone'
  | 'risk_assistantOff'
  | 'risk_redeemOff'
  | 'risk_verifiedEmail'
  | 'risk_agreement'
  | 'risk_apiLimit';

export function riskOfChange(
  key: string,
  from: number | boolean | null,
  to: number | boolean | null,
): RiskReason | null {
  if (from === to) return null;
  switch (key) {
    case 'checkout.cod_cap_paise':
      return to === 0 ? 'risk_codOff' : null;
    // Founder 2026-11-26: cash handling is the reason COD is not for everyone; turning it on needs a second look.
    case 'checkout.cod_everyone':
      return to === true ? 'risk_codEveryone' : null;
    case 'assistant.daily_messages':
      return to === 0 ? 'risk_assistantOff' : null;
    case 'coins.max_redeem_bp':
      return to === 0 ? 'risk_redeemOff' : null;
    case 'customers.require_verified_email':
      return to === true ? 'risk_verifiedEmail' : null;
    case 'partners.agreement_required':
      return to === true ? 'risk_agreement' : null;
    case 'api.signed_in_per_minute':
    case 'api.guest_per_ip_per_minute':
    case 'api.ip_flood_per_minute':
      return typeof to === 'number' && typeof from === 'number' && to < from ? 'risk_apiLimit' : null;
    default:
      return null;
  }
}
