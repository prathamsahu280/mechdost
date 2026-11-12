import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptAgreement,
  approveApplication,
  cityScopeFrom,
  createInvite,
  currentAgreement,
  decidePriceRequest,
  getApplication,
  listApplications,
  listInvites,
  listPriceRequests,
  NotFoundError,
  openInvite,
  publishAgreement,
  rejectApplication,
  revokeInvite,
  shopAgreementStatus,
  shopIdsFrom,
  submitPriceRequest,
  submitSellerApplication,
  withdrawPriceRequest,
} from '@mechdost/db/repo';
import {
  APPLICATION_REJECT_REASONS,
  InviteSchema,
  PRICE_REJECT_REASONS,
  SellerApplicationSchema,
} from '@mechdost/shared/partners';
import { APPLICATION_STATES, PRICE_REQUEST_STATES } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { log, safeError } from '../logger';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Seller onboarding over HTTP (plan 2026-11-13 Task 4; design `docs/superpowers/specs/2026-11-13-seller-onboarding-design.md`):
 * - public: the application form and the invite link (Turnstile, per-IP limits);
 * - staff: applications (review, approve with the delivery area, reject), invites, the price queue, agreement texts;
 * - shops: price requests and the agreement, under `/shop-onboarding/{shopId}` (own shop only).
 */
const APPLY_PER_IP: RateRule = { name: 'partner_apply_ip', limit: 5, windowSeconds: 3600 };
const INVITE_PER_IP: RateRule = { name: 'partner_invite_ip', limit: 30, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = { 404: json(ErrorSchema, 'Not found'), 409: json(ErrorSchema, 'Changed meanwhile') };
const Loose = z.record(z.string(), z.unknown());
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const SubmitBody = z
  .object({ application: Loose, turnstileToken: z.string().min(1).max(2048) })
  .strict()
  .openapi('PartnerApplicationSubmit');
const Token = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const Code = z.string().regex(/^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/);
const Uuid = z.uuid();
const Coverage = z
  .array(
    z
      .object({
        pincode: z.string().regex(/^[1-9][0-9]{5}$/),
        shippingPaise: z.number().int().min(0).max(50_000),
        leadDays: z.number().int().min(0).max(14),
      })
      .strict(),
  )
  .min(1)
  .max(500);

function keyringOf(deps: AppDeps) {
  if (!deps.keyring) throw new ApiError(503, 'UNAVAILABLE', 'Applications are not available right now');
  return deps.keyring;
}

async function human(deps: AppDeps, c: Context<AppEnv>, token: string) {
  if (!deps.turnstile) throw new ApiError(503, 'UNAVAILABLE', 'Applications are not available right now');
  let ok: boolean;
  try {
    ok = await deps.turnstile.verify(token, c.get('clientIp'));
  } catch (err) {
    log('error', 'turnstile_unavailable', safeError(err));
    throw new ApiError(503, 'UNAVAILABLE', 'Please try again in a minute');
  }
  if (!ok) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');
}

function parseApplication(raw: unknown) {
  const parsed = SellerApplicationSchema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(400, 'APPLICATION_INVALID', 'Check the highlighted fields', {
      fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))],
    });
  return parsed.data;
}

