import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptShopOffer,
  advanceShopOrder,
  declineShopOffer,
  deliverShopOrder,
  giveUpShopOrder,
  listPartnerWarningsForPartner,
  listShopOrders,
  shopIdsFrom,
} from '@mechdost/db/repo';
import { ShopWarningsList } from '@mechdost/shared/partner-warnings';
import type { Permission } from '@mechdost/shared/rbac';
import { ASSIGNMENT_DECLINE_REASONS, ASSIGNMENT_GIVE_UP_REASONS } from '@mechdost/shared/state';
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

export const GIVE_UP_RATE: RateRule = { name: 'shop_give_up_user', limit: 10, windowSeconds: 600 };

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
    payoutPaise: z.number().int().nullable(),
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
        unitPaise: z.number().int().nullable(),
      }),
    ),
    assignmentId: z.string().nullable(),
    expiresAt: z.string().nullable(),
    address: z.record(z.string(), z.unknown()).nullable(),
    /** History only: why this shop gave the order up (status `given_up`), else null. */
    givenUpReason: z.string().nullable(),
    /** Active orders: five wrong delivery codes were entered (server state). */
    deliveryLocked: z.boolean(),
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
    // Agent-delivered orders (spec 24): packed ? ready for pickup (a delivery job opens; the pickup code is shown).
    z.object({ to: z.literal('ready_for_pickup'), version: z.number().int().min(1) }).strict(),
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
    z
      .object({
        to: z.literal('out_for_delivery'),
        version: z.number().int().min(1),
        handOverOwn: z.boolean().optional(),
      })
      .strict(),
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

const giveUp = createRoute({
  method: 'post',
  path: '/shop/orders/{code}/give-up',
  tags: ['shop'],
  summary: 'Give up an order you accepted, before packing, with a reason code (it goes back to MechDost)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: OrderCode }),
    body: body(
      z
        .object({
          reasonCode: z.enum(ASSIGNMENT_GIVE_UP_REASONS),
          note: z.string().trim().min(1).max(300).nullable().optional(),
          version: z.number().int().min(1),
        })
        .strict()
        .openapi('GiveUpShopOrder'),
    ),
  },
  responses: { 200: json(Changed, 'Given up; with MechDost to reroute'), ...conflict, ...errorResponses },
});

const warnings = createRoute({
  method: 'get',
  path: '/shop/warnings',
  tags: ['shop'],
  summary: 'Warnings MechDost gave your shop (reason, note, date) and how many count in the window',
  security: [{ bearerAuth: [] }],
  responses: {
    200: json(ShopWarningsList, 'Warnings per shop in your grants'),
    ...errorResponses,
  },
});

export function shopOrderRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // '/shop/orders/*' also matches '/shop/orders' (Hono): one pattern per prefix, so nothing runs twice.
  for (const path of ['/shop/orders/*', '/shop/offers/*', '/shop/warnings/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(path, requireVerified);
  }
  app.use('/shop/orders', requirePermission('orders:read'));
  app.use('/shop/offers/*', requirePermission('assignments:respond'));
  app.use('/shop/warnings/*', requirePermission('orders:read'));
  app.on(
    'POST',
    '/shop/orders/:code/give-up',
    rateLimit(deps.rateLimiter, GIVE_UP_RATE, (c) => c.get('auth').user.id),
  );
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
        // Staff do not see what the shop is paid (spec 13): money only for shops where the caller reads payouts.
        moneyShopIds: shops(c, 'payouts:read'),
        keyring: deps.keyring ?? null,
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
            : b.to === 'out_for_delivery'
              ? { to: b.to, handOverOwn: b.handOverOwn === true }
              : { to: b.to },
        staffUserId: c.get('auth').user.id,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(giveUp, async (c) => {
      const b = c.req.valid('json');
      const r = await giveUpShopOrder(deps.db, {
        shopIds: shops(c, 'orders:fulfil'),
        code: c.req.valid('param').code,
        expectedVersion: b.version,
        reasonCode: b.reasonCode,
        note: b.note ?? null,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(warnings, async (c) => {
      const ids = shops(c, 'orders:read');
      const views = await Promise.all(
        ids.map(async (shopId) => ({
          shopId,
          ...(await listPartnerWarningsForPartner(deps.db, ids, 'shop', shopId)),
        })),
      );
      return c.json({ shops: views }, 200);
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
