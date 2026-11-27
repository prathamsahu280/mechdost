/**
 * Reason codes that every storefront page needs (the demo store), kept apart from the machines in `index.ts`:
 * Turbopack drops unused code per file, so importing these from the index put every machine into every page
 * (JS budget 2026-11-27). Re-exported from `index.ts`, so other imports stay unchanged.
 */

/**
 * Why staff rejected an order (spec 04; ML-ready codes, hard rule 16). The customer also gets a message.
 */
export const ORDER_REJECT_REASONS = [
  'no_stock_nearby',
  'all_shops_declined',
  'unserviceable_address',
  'suspected_fraud',
  'pricing_error',
  'other',
] as const;
export type OrderRejectReason = (typeof ORDER_REJECT_REASONS)[number];

/** Why an order was cancelled before delivery (customer or staff; ML-ready codes, spec 05). */
export const ORDER_CANCEL_REASONS = [
  'changed_mind',
  'ordered_by_mistake',
  'found_cheaper',
  'delivery_too_slow',
  'customer_unreachable',
  /** System: an online order whose payment did not complete within the payment window. */
  'payment_not_completed',
  'other',
] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];

/** Why a customer cancelled a workshop booking (spec 06: allowed until the vehicle is received). */
export const SERVICE_CANCEL_REASONS = [
  'changed_mind',
  'booked_by_mistake',
  'found_another_workshop',
  'slot_not_suitable',
  'problem_solved',
  'other',
] as const;
export type ServiceCancelReason = (typeof SERVICE_CANCEL_REASONS)[number];

/** Why a shop declined an offered order (ML-ready codes; spec 04, partner scorecards). */
export const ASSIGNMENT_DECLINE_REASONS = [
  'out_of_stock',
  'too_far',
  'shop_closed',
  'too_busy',
  'price_mismatch',
  'other',
] as const;
export type AssignmentDeclineReason = (typeof ASSIGNMENT_DECLINE_REASONS)[number];
