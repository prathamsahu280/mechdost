/**
 * Business application code lists (audience entry design 2026-11-22, item 3). No Zod here: the browser form
 * imports these directly; the schemas that use them are in `business-applications.ts`.
 * Codes, never free text (hard rule 16): the label of each code is in the locale files (`business` namespace).
 */
export const BUSINESS_APPLICATION_KINDS = ['trade', 'fleet'] as const;
export type BusinessApplicationKind = (typeof BUSINESS_APPLICATION_KINDS)[number];

export const TRADE_BUSINESS_TYPES = ['mechanic', 'garage', 'parts_retailer', 'other'] as const;
export type TradeBusinessType = (typeof TRADE_BUSINESS_TYPES)[number];

/** Rough monthly spend on parts, in rupees. */
export const TRADE_SPEND_BANDS = ['under_25k', '25k_to_1l', '1l_to_5l', 'over_5l'] as const;
export type TradeSpendBand = (typeof TRADE_SPEND_BANDS)[number];

/** What a fleet wants from MechDost (the "Uptime" programme, design R1). */
export const FLEET_NEEDS = [
  'scheduled_maintenance',
  'priority_slots',
  'pickup_drop',
  'monthly_billing',
  'bulk_parts',
  'tyres_batteries',
] as const;
export type FleetNeed = (typeof FLEET_NEEDS)[number];

/** Why staff took a trade account's verified status back (history is kept; the applicant is not shown the code). */
export const TRADE_REVOKE_REASONS = [
  'misuse',
  'not_a_trade_business',
  'documents_invalid',
  'inactive',
  'requested_by_user',
  'other',
] as const;
export type TradeRevokeReason = (typeof TRADE_REVOKE_REASONS)[number];

/** What a signed-in customer's trade status is: `pending` = an application is waiting for staff. */
export const TRADE_STATUSES = ['none', 'pending', 'verified', 'revoked'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

/** Most vehicles of one type on a fleet enquiry. */
export const FLEET_SIZE_MAX = 100_000;
