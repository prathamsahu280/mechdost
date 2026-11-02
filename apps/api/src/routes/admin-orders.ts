import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cancelOrderAsStaff,
  cityScopeFrom,
  getRoutingOrder,
  listRoutingQueue,
  rejectOrder,
  routeOrder,
} from '@mechdost/db/repo';
import { ORDER_CANCEL_REASONS, ORDER_REJECT_REASONS } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Admin routing (spec 04): verified staff, city-scoped by the grant of each permission (`orders:read` to see,
 * `orders:route` to route/reroute/reject; foreign-city orders are 404). Every change carries the order `version`.
 */
const Code = z
  .string()
  .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}-\d{1,2}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'MD-RPR-2026-7K3Q9X-1' });
const Locale = z.enum(['en', 'hi']).default('en');

const QueueItem = z.object({
  code: z.string(),
  status: z.string(),
  pincode: z.string(),
  placedAt: z.string(),
  totalPaise: z.number().int(),
  items: z.number().int(),
  version: z.number().int(),
  attempts: z.number().int(),
  offer: z.object({ shop: z.string(), expiresAt: z.string() }).nullable(),
});
const RankedShop = z.object({
  shopId: z.string(),
  name: z.string(),
  distanceKm: z.number().nullable(),
  stockedItems: z.number().int(),
  totalItems: z.number().int(),
  acceptanceRate: z.number().nullable(),
  rating: z.number().nullable(),
  pricePaise: z.number().int().nullable(),
  triedBefore: z.boolean(),
  eligible: z.boolean(),
});
const OrderView = z
  .object({
    code: z.string(),
    status: z.string(),
    version: z.number().int(),
    pincode: z.string(),
    totalPaise: z.number().int(),
    items: z.array(
      z.object({ sku: z.string(), title: z.string(), qty: z.number().int(), unitPaise: z.number().int() }),
    ),
    history: z.array(
      z.object({
        shop: z.string(),
        status: z.string(),
        offeredAt: z.string(),
        respondedAt: z.string().nullable(),
        declineReason: z.string().nullable(),
      }),
    ),
    shops: z.array(RankedShop),
  })
  .openapi('AdminRoutingOrder');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = {
  404: json(ErrorSchema, 'Not found'),
  409: json(ErrorSchema, 'Changed meanwhile / not allowed now'),
};

const queue = createRoute({
  method: 'get',
  path: '/admin/orders',
  tags: ['admin'],
  summary: 'Routing queue in your cities, oldest first',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      view: z.enum(['needs_routing', 'awaiting_shop', 'in_progress', 'closed']).default('needs_routing'),
      cursor: z.string().max(200).optional(),
      locale: Locale,
    }),
  },
  responses: {
    200: json(z.object({ items: z.array(QueueItem), nextCursor: z.string().nullable() }), 'Queue'),
    ...errorResponses,
  },
});

const detail = createRoute({
  method: 'get',
  path: '/admin/orders/{code}',
  tags: ['admin'],
  summary: 'A sub-order with its items, offer history and ranked shops',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: Code }), query: z.object({ locale: Locale }) },
  responses: { 200: json(OrderView, 'Order'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const route = createRoute({
  method: 'post',
  path: '/admin/orders/{code}/route',
  tags: ['admin'],
  summary: 'Offer the order to an eligible shop (reroute after a decline or timeout)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({ shopId: z.uuid(), version: z.number().int().min(1) })
            .strict()
            .openapi('RouteOrder'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ assignmentId: z.string().nullable(), expiresAt: z.string().nullable() }), 'Offered'),
    ...conflict,
    ...errorResponses,
  },
});

const reject = createRoute({
  method: 'post',
  path: '/admin/orders/{code}/reject',
  tags: ['admin'],
  summary: 'Reject an unrouted order with a reason code and a message for the customer',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              reasonCode: z.enum(ORDER_REJECT_REASONS),
              message: z.string().trim().min(10).max(500),
              version: z.number().int().min(1),
            })
            .strict()
            .openapi('RejectOrder'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ status: z.string(), version: z.number().int() }), 'Rejected'),
    ...conflict,
    ...errorResponses,
  },
});

