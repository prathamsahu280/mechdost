import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Permission } from '@mechdost/shared/rbac';
import {
  cancelRsaByStaff,
  cityScopeFrom,
  getRsaSettings,
  listRsaQueue,
  overrideRsaArrival,
  saveRsaSettings,
  sendRsaOffer,
  suggestRsaResponders,
  withdrawRsaOffer,
} from '@mechdost/db/repo';
import {
  RsaCancelBody,
  RsaCodeParam,
  RsaSendOfferBody,
  RsaSettingsInput,
  RsaVersionBody,
  RsaViewParams,
} from '@mechdost/shared/rsa-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

/**
 * Admin roadside (spec 22, spec 08): the "Needs dispatch" queue, ranked suggestions, offers, cancel (only while nobody
 * has accepted; refunds the advance through the refund queue), the audited arrival override and the per-city settings.
 * Every call is scoped to the staff member's cities (a request or city outside them is 404). Verified staff only.
 */
const Anything = z.any();
const code = z.object({ code: RsaCodeParam.shape.code });
const responses = { 200: json(Anything, 'OK'), ...conflict, ...errorResponses };
const meta = { tags: ['roadside-admin'], security: [{ bearerAuth: [] }] };
const City = z.object({ city: z.string().regex(/^[A-Z]{3}$/) });
const Override = z
  .object({ reason: z.string().trim().min(5).max(200), expectedVersion: z.number().int().min(1) })
  .strict()
  .openapi('RsaArrivalOverride');

const queue = createRoute({
  ...meta,
  method: 'get',
  path: '/admin/roadside/queue',
  summary: 'Roadside requests by view',
  request: { query: RsaViewParams },
  responses,
});
const suggestions = createRoute({
  ...meta,
  method: 'get',
  path: '/admin/roadside/requests/{code}/suggestions',
  summary: 'Ranked workshops for a request',
  request: { params: code },
  responses,
});
const offer = createRoute({
  ...meta,
  method: 'post',
  path: '/admin/roadside/requests/{code}/offer',
  summary: 'Send the request to one workshop',
  request: { params: code, body: body(RsaSendOfferBody.openapi('RsaSendOffer')) },
  responses,
});
const withdraw = createRoute({
  ...meta,
  method: 'post',
  path: '/admin/roadside/requests/{code}/withdraw',
  summary: 'Take the request back from a workshop',
  request: { params: code, body: body(RsaVersionBody.openapi('RsaVersion')) },
  responses,
});
const cancel = createRoute({
  ...meta,
  method: 'post',
  path: '/admin/roadside/requests/{code}/cancel',
  summary: 'Cancel a request nobody accepted',
  request: { params: code, body: body(RsaCancelBody.openapi('RsaCancel')) },
  responses,
});
const override = createRoute({
  ...meta,
  method: 'post',
  path: '/admin/roadside/requests/{code}/arrival-override',
  summary: 'Let a job continue without the arrival code',
  request: { params: code, body: body(Override) },
  responses,
});
const getSettings = createRoute({
  ...meta,
  method: 'get',
  path: '/admin/roadside/settings',
  summary: 'The roadside settings of a city',
  request: { query: City },
  responses,
});
const putSettings = createRoute({
  ...meta,
  method: 'put',
  path: '/admin/roadside/settings',
  summary: 'Save the roadside settings of a city (audited)',
  request: { query: City, body: body(RsaSettingsInput.openapi('RsaSettingsInput')) },
  responses,
});

export function adminRoadsideRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/admin/roadside/*', authenticate(deps, cache));
  app.use(
    '/admin/roadside/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/roadside/*', requireVerified);
  app.use('/admin/roadside/*', requirePermission('roadside:read'));
  app.on('POST', '/admin/roadside/requests/*', (c, next) =>
    c.req.path.endsWith('/cancel')
      ? requirePermission('roadside:cancel')(c, next)
      : requirePermission('roadside:dispatch')(c, next),
  );
  app.on('PUT', '/admin/roadside/settings', requirePermission('roadside:settings'));
  app.on('GET', '/admin/roadside/settings', requirePermission('roadside:settings'));
  const scope = (c: Context<AppEnv>, p: Permission) => cityScopeFrom(c.get('auth').grants, p);

  return app
    .openapi(queue, async (c) =>
      c.json(await listRsaQueue(deps.db, scope(c, 'roadside:read'), c.req.valid('query').view), 200),
    )
    .openapi(suggestions, async (c) =>
      c.json(
        await suggestRsaResponders(deps.db, scope(c, 'roadside:dispatch'), c.req.valid('param').code),
        200,
      ),
    )
    .openapi(offer, async (c) => {
      const b = c.req.valid('json');
      const out = await sendRsaOffer(deps.db, {
        scope: scope(c, 'roadside:dispatch'),
        code: c.req.valid('param').code,
        workshopId: b.workshopId,
        expectedVersion: b.expectedVersion,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(out, 200);
    })
    .openapi(withdraw, async (c) => {
      await withdrawRsaOffer(deps.db, {
        scope: scope(c, 'roadside:dispatch'),
        code: c.req.valid('param').code,
        expectedVersion: c.req.valid('json').expectedVersion,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true }, 200);
    })
    .openapi(cancel, async (c) => {
      const b = c.req.valid('json');
      const out = await cancelRsaByStaff(deps.db, {
        scope: scope(c, 'roadside:cancel'),
        code: c.req.valid('param').code,
        reasonCode: b.reasonCode,
        ...(b.note ? { note: b.note } : {}),
        expectedVersion: b.expectedVersion,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ ok: true, refundRequested: out.refundId !== null }, 200);
    })
    .openapi(override, async (c) => {
      const b = c.req.valid('json');
      const out = await overrideRsaArrival(deps.db, {
        scope: scope(c, 'roadside:dispatch'),
        code: c.req.valid('param').code,
        reason: b.reason,
        expectedVersion: b.expectedVersion,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(out, 200);
    })
    .openapi(getSettings, async (c) => {
      const cityId = await scopedCity(deps, c, c.req.valid('query').city, 'roadside:settings');
      return c.json(cityId ? await getRsaSettings(deps.db, cityId) : null, 200);
    })
    .openapi(putSettings, async (c) => {
      const cityId = await scopedCity(deps, c, c.req.valid('query').city, 'roadside:settings');
      if (!cityId) return c.json(null, 200);
      const saved = await saveRsaSettings(deps.db, {
        cityId,
        staffUserId: c.get('auth').user.id,
        settings: c.req.valid('json'),
      });
      return c.json(saved, 200);
    });
}
