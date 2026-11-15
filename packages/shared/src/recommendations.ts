/**
 * Recommendations (spec 11, design 2026-11-15 item 4): "goes well with" by admin rules per category, then by what
 * customers bought together in delivered orders (a nightly count, never personal data). Zod DTOs for the API and the
 * web; the numbers live in the Zod-free `./recommendation-limits` (re-exported here).
 */
import { z } from 'zod';
import { CatalogueCardSchema } from './catalogue';
import { DEVANAGARI_RE } from './geo';
import { RECO_LABEL_MAX, RECO_PRIORITY_MAX, RECO_SLOTS, RECO_SOURCES_MAX } from './recommendation-limits';

export * from './recommendation-limits';

export const RecoRuleInputSchema = z
  .object({
    triggerCategoryId: z.uuid(),
    suggestCategoryId: z.uuid(),
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
  .refine((v) => v.triggerCategoryId !== v.suggestCategoryId, {
    path: ['suggestCategoryId'],
    message: 'A category cannot suggest itself',
  });
export type RecoRuleInput = z.infer<typeof RecoRuleInputSchema>;

const CategoryRef = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
});

export const RecoRuleDto = z.object({
  id: z.uuid(),
  triggerCategory: CategoryRef,
  suggestCategory: CategoryRef,
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

export const RecoReasonSchema = z.object({
  source: z.enum(['rule', 'copurchase']),
  /** The rule's label in the asked language (rule), or null (co-purchase: the page words it from `count`). */
  label: z.string().nullable(),
  /** In how many orders the two were bought together (co-purchase), else null. */
  count: z.number().int().nullable(),
});

export const RecommendationDto = z.object({ card: CatalogueCardSchema, reason: RecoReasonSchema });
export type Recommendation = z.infer<typeof RecommendationDto>;
export const RecommendationListDto = z.object({ items: z.array(RecommendationDto) });
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
