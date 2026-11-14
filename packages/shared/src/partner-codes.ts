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

/**
 * Why staff paused, suspended or reactivated a partner (hard rule 16: a code, with the partner-visible note as the
 * free-text extra). Shown to the partner in their language. `pause_ended` is written by the worker only (a pause
 * whose end date passed), never offered in the console.
 */
export const PARTNER_STANDING_REASONS = [
  'partner_request',
  'documents_pending',
  'missed_offers',
  'late_deliveries',
  'quality_complaints',
  'pricing_issue',
  'policy_violation',
  'fraud_suspected',
  'issue_resolved',
  'other',
  'pause_ended',
] as const;
export type PartnerStandingReason = (typeof PARTNER_STANDING_REASONS)[number];
/** The codes staff can choose (everything but the worker's own). */
export const STAFF_STANDING_REASONS = PARTNER_STANDING_REASONS.filter(
  (r): r is Exclude<PartnerStandingReason, 'pause_ended'> => r !== 'pause_ended',
);
