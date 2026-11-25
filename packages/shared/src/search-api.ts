import { z } from 'zod';
import { SEARCH_VOCAB_KINDS, SEARCH_VOCAB_LOCALES } from './search/vocab';

/** DTOs of the smart search (spec 02 "Smart search"): suggestions while typing and the synonym editor. */

export const SUGGEST_KINDS = ['brand', 'range', 'category', 'product'] as const;
export const SUGGEST_QUERY_MIN = 2;
export const SUGGEST_QUERY_MAX = 80;
export const SUGGEST_MAX = 8;

export const SuggestItemSchema = z.object({
  kind: z.enum(SUGGEST_KINDS),
  label: z.string(),
  /** Slug of the brand, range, category or product; the page builds the link from kind + slug. */
  slug: z.string(),
  subtitle: z.string().nullable(),
  photo: z
    .object({ path: z.string(), alt: z.string(), width: z.number().int(), height: z.number().int() })
    .nullable(),
  /** A product found by a size ("90/90-12"): the size that matched, so the list says "Size … available". */
  matchedSize: z.object({ label: z.string(), sku: z.string() }).nullable().default(null),
});
export type SuggestItemDto = z.infer<typeof SuggestItemSchema>;

export const SuggestResponseSchema = z.object({
  items: z.array(SuggestItemSchema).max(SUGGEST_MAX),
  /** The closest brand, category or product name when nothing matched; null otherwise. */
  didYouMean: z.string().nullable(),
});
export type SuggestResponse = z.infer<typeof SuggestResponseSchema>;

export const SearchSynonymSchema = z.object({
  id: z.uuid(),
  term: z.string(),
  locale: z.enum(SEARCH_VOCAB_LOCALES),
  kind: z.enum(SEARCH_VOCAB_KINDS),
  expandsTo: z.array(z.string()),
  active: z.boolean(),
  version: z.number().int(),
});
export type SearchSynonymDto = z.infer<typeof SearchSynonymSchema>;

export const SearchSynonymListSchema = z.object({ items: z.array(SearchSynonymSchema) });
export const SynonymActiveResultSchema = z.object({ version: z.number().int(), active: z.boolean() });

export const NewSearchSynonymSchema = z
  .object({
    term: z.string().trim().min(1).max(60),
    locale: z.enum(SEARCH_VOCAB_LOCALES),
    kind: z.enum(SEARCH_VOCAB_KINDS),
    expandsTo: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  })
  .strict();
export type NewSearchSynonym = z.infer<typeof NewSearchSynonymSchema>;

export const SetSynonymActiveSchema = z
  .object({ version: z.number().int().min(1), active: z.boolean() })
  .strict();
