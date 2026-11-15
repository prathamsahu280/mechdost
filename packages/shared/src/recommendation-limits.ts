/**
 * Numbers of the recommendation feature (spec 11), kept free of Zod and of the catalogue schemas so the database
 * package can import them without loading the DTOs (the API's route modules must create the catalogue schemas only
 * after `@hono/zod-openapi` has extended Zod).
 */
/** Where a suggestion is shown today. */
export const RECO_SLOTS = ['product', 'cart'] as const;
export type RecoSlot = (typeof RECO_SLOTS)[number];
/** At most this many suggestions per slot (spec 11). */
export const RECO_MAX = 4;
/** A pair needs this many different orders before it counts (spec 11 "min support 3"). */
export const RECO_MIN_SUPPORT = 3;
/** Pairs kept per product (the strongest), so the table stays small. */
export const RECO_PAIRS_PER_PRODUCT = 20;
/** Products read per rule when ranking (the catalogue then drops the ones nobody can buy). */
export const RECO_RULE_CANDIDATES = 12;
export const RECO_LABEL_MAX = 80;
export const RECO_PRIORITY_MAX = 100;
export const RECO_RULES_MAX = 200;
/** The most products a request may ask about (a cart holds at most this many lines). */
export const RECO_SOURCES_MAX = 20;