const cancelRoute = createRoute({
  method: 'post',
  path: '/admin/orders/{code}/cancel',
  tags: ['admin'],
  summary: 'Cancel an order (also once packed) with a reason code; stock goes back, the offer is withdrawn',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: Code }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({ reasonCode: z.enum(ORDER_CANCEL_REASONS), version: z.number().int().min(1) })
            .strict()
            .openapi('CancelOrderAsStaff'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ status: z.string(), version: z.number().int() }), 'Cancelled'),
    ...conflict,
    ...errorResponses,
  },
});

interface QueueCursor {
  placedAt: string;
  id: string;
}
const encode = (c: QueueCursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(raw: string): QueueCursor {
  try {
    const v: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const parsed = z
      .object({ placedAt: z.string().max(40), id: z.uuid() })
      .strict()
      .safeParse(v);
    if (parsed.success && !Number.isNaN(Date.parse(parsed.data.placedAt))) return parsed.data;
  } catch {
    // fall through
  }
  throw new ApiError(422, 'INVALID_CURSOR', 'Invalid cursor');
}

export function adminOrderRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern only: Hono's '/admin/orders/*' also matches '/admin/orders' (two patterns would run every
  // middleware twice and count the rate limit double).
  app.use('/admin/orders/*', authenticate(deps, cache));
  app.use(
    '/admin/orders/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/orders/*', requireVerified);
  app.use('/admin/orders/*', requirePermission('orders:read'));
  app.on('POST', '/admin/orders/:code/route', requirePermission('orders:route'));
  app.on('POST', '/admin/orders/:code/reject', requirePermission('orders:route'));
  app.on('POST', '/admin/orders/:code/cancel', requirePermission('orders:cancel'));

  return app
    .openapi(queue, async (c) => {
      const q = c.req.valid('query');
      const page = await listRoutingQueue(deps.db, cityScopeFrom(c.get('auth').grants, 'orders:read'), {
        view: q.view,
        cursor: q.cursor ? decode(q.cursor) : null,
        locale: q.locale,
      });
      return c.json(
        {
          items: page.items.map((i) => ({
            ...i,
            placedAt: i.placedAt.toISOString(),
            offer: i.offer ? { shop: i.offer.shop, expiresAt: i.offer.expiresAt.toISOString() } : null,
          })),
          nextCursor: page.next ? encode(page.next) : null,
        },
        200,
      );
    })
    .openapi(detail, async (c) => {
      const view = await getRoutingOrder(
        deps.db,
        cityScopeFrom(c.get('auth').grants, 'orders:read'),
        c.req.valid('param').code,
        c.req.valid('query').locale,
      );
      return c.json(
        {
          ...view,
          history: view.history.map((h) => ({
            ...h,
            offeredAt: h.offeredAt.toISOString(),
            respondedAt: h.respondedAt ? h.respondedAt.toISOString() : null,
          })),
        },
        200,
      );
    })
    .openapi(route, async (c) => {
      const body = c.req.valid('json');
      const r = await routeOrder(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'orders:route'),
        code: c.req.valid('param').code,
        shopId: body.shopId,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json({ assignmentId: r.assignmentId, expiresAt: r.expiresAt.toISOString() }, 200);
    })
    .openapi(reject, async (c) => {
      const body = c.req.valid('json');
      const r = await rejectOrder(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'orders:route'),
        code: c.req.valid('param').code,
        reasonCode: body.reasonCode,
        message: body.message,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(cancelRoute, async (c) => {
      const body = c.req.valid('json');
      const scope = cityScopeFrom(c.get('auth').grants, 'orders:cancel');
      const r = await cancelOrderAsStaff(deps.db, {
        cityIds: scope.all ? 'all' : scope.cityIds,
        code: c.req.valid('param').code,
        reasonCode: body.reasonCode,
        expectedVersion: body.version,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    });
}
