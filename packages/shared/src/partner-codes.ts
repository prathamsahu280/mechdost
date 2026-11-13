/**
 * Seller onboarding code lists (design 2026-11-13). No Zod here: browser code imports these directly; the schemas
 * that use them are in `partners.ts`, which re-exports everything below.
 */
export const GST_STATUSES = ['registered', 'enrolled'] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

/** How the shop's map pin was set: the device's location, an address search, or by moving the pin. */
export const LOCATION_SOURCES = ['gps', 'search', 'pin'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const APPLICATION_REJECT_REASONS = [
  'not_serviceable',
  'documents_invalid',
  'duplicate',
  'not_a_business',
  'other',
] as const;
export type ApplicationRejectReason = (typeof APPLICATION_REJECT_REASONS)[number];
export const PRICE_REJECT_REASONS = ['above_market', 'mrp_mismatch', 'wrong_product', 'other'] as const;
export type PriceRejectReason = (typeof PRICE_REJECT_REASONS)[number];
