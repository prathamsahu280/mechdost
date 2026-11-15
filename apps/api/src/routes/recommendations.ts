import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createRecoRule,
  deleteRecoRule,
  listRecoCategories,
  listRecoRules,
  recommendFor,
  updateRecoRule,
} from '@mechdost/db/repo';
import {
  RecoCategoryListDto,
  RecommendationListDto,
  RecoQuerySchema,
  RecoRuleDeleteQuerySchema,
  RecoRuleDto,
  RecoRuleInputSchema,
  RecoRuleListDto,
  RecoRuleUpdateBodySchema,
} from '@mechdost/shared/recommendations';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * "Goes well with" (spec 11, design 2026-11-15 item 4). The public read is the same for everyone with the same URL
 * (city-wide prices, no person), so CDNs and the website's fetch cache may keep it for five minutes. The admin rules
 * need `categories:write` (catalogue manager, super admin); every change is audited in the repository.
 */
export const RECO_RATE: RateRule = { name: 'reco_ip', limit: 240, windowSeconds: 60 };
const RECO_CACHE = 'public, max-age=300, stale-while-revalidate=600';

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const problems = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed elsewhere, or that pair already has a rule'),
  422: json(ErrorSchema, 'The rule is not valid'),
  ...errorResponses,
};
const security = [{ bearerAuth: [] }];

const publicList = createRoute({
  method: 'get',
  path: '/recommendations',
  tags: ['recommendations'],
  summary: 'Suggestions for the products on a page (admin rules first, then bought together), at most four',
  request: { query: RecoQuerySchema },
  responses: {
    200: json(RecommendationListDto, 'Suggestions'),
    404: json(ErrorSchema, 'Unknown city'),
    ...errorResponses,
  },
});
const adminList = createRoute({
  method: 'get',
  path: '/admin/recommendation-rules',
  tags: ['admin'],
  summary: 'Every recommendation rule',
  security,
  responses: { 200: json(RecoRuleListDto, 'Rules'), ...errorResponses },
});
const adminCategories = createRoute({
  method: 'get',
  path: '/admin/recommendation-categories',
  tags: ['admin'],
  summary: 'The categories a rule can use',
  security,
  responses: { 200: json(RecoCategoryListDto, 'Categories'), ...errorResponses },
});
const adminCreate = createRoute({
  method: 'post',
  path: '/admin/recommendation-rules',
  tags: ['admin'],
  summary: 'Add a rule: products of the trigger category suggest products of the other category',
  security,
  request: { body: body(RecoRuleInputSchema) },
  responses: { 201: json(RecoRuleDto, 'Created'), ...problems },
});
const adminUpdate = createRoute({
  method: 'put',
  path: '/admin/recommendation-rules/{id}',
  tags: ['admin'],
  summary: 'Change a rule (send the version you last read)',
  security,
  request: { params: z.object({ id: Id }), body: body(RecoRuleUpdateBodySchema) },
  responses: { 200: json(RecoRuleDto, 'Saved'), ...problems },
});
const adminDelete = createRoute({
  method: 'delete',
  path: '/admin/recommendation-rules/{id}',
  tags: ['admin'],
  summary: 'Delete a rule (send the version you last read as ?version=)',
  security,
  request: { params: z.object({ id: Id }), query: RecoRuleDeleteQuerySchema },
  responses: { 200: json(z.object({ deleted: z.literal(true) }), 'Deleted'), ...problems },
});

export function recommendationRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/recommendations',
    rateLimit(deps.rateLimiter, RECO_RATE, (c) => c.get('clientIp')),
  );
  for (const path of [
    '/admin/recommendation-rules',
    '/admin/recommendation-rules/*',
    '/admin/recommendation-categories',
  ]) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
    app.use(path, requirePermission('categories:write'));
  }

  return app
    .openapi(publicList, async (c) => {
      const q = c.req.valid('query');
      const items = await recommendFor(deps.db, {
        slugs: q.slugs,
        cityCode: q.city ?? deps.config.defaultCityCode,
        locale: q.locale,
      });
      c.header('Cache-Control', RECO_CACHE);
      return c.json({ items }, 200);
    })
    .openapi(adminList, async (c) => c.json({ rules: await listRecoRules(deps.db) }, 200))
    .openapi(adminCategories, async (c) => c.json({ categories: await listRecoCategories(deps.db) }, 200))
    .openapi(adminCreate, async (c) =>
      c.json(
        await createRecoRule(deps.db, { staffUserId: c.get('auth').user.id, input: c.req.valid('json') }),
        201,
      ),
    )
    .openapi(adminUpdate, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await updateRecoRule(deps.db, {
          ruleId: c.req.valid('param').id,
          expectedVersion: b.version,
          staffUserId: c.get('auth').user.id,
          input: b.rule,
        }),
        200,
      );
    })
    .openapi(adminDelete, async (c) => {
      await deleteRecoRule(deps.db, {
        ruleId: c.req.valid('param').id,
        expectedVersion: c.req.valid('query').version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ deleted: true as const }, 200);
    });
}
