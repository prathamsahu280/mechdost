import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptRsaOffer,
  billRsa,
  confirmRsaArrival,
  declineRsaOffer,
  getRsaOptIns,
  listWorkshopRsa,
  markRsaBalanceCash,
  markRsaEnRoute,
  saveRsaOptIn,
  startRsaWork,
  workshopIdsFrom,
} from '@mechdost/db/repo';
import {
  RsaArrivalBody,
  RsaBillBody,
  RsaCodeParam,
  RsaDeclineBody,
  RsaVersionBody,
  RsaWorkshopOptInBody,
} from '@mechdost/shared/rsa-api';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

/**
 * The workshop's roadside side (spec 22, spec 07): opt in (radius, vehicle types, problem types, towing), answer offers
 * inside the timer, go on the way, enter the customer's arrival code (5 tries, rate limited), start work, enter the bill
 * and mark a cash balance. Scoped to the workshops in the caller's `roadside:respond` grants: any other id is 404.
 */
export const RSA_ARRIVAL_RATE: RateRule = { name: 'rsa_arrival_user', limit: 20, windowSeconds: 600 };

const Anything = z.any();
const responses = { 200: json(Anything, 'OK'), ...conflict, ...errorResponses };
const meta = { tags: ['roadside-workshop'], security: [{ bearerAuth: [] }] };
const code = z.object({ code: RsaCodeParam.shape.code });

const overview = createRoute({
  ...meta,
  method: 'get',
  path: '/workshop/roadside',
  summary: 'Offers, jobs and the opt-in of your workshops',
  responses,
});
const optIn = createRoute({
  ...meta,
  method: 'put',
  path: '/workshop/roadside/opt-in/{workshopId}',
  summary: 'Save the roadside opt-in of one workshop',
  request: {
    params: z.object({ workshopId: z.uuid() }),
    body: body(RsaWorkshopOptInBody.openapi('RsaOptIn')),
  },
  responses,
});
const accept = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/accept',
  summary: 'Accept the offer',
  request: { params: code },
  responses,
});
const decline = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/decline',
  summary: 'Decline the offer (back to MechDost)',
  request: { params: code, body: body(RsaDeclineBody.openapi('RsaDecline')) },
  responses,
});
const enRoute = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/en-route',
  summary: 'On my way',
  request: { params: code, body: body(RsaVersionBody.openapi('RsaVersionW')) },
  responses,
});
const arrive = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/arrive',
  summary: "Enter the customer's arrival code",
  request: {
    params: code,
    body: body(
      RsaArrivalBody.extend({ expectedVersion: z.number().int().min(1) })
        .strict()
        .openapi('RsaArrive'),
    ),
  },
  responses,
});
const start = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/start',
  summary: 'Start the work',
  request: { params: code, body: body(RsaVersionBody.openapi('RsaVersionS')) },
  responses,
});
const bill = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/bill',
  summary: 'Enter the bill lines',
  request: { params: code, body: body(RsaBillBody.openapi('RsaBill')) },
  responses,
});
const cash = createRoute({
  ...meta,
  method: 'post',
  path: '/workshop/roadside/requests/{code}/cash',
  summary: 'The customer paid the balance in cash',
  request: { params: code, body: body(RsaVersionBody.openapi('RsaVersionC')) },
  responses,
});

export function workshopRoadsideRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/workshop/roadside', authenticate(deps, cache));
  app.use('/workshop/roadside/*', authenticate(deps, cache));
  for (const path of ['/workshop/roadside', '/workshop/roadside/*']) {
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
    app.use(path, requirePermission('roadside:respond'));
  }
  app.on(
    'POST',
    '/workshop/roadside/requests/:code/arrive',
    rateLimit(deps.rateLimiter, RSA_ARRIVAL_RATE, (c) => c.get('auth').user.id),
  );
  const ids = (c: Context<AppEnv>) => workshopIdsFrom(c.get('auth').grants, 'roadside:respond');
  const who = (c: Context<AppEnv>) => c.get('auth').user.id;
  const step = (c: Context<AppEnv>, codeValue: string, expectedVersion: number) => ({
    workshopIds: ids(c),
    code: codeValue,
    expectedVersion,
    staffUserId: who(c),
  });

  return app
    .openapi(overview, async (c) => {
      const workshopIds = ids(c);
      const [list, optIns] = await Promise.all([
        listWorkshopRsa(deps.db, workshopIds),
        getRsaOptIns(deps.db, workshopIds),
      ]);
      return c.json({ ...list, optIns }, 200);
    })
    .openapi(optIn, async (c) => {
      const b = c.req.valid('json');
      const out = await saveRsaOptIn(deps.db, {
        workshopIds: ids(c),
        workshopId: c.req.valid('param').workshopId,
        staffUserId: who(c),
        optIn: b,
      });
      return c.json(out, 200);
    })
    .openapi(accept, async (c) => {
      const out = await acceptRsaOffer(deps.db, {
        workshopIds: ids(c),
        code: c.req.valid('param').code,
        staffUserId: who(c),
        keyring: deps.keyring ?? null,
      });
      return c.json(out, 200);
    })
    .openapi(decline, async (c) => {
      await declineRsaOffer(deps.db, {
        workshopIds: ids(c),
        code: c.req.valid('param').code,
        staffUserId: who(c),
        reasonCode: c.req.valid('json').reasonCode,
      });
      return c.json({ ok: true }, 200);
    })
    .openapi(enRoute, async (c) =>
      c.json(
        await markRsaEnRoute(
          deps.db,
          step(c, c.req.valid('param').code, c.req.valid('json').expectedVersion),
        ),
        200,
      ),
    )
    .openapi(arrive, async (c) => {
      const b = c.req.valid('json');
      const out = await confirmRsaArrival(deps.db, {
        ...step(c, c.req.valid('param').code, b.expectedVersion),
        arrivalCode: b.arrivalCode,
        keyring: deps.keyring ?? null,
      });
      if (out.ok) return c.json(out, 200);
      if (out.reason === 'locked')
        throw new ApiError(
          423,
          'ARRIVAL_CODE_LOCKED',
          'Too many wrong tries; ask MechDost support to continue',
        );
      throw new ApiError(422, 'ARRIVAL_CODE_WRONG', 'That code is not right', {
        attemptsLeft: out.attemptsLeft,
      });
    })
    .openapi(start, async (c) =>
      c.json(
        await startRsaWork(deps.db, step(c, c.req.valid('param').code, c.req.valid('json').expectedVersion)),
        200,
      ),
    )
    .openapi(bill, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await billRsa(deps.db, { ...step(c, c.req.valid('param').code, b.expectedVersion), lines: b.lines }),
        200,
      );
    })
    .openapi(cash, async (c) => {
      await markRsaBalanceCash(
        deps.db,
        step(c, c.req.valid('param').code, c.req.valid('json').expectedVersion),
      );
      return c.json({ ok: true }, 200);
    });
}
