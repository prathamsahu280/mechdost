import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  cityScopeFrom,
  decideBusinessApplication,
  getBusinessApplication,
  getTradeProfile,
  listBusinessApplications,
  setTradeAccountStanding,
  submitFleetApplication,
  submitTradeApplication,
} from '@mechdost/db/repo';
import {
  BusinessApplicationDetail,
  BusinessApplicationPage,
  BusinessApplicationReceived,
  BusinessDecisionBody,
  TradeProfile,
  TradeStandingBody,
} from '@mechdost/shared/business-api';
import { FleetApplicationSchema, TradeApplicationSchema } from '@mechdost/shared/business-applications';
import { BUSINESS_APPLICATION_KINDS } from '@mechdost/shared/business-codes';
import { BUSINESS_APPLICATION_STATES } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import {
  authenticate,
  requireCustomerVerified,
  requirePermission,
  requireVerified,
} from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { decodeCursor, human, nextCursorOf, PageQuery } from './partner-onboarding';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Trade account applications and fleet enquiries (audience entry design 2026-11-22, item 3):
 * - signed in: `POST /me/trade-application`, `POST /me/fleet-application`, `GET /me/trade`;
 * - public: `POST /business-applications/fleet` (Turnstile, per-IP and per-phone limits; a lead);
 * - staff: the queue, one application, the decision and the trade account's standing (revoke with a reason).
 */
const FLEET_PER_IP: RateRule = { name: 'business_fleet_ip', limit: 5, windowSeconds: 3600 };
export const FLEET_PER_PHONE: RateRule = {
  name: 'business_fleet_phone',
  limit: 3,
  windowSeconds: 86_400,
  failClosed: true,
};
const APPLY_PER_USER: RateRule = { name: 'business_apply_user', limit: 5, windowSeconds: 3600 };
const phoneKey = (phone: string) => createHash('sha256').update(`business_fleet:${phone}`).digest('hex');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});
const conflict = { 404: json(ErrorSchema, 'Not found'), 409: json(ErrorSchema, 'Changed meanwhile') };
const Loose = z.record(z.string(), z.unknown());
const Code = z.string().regex(/^BA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/);

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(400, 'APPLICATION_INVALID', 'Check the highlighted fields', {
      fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))],
    });
  return parsed.data;
}

const TradeBody = z.object({ application: Loose }).strict().openapi('TradeApplicationSubmit');
const FleetBody = z.object({ application: Loose }).strict().openapi('FleetApplicationSubmit');
const FleetPublicBody = z
  .object({ application: Loose, turnstileToken: z.string().min(1).max(2048) })
  .strict()
  .openapi('FleetApplicationPublicSubmit');

/** Signed-in routes: own trade application, own fleet enquiry, own trade status. */
export function businessAccountRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const path of ['/me/trade-application', '/me/fleet-application', '/me/trade']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  for (const path of ['/me/trade-application', '/me/fleet-application']) {
    app.use(path, requireCustomerVerified(deps));
    app.use(
      path,
      rateLimit(deps.rateLimiter, APPLY_PER_USER, (c) => c.get('auth').user.id),
    );
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/trade-application',
      tags: ['business'],
      summary: 'Apply for a trade account (signed in: the account is what gets verified)',
      security: [{ bearerAuth: [] }],
      request: body(TradeBody),
      responses: { 201: json(BusinessApplicationReceived, 'Received'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const application = parse(TradeApplicationSchema, c.req.valid('json').application);
      const r = await submitTradeApplication(deps.db, { userId: c.get('auth').user.id, application });
      return c.json(r, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/me/fleet-application',
      tags: ['business'],
      summary: 'Send a fleet enquiry from a signed-in account',
      security: [{ bearerAuth: [] }],
      request: body(FleetBody),
      responses: { 201: json(BusinessApplicationReceived, 'Received'), ...errorResponses },
    }),
    async (c) => {
      const application = parse(FleetApplicationSchema, c.req.valid('json').application);
      const r = await submitFleetApplication(deps.db, { userId: c.get('auth').user.id, application });
      return c.json(r, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/me/trade',
      tags: ['business'],
      summary: 'Your trade status, and while verified the business name and GSTIN (checkout pre-fill)',
      security: [{ bearerAuth: [] }],
      responses: { 200: json(TradeProfile, 'Trade status'), ...errorResponses },
    }),
    async (c) => c.json(await getTradeProfile(deps.db, c.get('auth').user.id), 200),
  );
  return app;
}

