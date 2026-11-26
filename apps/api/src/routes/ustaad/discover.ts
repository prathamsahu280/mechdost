/**
 * Ustaad Discover routes (spec 23 § 8 "Discover", § 9.4, SR-37; workstream D2): people ranked by helpfulness (20 a
 * page, cursor only, no total, `discover.profiles_per_day` a day in the repository), popular tags and top posts of the
 * week. Search 60 a minute per member. Distance bands only when `USTAAD_LOCATION_SECRET` is set.
 */
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { discoverUstaadPeople, discoverUstaadTags, ustaadTopPosts } from '@mechdost/db/repo';
import {
  DiscoverPageDto,
  DiscoverQueryDto,
  DiscoverTagsDto,
  TopPostsDto,
} from '@mechdost/shared/ustaad/dto/discover';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { json } from '../service-schemas';
import { onUstaadPaths, ustaadActor } from './social';

const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];

const r = {
  people: createRoute({
    method: 'get',
    path: '/ustaad/discover',
    tags,
    security: sec,
    summary: 'Find mechanics by name, area, work or level; ranked by helpful and best answers, not followers',
    request: { query: DiscoverQueryDto },
    responses: { 200: json(DiscoverPageDto, 'People'), ...errorResponses },
  }),
  tags: createRoute({
    method: 'get',
    path: '/ustaad/discover/tags',
    tags,
    security: sec,
    summary: 'Popular tags in my reach (14 days)',
    responses: { 200: json(DiscoverTagsDto, 'Tags'), ...errorResponses },
  }),
  topPosts: createRoute({
    method: 'get',
    path: '/ustaad/discover/top-posts',
    tags,
    security: sec,
    summary: 'Most saved and liked posts of the week in my city',
    responses: { 200: json(TopPostsDto, 'Posts'), ...errorResponses },
  }),
};

export function ustaadDiscoverRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.use('/ustaad/*', onUstaadPaths(['/ustaad/discover'], requireUstaadMember(deps)));
  app.on(
    'GET',
    ['/ustaad/discover', '/ustaad/discover/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.search, userKey),
  );
  return app
    .openapi(r.people, async (c) =>
      c.json(
        await discoverUstaadPeople(deps.db, ustaadActor(c), c.req.valid('query'), {
          distanceSecret: deps.config.ustaadLocationSecret,
        }),
        200,
      ),
    )
    .openapi(r.tags, async (c) => c.json(await discoverUstaadTags(deps.db, ustaadActor(c)), 200))
    .openapi(r.topPosts, async (c) => c.json(await ustaadTopPosts(deps.db, ustaadActor(c), {}), 200));
}
