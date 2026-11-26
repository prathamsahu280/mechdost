/**
 * Ustaad promotion serving (spec 23 § 8 "Promotions", § 9.5, SR-40–42; workstream D2): one promotion for a slot with
 * the locked Sponsored label and a MechDost internal link, a click that answers the same internal link (no
 * server-side redirect, so nothing here can be an open redirect), and "hide this" with a reason code. Staff create and
 * schedule promotions through G1's `/admin/ustaad/promotions` (`ustaad:promotions`). `answer_parts` is not a served
 * slot (400): no promotions on ask/answer screens.
 */
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { clickUstaadPromotion, hideUstaadPromotion, serveUstaadPromotion } from '@mechdost/db/repo';
import {
  HidePromotionDto,
  PromotionClickResultDto,
  PromotionIdParamDto,
  ServePromotionQueryDto,
  ServePromotionResultDto,
} from '@mechdost/shared/ustaad/dto/promotions';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { rateLimit } from '../../middleware/rate-limit';
import { USTAAD_RATE_RULES } from '../../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';
import { body, json } from '../service-schemas';
import { onUstaadPaths, ustaadActor } from './social';

const sec = [{ bearerAuth: [] }];
const tags = ['ustaad'];

const r = {
  serve: createRoute({
    method: 'get',
    path: '/ustaad/promotions',
    tags,
    security: sec,
    summary: 'One MechDost promotion for a slot (or null), labelled Sponsored, daily cap per member',
    request: { query: ServePromotionQueryDto },
    responses: { 200: json(ServePromotionResultDto, 'Promotion'), ...errorResponses },
  }),
  click: createRoute({
    method: 'post',
    path: '/ustaad/promotions/{id}/click',
    tags,
    security: sec,
    summary: 'Record a click; answers the internal link to open',
    request: { params: PromotionIdParamDto },
    responses: { 200: json(PromotionClickResultDto, 'Link'), ...errorResponses },
  }),
  hide: createRoute({
    method: 'post',
    path: '/ustaad/promotions/{id}/hide',
    tags,
    security: sec,
    summary: 'Hide a promotion for me, with a reason code',
    request: { params: PromotionIdParamDto, body: body(HidePromotionDto) },
    responses: { 200: json(z.object({ hidden: z.literal(true) }), 'Hidden'), ...errorResponses },
  }),
};

export function ustaadPromotionRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const userKey = (c: Context<AppEnv>) => c.get('auth').user.id;
  app.use('/ustaad/*', onUstaadPaths(['/ustaad/promotions'], requireUstaadMember(deps)));
  app.on(
    ['GET', 'POST'],
    ['/ustaad/promotions', '/ustaad/promotions/*'],
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.memberReads, userKey),
  );
  return app
    .openapi(r.serve, async (c) =>
      c.json(
        { promotion: await serveUstaadPromotion(deps.db, ustaadActor(c), c.req.valid('query').slot) },
        200,
      ),
    )
    .openapi(r.click, async (c) =>
      c.json(await clickUstaadPromotion(deps.db, ustaadActor(c), c.req.valid('param').id), 200),
    )
    .openapi(r.hide, async (c) =>
      c.json(
        await hideUstaadPromotion(
          deps.db,
          ustaadActor(c),
          c.req.valid('param').id,
          c.req.valid('json').reason,
        ),
        200,
      ),
    );
}