/** Public fleet enquiry (a lead; no account effect). */
export function businessPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/business-applications/fleet',
    rateLimit(deps.rateLimiter, FLEET_PER_IP, (c) => c.get('clientIp')),
  );
  app.openapi(
    createRoute({
      method: 'post',
      path: '/business-applications/fleet',
      tags: ['business'],
      summary: 'Send a fleet enquiry (public; Turnstile)',
      request: body(FleetPublicBody),
      responses: { 201: json(BusinessApplicationReceived, 'Received'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const application = parse(FleetApplicationSchema, b.application);
      await human(deps, c, b.turnstileToken);
      await enforceRate(c, deps.rateLimiter, FLEET_PER_PHONE, phoneKey(application.phone), 1);
      const r = await submitFleetApplication(deps.db, { userId: null, application });
      return c.json(r, 201);
    },
  );
  return app;
}

/** Staff: the queue, one application, decisions and the trade account's standing. */
export function businessAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/business-applications/*';
  for (const path of ['/admin/business-applications', prefix]) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
    app.use(path, requirePermission('applications:review'));
  }
  // Deciding needs the approval permission, like seller applications.
  app.on('POST', '/admin/business-applications/:code/decide', requirePermission('partners:approve'));
  app.on('POST', '/admin/business-applications/:code/trade-standing', requirePermission('partners:approve'));
  const scope = (c: Context<AppEnv>, permission: string) => cityScopeFrom(c.get('auth').grants, permission);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/business-applications',
      tags: ['admin'],
      summary: 'Trade and fleet applications in your cities, newest first',
      security: [{ bearerAuth: [] }],
      request: {
        query: z.object({
          status: z.enum(BUSINESS_APPLICATION_STATES).optional(),
          kind: z.enum(BUSINESS_APPLICATION_KINDS).optional(),
          ...PageQuery,
        }),
      },
      responses: { 200: json(BusinessApplicationPage, 'Applications'), ...errorResponses },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const r = await listBusinessApplications(deps.db, scope(c, 'applications:review'), {
        status: q.status ?? null,
        kind: q.kind ?? null,
        before: decodeCursor(q.cursor),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return c.json(
        {
          items: r.items.map(({ id: _id, createdAt, ...rest }) => ({
            ...rest,
            createdAt: createdAt.toISOString(),
          })),
          nextCursor: nextCursorOf(r),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/business-applications/{code}',
      tags: ['admin'],
      summary: 'One application with its trade account',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ code: Code }) },
      responses: { 200: json(BusinessApplicationDetail, 'Application'), ...conflict, ...errorResponses },
    }),
    async (c) =>
      c.json(
        await getBusinessApplication(deps.db, scope(c, 'applications:review'), c.req.valid('param').code),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/business-applications/{code}/decide',
      tags: ['admin'],
      summary:
        'Move an application: review, approve (verifies the trade account), reject with a reason, close a lead',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ code: Code }), ...body(BusinessDecisionBody) },
      responses: { 200: json(z.object({ ok: z.literal(true) }), 'Decided'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      await decideBusinessApplication(deps.db, {
        scope: scope(c, 'partners:approve'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        decision: b.decision,
        reasonCode: b.reasonCode ?? null,
        note: b.note ?? null,
      });
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/business-applications/{code}/trade-standing',
      tags: ['admin'],
      summary: 'Revoke a trade account with a reason code, or restore it',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ code: Code }), ...body(TradeStandingBody) },
      responses: { 200: json(z.object({ ok: z.literal(true) }), 'Changed'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      await setTradeAccountStanding(deps.db, {
        scope: scope(c, 'partners:approve'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        to: b.to,
        reasonCode: b.reasonCode ?? null,
      });
      return c.json({ ok: true as const }, 200);
    },
  );
  return app;
}
