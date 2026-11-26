/**
 * Recommendations (spec 11, design 2026-11-15 item 4): "goes well with" by admin rules per category, then by what
 * customers bought together in delivered orders (a nightly count, never personal data). Zod DTOs for the API and the
 * web; the numbers live in the Zod-free `./recommendation-limits` (re-exported here).
 */
import { z } from 'zod';
import { CatalogueCardSchema } from './catalogue';
import { DEVANAGARI_RE } from './geo';
import {
  RECO_ALGOS,
  RECO_LABEL_MAX,
  RECO_PRIORITY_MAX,
  RECO_SLOTS,
  RECO_SOURCES_MAX,
  RECO_SUGGEST_KINDS,
  RECO_SURFACES,
} from './recommendation-limits';

export * from './recommendation-limits';

/**
 * A rule: one trigger (a category, which also covers its sub-categories, or one product) and one suggestion
 * (`suggestKind`: products of a category, one product, or the workshop fitting link, which needs no id). The
 * original category-to-category shape (no `suggestKind`) still validates (phase 3, 2026-11-26).
 */
export const RecoRuleInputSchema = z
  .object({
    triggerCategoryId: z.uuid().optional(),
    triggerProductId: z.uuid().optional(),
    suggestKind: z.enum(RECO_SUGGEST_KINDS).default('category'),
    suggestCategoryId: z.uuid().optional(),
    suggestProductId: z.uuid().optional(),
    /** The reason shown to the customer, in both languages (hard rule 10): "Goes well with your oil". */
    label: z.string().trim().min(2).max(RECO_LABEL_MAX),
    labelHi: z
      .string()
      .trim()
      .min(2)
      .max(RECO_LABEL_MAX)
      .refine((v) => DEVANAGARI_RE.test(v), 'Write the Hindi text in Devanagari'),
    /** 1 is shown first. */
    priority: z.number().int().min(1).max(RECO_PRIORITY_MAX),
    active: z.boolean(),
  })
  .strict()
  .refine((v) => (v.triggerCategoryId === undefined) !== (v.triggerProductId === undefined), {
    path: ['triggerCategoryId'],
    message: 'Choose one category or one product that triggers the rule',
  })
  .refine(
    (v) =>
      v.suggestKind === 'category'
        ? v.suggestCategoryId !== undefined && v.suggestProductId === undefined
        : v.suggestKind === 'product'
          ? v.suggestProductId !== undefined && v.suggestCategoryId === undefined
          : v.suggestCategoryId === undefined && v.suggestProductId === undefined,
    { path: ['suggestKind'], message: 'The suggestion does not match its kind' },
  )
  .refine(
    (v) =>
      (v.triggerCategoryId === undefined || v.triggerCategoryId !== v.suggestCategoryId) &&
      (v.triggerProductId === undefined || v.triggerProductId !== v.suggestProductId),
    { path: ['suggestCategoryId'], message: 'A rule cannot suggest what triggers it' },
  );
export type RecoRuleInput = z.infer<typeof RecoRuleInputSchema>;

const CategoryRef = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
});

/** A product named by a rule (trigger or suggestion). */
const ProductRef = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
});

export const RecoRuleDto = z.object({
  id: z.uuid(),
  /** Exactly one of the two triggers is set. */
  triggerCategory: CategoryRef.nullable(),
  triggerProduct: ProductRef.nullable(),
  suggestKind: z.enum(RECO_SUGGEST_KINDS),
  /** Set for `category` / `product` suggestions; both null for the workshop fitting link. */
  suggestCategory: CategoryRef.nullable(),
  suggestProduct: ProductRef.nullable(),
  label: z.string(),
  labelHi: z.string(),
  priority: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type RecoRule = z.infer<typeof RecoRuleDto>;

export const RecoRuleListDto = z.object({ rules: z.array(RecoRuleDto) });

export const RecoRuleUpdateBodySchema = z
  .object({ version: z.number().int().min(1), rule: RecoRuleInputSchema })
  .strict();

export const RecoRuleDeleteQuerySchema = z.object({ version: z.coerce.number().int().min(1) });

/** The category choices of the rule form (every visible category, flat). */
export const RecoCategoryListDto = z.object({ categories: z.array(CategoryRef) });

/** Product choices of the rule form: a name search over visible products (at most 20). */
export const RecoProductSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(60) });
export const RecoProductListDto = z.object({ products: z.array(ProductRef) });

export const RecoReasonSchema = z.object({
  /** `similar` = same size/spec and vehicle segment, another brand (the `similar` slot). */
  source: z.enum(['rule', 'copurchase', 'similar']),
  /** The rule's label in the asked language (rule), or null (co-purchase: the page words it from `count`). */
  label: z.string().nullable(),
  /** In how many orders the two were bought together (co-purchase), else null. */
  count: z.number().int().nullable(),
  /** The size both products share (similar), e.g. "185/65 R15"; else absent or null. */
  size: z.string().nullable().optional(),
});

export const RecommendationDto = z.object({ card: CatalogueCardSchema, reason: RecoReasonSchema });
export type Recommendation = z.infer<typeof RecommendationDto>;
/**
 * `fitting`: an active "workshop fitting" rule matched the page (product slot only); the page shows one link to the
 * workshop finder with this label (asked language). Absent from older APIs.
 */
export const RecommendationListDto = z.object({
  items: z.array(RecommendationDto),
  fitting: z.object({ label: z.string() }).nullable().optional(),
});
export type RecommendationList = z.infer<typeof RecommendationListDto>;

/** Product slugs the page is about (a product page: one; a cart: its lines). */
export const RecoQuerySchema = z.object({
  slot: z.enum(RECO_SLOTS),
  slugs: z
    .string()
    .max(RECO_SOURCES_MAX * 80)
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(
      z
        .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,78}$/))
        .min(1)
        .max(RECO_SOURCES_MAX),
    ),
  city: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  locale: z.enum(['en', 'hi']).default('en'),
});

/** Staff analytics: the suggestion funnel per surface and algorithm over the last `days` (spec 12 "Suggestions"). */
export const RecoFunnelQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
export const RecoFunnelDto = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(
    z.object({
      surface: z.enum(RECO_SURFACES),
      algo: z.enum(RECO_ALGOS),
      impressions: z.number().int(),
      shown: z.number().int(),
      clicks: z.number().int(),
      adds: z.number().int(),
      orders: z.number().int(),
    }),
  ),
});
export type RecoFunnel = z.infer<typeof RecoFunnelDto>;