/** Public: the application form and the invite link. */
export function partnerPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/partner-applications',
    rateLimit(deps.rateLimiter, APPLY_PER_IP, (c) => c.get('clientIp')),
  );
  app.use(
    '/partner-invites/*',
    rateLimit(deps.rateLimiter, INVITE_PER_IP, (c) => c.get('clientIp')),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/partner-applications',
      tags: ['partners'],
      summary: 'Apply as a seller (public; Turnstile)',
      request: body(SubmitBody),
      responses: {
        201: json(z.object({ code: z.string(), status: z.string() }), 'Received'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const application = parseApplication(b.application);
      await human(deps, c, b.turnstileToken);
      const r = await submitSellerApplication(deps.db, {
        application,
        source: 'public',
        keyring: keyringOf(deps),
      });
      return c.json(r, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/partner-invites/{token}',
      tags: ['partners'],
      summary: 'What an invite link shows before the form (the phone is masked)',
      request: { params: z.object({ token: Token }) },
      responses: {
        200: json(
          z.object({ name: z.string(), email: z.string(), phoneLast4: z.string(), expiresAt: z.string() }),
          'Open invite',
        ),
        ...conflict,
        ...errorResponses,
      },
    }),
    async (c) => {
      const r = await openInvite(deps.db, c.req.valid('param').token);
      return c.json({ ...r, expiresAt: r.expiresAt.toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/partner-invites/{token}/application',
      tags: ['partners'],
      summary: 'Submit the application of an invited seller (approved on submit)',
      request: { params: z.object({ token: Token }), ...body(SubmitBody) },
      responses: {
        201: json(z.object({ code: z.string(), status: z.string() }), 'Received'),
        ...conflict,
        ...errorResponses,
      },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const application = parseApplication(b.application);
      await human(deps, c, b.turnstileToken);
      const r = await submitSellerApplication(deps.db, {
        application,
        source: 'invite',
        inviteToken: c.req.valid('param').token,
        keyring: keyringOf(deps),
      });
      return c.json(r, 201);
    },
  );
  return app;
}

/** Staff: applications, invites, the price queue and agreement texts. */
export function partnerAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefixes = [
    ['/admin/partner-applications/*', 'applications:review'],
    ['/admin/partner-invites/*', 'partners:write'],
    ['/admin/price-requests/*', 'prices:approve'],
    ['/admin/agreements/*', 'content:write'],
  ] as const;
  for (const [prefix, permission] of prefixes) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
    app.use(prefix, requirePermission(permission));
  }
  app.on('POST', '/admin/partner-applications/:code/approve', requirePermission('partners:approve'));
  app.on('POST', '/admin/partner-applications/:code/reject', requirePermission('partners:approve'));
  const scope = (c: Context<AppEnv>, permission: string) => cityScopeFrom(c.get('auth').grants, permission);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/partner-applications',
      tags: ['admin'],
      summary: 'Applications in your cities, newest first',
      security: [{ bearerAuth: [] }],
      request: { query: z.object({ status: z.enum(APPLICATION_STATES).optional() }) },
      responses: {
        200: json(z.object({ items: z.array(Loose), more: z.boolean() }), 'Applications'),
        ...errorResponses,
      },
    }),
    async (c) => {
      const r = await listApplications(deps.db, scope(c, 'applications:review'), {
        status: c.req.valid('query').status ?? null,
      });
      return c.json(
        {
          items: r.items.map(({ id: _id, cityId: _c, ...rest }) => ({
            ...rest,
            createdAt: rest.createdAt.toISOString(),
          })),
          more: r.more,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/partner-applications/{code}',
      tags: ['admin'],
      summary: 'One application with its GST number, duplicate flag, pin and products',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ code: Code }) },
      responses: { 200: json(Loose, 'Application'), ...conflict, ...errorResponses },
    }),
    async (c) =>
      c.json(
        await getApplication(
          deps.db,
          scope(c, 'applications:review'),
          c.req.valid('param').code,
          keyringOf(deps),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/partner-applications/{code}/approve',
      tags: ['admin'],
      summary: 'Approve a seller with the PIN codes it delivers to (creates a pending shop)',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ code: Code }),
        ...body(z.object({ version: z.number().int().min(1), coverage: Coverage }).strict()),
      },
      responses: { 200: json(z.object({ shopId: z.string() }), 'Approved'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const r = await approveApplication(deps.db, {
        scope: scope(c, 'partners:approve'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        coverage: b.coverage,
        keyring: keyringOf(deps),
      });
      return c.json(r, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/partner-applications/{code}/reject',
      tags: ['admin'],
      summary: 'Reject an application with a reason code',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ code: Code }),
        ...body(
          z
            .object({
              version: z.number().int().min(1),
              reasonCode: z.enum(APPLICATION_REJECT_REASONS),
              note: z.string().trim().max(300).optional(),
            })
            .strict(),
        ),
      },
      responses: { 200: json(z.object({ status: z.string() }), 'Rejected'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      await rejectApplication(deps.db, {
        scope: scope(c, 'partners:approve'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        reasonCode: b.reasonCode,
        note: b.note ?? null,
      });
      return c.json({ status: 'rejected' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/partner-invites',
      tags: ['admin'],
      summary: 'Invite a seller: emails a one-time link (also returned once, to copy)',
      security: [{ bearerAuth: [] }],
      request: body(InviteSchema),
      responses: {
        201: json(
          z.object({ id: z.string(), token: z.string(), link: z.string(), expiresAt: z.string() }),
          'Invited',
        ),
        ...conflict,
        ...errorResponses,
      },
    }),
    async (c) => {
      const b = c.req.valid('json');
      const r = await createInvite(deps.db, {
        ...b,
        staffUserId: c.get('auth').user.id,
        keyring: keyringOf(deps),
      });
      const link = `${deps.config.webBaseUrl.replace(/\/$/, '')}/partners/invite/${r.token}`;
      return c.json({ id: r.id, token: r.token, link, expiresAt: r.expiresAt.toISOString() }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/partner-invites',
      tags: ['admin'],
      summary: 'Invites and their status',
      security: [{ bearerAuth: [] }],
      responses: { 200: json(z.object({ items: z.array(Loose) }), 'Invites'), ...errorResponses },
    }),
    async (c) => c.json({ items: await listInvites(deps.db) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/partner-invites/{id}/revoke',
      tags: ['admin'],
      summary: 'Withdraw an open invite',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ id: Uuid }) },
      responses: { 200: json(z.object({ status: z.string() }), 'Revoked'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      await revokeInvite(deps.db, { id: c.req.valid('param').id, staffUserId: c.get('auth').user.id });
      return c.json({ status: 'revoked' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/price-requests',
      tags: ['admin'],
      summary: 'The price queue in your cities (oldest waiting first)',
      security: [{ bearerAuth: [] }],
      request: { query: z.object({ status: z.enum(PRICE_REQUEST_STATES).optional() }) },
      responses: { 200: json(z.object({ items: z.array(Loose) }), 'Price requests'), ...errorResponses },
    }),
    async (c) =>
      c.json(
        {
          items: await listPriceRequests(deps.db, {
            scope: scope(c, 'prices:approve'),
            status: c.req.valid('query').status ?? 'pending',
          }),
        },
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/price-requests/{id}/decide',
      tags: ['admin'],
      summary: 'Approve a price (on sale) or reject it (off sale for that shop) with a reason',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ id: Uuid }),
        ...body(
          z
            .object({
              version: z.number().int().min(1),
              decision: z.enum(['approved', 'rejected']),
              reasonCode: z.enum(PRICE_REJECT_REASONS).optional(),
            })
            .strict(),
        ),
      },
      responses: { 200: json(z.object({ status: z.string() }), 'Decided'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await decidePriceRequest(deps.db, {
          id: c.req.valid('param').id,
          expectedVersion: b.version,
          staffUserId: c.get('auth').user.id,
          decision: b.decision,
          reasonCode: b.reasonCode ?? null,
          scope: scope(c, 'prices:approve'),
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/agreements',
      tags: ['admin'],
      summary: 'Publish a new version of the seller agreement (English and Hindi)',
      security: [{ bearerAuth: [] }],
      request: body(
        z.object({ textEn: z.string().min(20).max(50_000), textHi: z.string().min(20).max(50_000) }).strict(),
      ),
      responses: { 200: json(z.object({ version: z.number().int() }), 'Published'), ...errorResponses },
    }),
    async (c) => {
      const b = c.req.valid('json');
      return c.json(await publishAgreement(deps.db, { ...b, staffUserId: c.get('auth').user.id }), 200);
    },
  );
  return app;
}

/** Shops: price requests and the agreement (own shop only; another shop → 404). */
export function shopOnboardingRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/shop-onboarding/*';
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('inventory:write'));
  const own = (c: Context<AppEnv>, shopId: string) => {
    if (!shopIdsFrom(c.get('auth').grants, 'inventory:write').includes(shopId))
      throw new NotFoundError('Shop not found');
  };
  const ShopParam = z.object({ shopId: Uuid });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/shop-onboarding/{shopId}/price-requests',
      tags: ['shop'],
      summary: "Your shop's price requests (newest first)",
      security: [{ bearerAuth: [] }],
      request: { params: ShopParam },
      responses: {
        200: json(z.object({ items: z.array(Loose) }), 'Requests'),
        ...conflict,
        ...errorResponses,
      },
    }),
    async (c) => {
      const { shopId } = c.req.valid('param');
      own(c, shopId);
      return c.json({ items: await listPriceRequests(deps.db, { shopId }) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/shop-onboarding/{shopId}/price-requests',
      tags: ['shop'],
      summary: 'Ask for a price (and stock) for one product; staff approve it',
      security: [{ bearerAuth: [] }],
      request: {
        params: ShopParam,
        ...body(
          z
            .object({
              sku: z.string().min(1).max(64),
              pricePaise: z.number().int().min(1),
              onHand: z.number().int().min(0).max(100_000),
            })
            .strict(),
        ),
      },
      responses: { 201: json(z.object({ id: z.string() }), 'Requested'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const { shopId } = c.req.valid('param');
      own(c, shopId);
      const b = c.req.valid('json');
      return c.json(await submitPriceRequest(deps.db, { shopId, userId: c.get('auth').user.id, ...b }), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/shop-onboarding/{shopId}/price-requests/{id}/withdraw',
      tags: ['shop'],
      summary: 'Take back a request that is still waiting',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ shopId: Uuid, id: Uuid }) },
      responses: { 200: json(z.object({ status: z.string() }), 'Withdrawn'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const { shopId, id } = c.req.valid('param');
      own(c, shopId);
      await withdrawPriceRequest(deps.db, { shopId, id });
      return c.json({ status: 'withdrawn' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/shop-onboarding/{shopId}/agreement',
      tags: ['shop'],
      summary: 'The current seller agreement and the versions your shop accepted',
      security: [{ bearerAuth: [] }],
      request: { params: ShopParam },
      responses: { 200: json(Loose, 'Agreement'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const { shopId } = c.req.valid('param');
      own(c, shopId);
      const current = await currentAgreement(deps.db);
      return c.json(
        {
          current: current ? { ...current, publishedAt: current.publishedAt.toISOString() } : null,
          ...(await shopAgreementStatus(deps.db, shopId)),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/shop-onboarding/{shopId}/agreement',
      tags: ['shop'],
      summary: 'Accept a version of the seller agreement',
      security: [{ bearerAuth: [] }],
      request: { params: ShopParam, ...body(z.object({ version: z.number().int().min(1) }).strict()) },
      responses: { 200: json(z.object({ live: z.boolean() }), 'Accepted'), ...conflict, ...errorResponses },
    }),
    async (c) => {
      const { shopId } = c.req.valid('param');
      own(c, shopId);
      return c.json(
        await acceptAgreement(deps.db, {
          shopId,
          userId: c.get('auth').user.id,
          version: c.req.valid('json').version,
        }),
        200,
      );
    },
  );
  return app;
}
