/**
 * Admin-editable site text (hard rule 8; spec 08 "Content"). One registry for the demo editor and the content
 * API, so both accept the same keys and the same limits (demo/API parity, advisor L58). A value is plain text
 * per key and locale; an empty or missing value means "use the default text from the locale files".
 * Hindi is edited and published separately per key (hard rule 10): `/hi` falls back to the Hindi default, never
 * to English.
 */
import { cleanLine } from './text';
export const CONTENT_LOCALES = ['en', 'hi'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/**
 * Trust lines ("genuine parts"; design 2026-11-15): one key per placement, each editable per language in Admin ->
 * Content. A line may use `{brand}` (product line). The text `-` hides the line in that language; an empty
 * value means the default from the locale files (`trust` namespace).
 */
export const TRUST_PLACEMENTS = [
  'homeGenuine',
  'homeBill',
  'homeEstimates',
  'product',
  'checkout',
  'emailFooter',
  'workshop',
  'partner',
] as const;
export type TrustPlacement = (typeof TRUST_PLACEMENTS)[number];
export type TrustKey = `trust.${TrustPlacement}`;
/** The text that hides a trust line in one language. */
export const TRUST_HIDDEN = '-';
export const TRUST_MAX = 140;

export const trustKey = (placement: TrustPlacement): TrustKey => `trust.${placement}`;
export const isTrustKey = (key: string): key is TrustKey =>
  key.startsWith('trust.') && (TRUST_PLACEMENTS as readonly string[]).includes(key.slice(6));
/** The placement a content key belongs to, or null for other keys (analytics `trust_line_edited`). */
export const trustPlacementOf = (key: string): TrustPlacement | null =>
  isTrustKey(key) ? (key.slice(6) as TrustPlacement) : null;

export const CONTENT_KEYS = [
  'announcement.orders',
  'announcement.workshops',
  'hero.eyebrow',
  'hero.titleLine1',
  'hero.titleLine2',
  'hero.lead',
  'trust.homeGenuine',
  'trust.homeBill',
  'trust.homeEstimates',
  'trust.product',
  'trust.checkout',
  'trust.emailFooter',
  'trust.workshop',
  'trust.partner',
  // "Your savings" wording (decision 2026-11-26): order page and account card lines keep `{amount}`; the cart label.
  'savings.order',
  'savings.account',
  'savings.cart',
] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

const CONTENT_MAX: Partial<Record<ContentKey, number>> = {
  'hero.lead': 280,
  'savings.order': 160,
  'savings.account': 160,
  'savings.cart': 160,
};
export const CONTENT_MAX_DEFAULT = 80;

export function isContentKey(key: string): key is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(key);
}

export function contentMax(key: ContentKey): number {
  return CONTENT_MAX[key] ?? (isTrustKey(key) ? TRUST_MAX : CONTENT_MAX_DEFAULT);
}

/** Plain text only: control and format characters dropped, whitespace collapsed, trimmed, length capped. */
export function cleanContentText(key: ContentKey, value: string): string {
  return cleanLine(value, contentMax(key));
}

/**
 * The text a trust line shows: the admin's override when there is one, else `fallback` (the locale-file default,
 * already filled in). `null` = hidden. An override that needs a `{brand}` the page does not have falls back to
 * the default, so a raw placeholder never reaches a customer.
 */
export function trustLineText(
  override: string | null | undefined,
  fallback: string,
  vars: { brand?: string | null } = {},
): string | null {
  const text = override?.trim();
  if (!text) return fallback;
  if (text === TRUST_HIDDEN) return null;
  if (text.includes('{brand}')) {
    const brand = vars.brand?.trim();
    return brand ? text.replaceAll('{brand}', brand) : fallback;
  }
  return text;
}

export type SavingsContentKey = 'savings.order' | 'savings.account' | 'savings.cart';
export const SAVINGS_CONTENT_KEYS: readonly SavingsContentKey[] = [
  'savings.order',
  'savings.account',
  'savings.cart',
];

/**
 * The text a "Your savings" line shows (decision 2026-11-26): the admin's override when there is one, else
 * `fallback` (the locale-file default), with `{amount}` filled. The order and account lines must keep `{amount}`; an
 * override without it falls back to the default, so a line is never shown without its figure.
 */
export function savingsLineText(
  key: SavingsContentKey,
  override: string | null | undefined,
  fallback: string,
  amount: string,
): string {
  const text = override?.trim();
  const usable = text && (key === 'savings.cart' || text.includes('{amount}')) ? text : fallback;
  return usable.replaceAll('{amount}', amount);
}
