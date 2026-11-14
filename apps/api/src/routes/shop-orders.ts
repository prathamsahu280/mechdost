import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptShopOffer,
  advanceShopOrder,
  declineShopOffer,
  deliverShopOrder,
  listShopOrders,
  shopIdsFrom,
} from '@mechdost/db/repo';
import type { Permission } from '@mechdost/shared/rbac';
import { ASSIGNMENT_DECLINE_REASONS } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Shop portal API (spec 04, spec 07): shop owners/staff (verified; grants scoped to their shop) see offers and
 * their orders, accept or decline offers, move orders through fulfilment and deliver with the customer's code.
 * Scope = the shops in the caller's grants for each permission; other shops' ids and codes are 404.
 */
export const DELIVER_RATE: RateRule = { name: 'shop_deliver_user', limit: 20, windowSeconds: 600 };

const OrderCode = z
  .string()
  .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}-\d{1,2}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'MD-RPR-2026-7K3Q9X-1' });
const AssignmentId = z.uuid().openapi({ param: { name: 'assignmentId', in: 'path' } });

const ShopOrder = z
  .object({
    code: z.string(),
    status: z.string(),
    version: z.number().int(),
    totalPaise: z.number().int(),
    payoutPaise: z.number().int(),
    collectPaise: z.number().int().nullable(),
    /** MechDost Coins discount on this part, paid by MechDost (never by the shop; spec 20); 0 when none. */
    coinDiscountPaise: z.number().int(),
    pincode: z.string(),
    items: z.array(
      z.object({
        title: z.string(),
        titleHi: z.string().nullable(),
        sku: z.string(),
        qty: z.number().int(),
        unitPaise: z.number().int(),
      }),
    ),
    assignmentId: z.string().nullable(),
    expiresAt: z.string().nullable(),
    address: z.record(z.string(), z.unknown()).nullable(),
  })
  .openapi('ShopOrder');
const Changed = z.object({ status: z.string(), version: z.number().int() });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const conflict = { 404: json(ErrorSchema, 'Not found'), 409: json(ErrorSchema, 'Taken, expired or changed') };

const list = createRoute({
  method: 'get',
  path: '/shop/orders',
  tags: ['shop'],
  summary: 'Offers waiting for you (customer hidden), orders in progress (with the delivery address), done',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      view: z.enum(['offers', 'active', 'done']).default('offers'),
      // `done` is paged (newest first); offers and active are the live working set.
      cursor: z.string().max(200).optional(),
    }),
  },
  responses: {
    200: json(z.object({ orders: z.array(ShopOrder), nextCursor: z.string().nullable() }), 'Orders'),
    ...errorResponses,
  },
});

const accept = createRoute({
  method: 'post',
  path: '/shop/offers/{assignmentId}/accept',
  tags: ['shop'],
  summary: 'Accept an offer before its timer ends (the first accept wins)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ assignmentId: AssignmentId }) },
  responses: { 200: json(Changed, 'Confirmed'), ...conflict, ...errorResponses },
});

const decline = createRoute({
  method: 'post',
  path: '/shop/offers/{assignmentId}/decline',
  tags: ['shop'],
  summary: 'Decline an offer with a reason code (the order goes back to MechDost)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ assignmentId: AssignmentId }),
    body: body(
      z
        .object({ reasonCode: z.enum(ASSIGNMENT_DECLINE_REASONS) })
        .strict()
        .openapi('DeclineOffer'),
    ),
  },
  responses: { 200: json(Changed, 'Declined'), ...conflict, ...errorResponses },
});

const Advance = z
  .discriminatedUnion('to', [
    z.object({ to: z.literal('packed'), version: z.number().int().min(1) }).strict(),
    z
      .object({
        to: z.literal('shipped'),
        version: z.number().int().min(1),
        mode: z.enum(['own', 'courier']),
        courier: z.string().trim().min(2).max(60).nullable().optional(),
        awb: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{4,40}$/)
          .nullable()
          .optional(),
      })
      .strict(),
    z.object({ to: z.literal('out_for_delivery'), version: z.number().int().min(1) }).strict(),
  ])
  .openapi('AdvanceShopOrder');

const advance = createRoute({
  method: 'post',
  path: '/shop/orders/{code}/advance',
  tags: ['shop'],
  summary: 'Packed → handed over (own delivery or courier + AWB) → out for delivery (customer gets the code)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: OrderCode }), body: body(Advance) },
  responses: { 200: json(Changed, 'Moved'), ...conflict, ...errorResponses },
});

const deliver = createRoute({
  method: 'post',
  path: '/shop/orders/{code}/deliver',
  tags: ['shop'],
  summary: "Mark delivered with the customer's 4-digit code (5 wrong tries lock it)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: OrderCode }),
    body: body(
      z
        .object({ deliveryCode: z.string().regex(/^\d{4}$/), version: z.number().int().min(1) })
        .strict()
        .openapi('DeliverShopOrder'),
    ),
  },
  responses: {
    200: json(
      z.object({
        ok: z.boolean(),
        reason: z.enum(['wrong', 'locked']).optional(),
        attemptsLeft: z.number().int().optional(),
        version: z.number().int().optional(),
      }),
      'Checked',
    ),
    ...conflict,
    ...errorResponses,
  },
});

export function shopOrderRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // '/shop/orders/*' also matches '/shop/orders' (Hono): one pattern per prefix, so nothing runs twice.
  for (const path of ['/shop/orders/*', '/shop/offers/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
  }
  app.use('/shop/orders', requirePermission('orders:read'));
  app.use('/shop/offers/*', requirePermission('assignments:respond'));
  // Hono's '/x/*' also matches '/x': scope fulfilment to the POST actions so the list stays orders:read.
  app.on('POST', '/shop/orders/*', requirePermission('orders:fulfil'));
  app.on(
    'POST',
    '/shop/orders/:code/deliver',
    rateLimit(deps.rateLimiter, DELIVER_RATE, (c) => c.get('auth').user.id),
  );
  const shops = (c: Context<AppEnv>, p: Permission) => shopIdsFrom(c.get('auth').grants, p);

  return app
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listShopOrders(deps.db, shops(c, 'orders:read'), q.view, {
        cursor: q.cursor ?? null,
      });
      return c.json(
        {
          orders: page.items.map((r) => ({
            ...r,
            expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    })
    .openapi(accept, async (c) => {
      const r = await acceptShopOffer(deps.db, {
        shopIds: shops(c, 'assignments:respond'),
        assignmentId: c.req.valid('param').assignmentId,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(decline, async (c) => {
      const r = await declineShopOffer(deps.db, {
        shopIds: shops(c, 'assignments:respond'),
        assignmentId: c.req.valid('param').assignmentId,
        reasonCode: c.req.valid('json').reasonCode,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(advance, async (c) => {
      const b = c.req.valid('json');
      const r = await advanceShopOrder(deps.db, {
        shopIds: shops(c, 'orders:fulfil'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        step:
          b.to === 'shipped'
            ? { to: 'shipped', mode: b.mode, courier: b.courier ?? null, awb: b.awb ?? null }
            : { to: b.to },
        staffUserId: c.get('auth').user.id,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(deliver, async (c) => {
      const b = c.req.valid('json');
      const r = await deliverShopOrder(deps.db, {
        shopIds: shops(c, 'orders:fulfil'),
        code: c.req.valid('param').code,
        deliveryCode: b.deliveryCode,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    });
}
