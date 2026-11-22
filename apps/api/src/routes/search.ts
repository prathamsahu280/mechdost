import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { didYouMeanCatalogue, suggestCatalogue, type RangeSuggester } from '@mechdost/db/repo';
import {
  SUGGEST_QUERY_MAX,
  SUGGEST_QUERY_MIN,
  SuggestResponseSchema,
  type SuggestResponse,
} from '@mechdost/shared/search-api';
import { rateLimit } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import { TtlCache } from '../ttl-cache';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * Search suggestions while typing (spec 02 "Smart search"): up to 8 brands, ranges, categories and products for the
 * words typed, with "did you mean" when nothing matched. Public; per-IP limit (a keystroke burst is debounced by
 * the browser, so 120 a minute is generous); one answer per (city, language, words) cached 60 s per instance and by
 * the CDN. Same understanding and ranking as the listing (it calls the listing).
 */
export const SUGGEST_RATE: RateRule = { name: 'search_suggest_ip', limit: 120, windowSeconds: 60 };
const SUGGEST_TTL_MS = 60_000;
const SUGGEST_CACHE = 'public, max-age=60, stale-while-revalidate=120';

/**
 * Seam for builder A's `product_ranges` (design 2026-11-22 item 1): the coordinator replaces this with the
 * range suggester from `@mechdost/db/repo`. Until then no ranges are suggested.
 */
const rangeSuggester = undefined as RangeSuggester | undefined;

const suggest = createRoute({
  method: 'get',
  path: '/search/suggest',
  tags: ['catalogue'],
  summary:
    'Up to 8 suggestions (brands, ranges, categories, products) for the words typed, with a "did you mean"',
  request: {
    query: z.object({
      q: z.string().trim().max(SUGGEST_QUERY_MAX),
      locale: z.enum(['en', 'hi']).default('en'),
      city: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    }),
  },
  responses: {
    200: { description: 'Suggestions', content: { 'application/json': { schema: SuggestResponseSchema } } },
    ...errorResponses,
  },
});

export function searchRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const cache = new TtlCache<SuggestResponse>(SUGGEST_TTL_MS, 500);
  app.use(
    '/search/suggest',
    rateLimit(deps.rateLimiter, SUGGEST_RATE, (c) => c.get('clientIp')),
  );
  return app.openapi(suggest, async (c) => {
    const { q, locale, city } = c.req.valid('query');
    const cityCode = city ?? deps.config.defaultCityCode;
    c.header('Cache-Control', SUGGEST_CACHE);
    if (Array.from(q).length < SUGGEST_QUERY_MIN) return c.json({ items: [], didYouMean: null }, 200);
    const key = `${cityCode}|${locale}|${q.toLowerCase()}`;
    const body = await cache.getOrLoad(key, async () => {
      const items = await suggestCatalogue(deps.db, {
        q,
        locale,
        cityCode,
        ...(rangeSuggester ? { ranges: rangeSuggester } : {}),
      });
      return { items, didYouMean: items.length === 0 ? await didYouMeanCatalogue(deps.db, q) : null };
    });
    return c.json(body, 200);
  });
}
