/**
 * Numbers of the recommendation feature (spec 11), kept free of Zod and of the catalogue schemas so the database
 * package can import them without loading the DTOs (the API's route modules must create the catalogue schemas only
 * after `@hono/zod-openapi` has extended Zod).
 */
/**
 * Where a suggestion is shown today: `product` and `cart` = "goes well with" (rules, then bought together);
 * `similar` = "Similar options" on the product page (same size/spec and vehicle segment, other brands; phase 3).
 */
export const RECO_SLOTS = ['product', 'cart', 'similar'] as const;
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

/** What a "goes well with" rule suggests (phase 3, 2026-11-26): products of a category, one product, or a workshop fitting link. */
export const RECO_SUGGEST_KINDS = ['category', 'product', 'workshop_fitting'] as const;
export type RecoSuggestKind = (typeof RECO_SUGGEST_KINDS)[number];
/** "Similar options" shows at most this many products (design: "up to 8"). */
export const RECO_SIMILAR_MAX = 8;
/**
 * Where suggestions and the recently viewed list are shown, and which algorithm filled them: the codes of the
 * `reco_impression` / `reco_click` events (spec 12), so every surface and algorithm is measured on its own.
 * `rule` = an admin "goes well with" rule, `copurchase` = bought together, `fitting` = the workshop fitting link,
 * `recent` = the recently viewed list.
 */
export const RECO_SURFACES = ['product', 'cart', 'search_empty', 'account', 'home'] as const;
export type RecoSurface = (typeof RECO_SURFACES)[number];
export const RECO_ALGOS = ['similar', 'rule', 'copurchase', 'fitting', 'recent'] as const;
export type RecoAlgo = (typeof RECO_ALGOS)[number];
