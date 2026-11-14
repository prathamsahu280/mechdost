import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  CART_MAX_LINES,
  cancelMyOrder,
  getMyOrder,
  LINE_MAX_QTY,
  listMyOrders,
  placeOrder,
  quoteCheckout,
} from '@mechdost/db/repo';
import { PERSON_CANCEL_REASONS } from '@mechdost/shared/state';
import type { SessionCache } from '../auth/session-cache';
import { ensureRazorpayOrder } from '../payments/service';
import { ApiError } from '../errors';
import { authenticate, requireCustomerVerified, requirePermission } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';
import { BusinessPurchaseSchema } from '@mechdost/shared/business';

/**
 * Checkout (spec 03). `POST /checkout/quote` prices a cart for a PIN (public, per-IP limit). `POST /orders` places
 * a cash-on-delivery order for a signed-in customer with phone + email verified; the `Idempotency-Key` header
 * makes retries and double taps return the same order (201 first time, 200 on replay). Online payment answers
 * 422 PAYMENT_METHOD_UNAVAILABLE until Razorpay is set up (pending decision #1). Addresses and notes are
 * personal data: never logged.
 */
export const QUOTE_RATE: RateRule = { name: 'checkout_quote_ip', limit: 60, windowSeconds: 60 };
export const PLACE_RATE: RateRule = { name: 'orders_place_user', limit: 10, windowSeconds: 600 };

const Locale = z.enum(['en', 'hi']).default('en');
const Pincode = z.string().regex(/^[1-9][0-9]{5}$/);
const Lines = z
  .array(
    z
      .object({
        sku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,47}$/),
        qty: z.number().int().min(1).max(LINE_MAX_QTY),
      })
      .strict(),
  )
  .min(1)
  .max(CART_MAX_LINES)
  .refine((l) => new Set(l.map((x) => x.sku)).size === l.length, { message: 'Each product appears once' });

const QuoteBody = z
  .object({ pincode: Pincode, lines: Lines, locale: Locale })
  .strict()
  .openapi('CheckoutQuoteRequest');

const Quote = z
  .object({
    cityCode: z.string(),
    /** GST state code of the delivery PIN (place of supply), e.g. '22'. */
    deliveryStateCode: z.string(),
    pincode: z.string(),
    lines: z.array(
      z.object({
        sku: z.string(),
        qty: z.number().int(),
        name: z.string().nullable(),
        unitPaise: z.number().int().nullable(),
        mrpPaise: z.number().int().nullable(),
        totalPaise: z.number().int().nullable(),
        group: z.number().int().nullable(),
        issue: z.enum(['unavailable', 'insufficient_stock']).nullable(),
        available: z.number().int().nullable(),
      }),
    ),
    groups: z.array(
      z.object({
        seller: z.string(),
        subtotalPaise: z.number().int(),
        shippingPaise: z.number().int(),
        taxPaise: z.number().int(),
        totalPaise: z.number().int(),
        leadDays: z.number().int(),
      }),
    ),
    subtotalPaise: z.number().int(),
    shippingPaise: z.number().int(),
    codFeePaise: z.number().int(),
    taxPaise: z.number().int(),
    totalPaise: z.number().int(),
    /** Paid online: no COD fee. */
    onlineTotalPaise: z.number().int(),
    ok: z.boolean(),
    cod: z.object({
      allowed: z.boolean(),
      reason: z.enum(['over_cap', 'pincode']).nullable(),
      capPaise: z.number().int(),
    }),
  })
  .openapi('CheckoutQuote');

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
const PlaceBody = z
  .object({
    address: z
      .object({
        contactName: Text(2, 80),
        contactPhone: z.string().regex(/^\+91[6-9][0-9]{9}$/),
        line1: Text(5, 200),
        line2: Text(1, 200).nullable().optional(),
        landmark: Text(1, 120).nullable().optional(),
        pincode: Pincode,
      })
      .strict(),
    lines: Lines,
    expectedTotalPaise: z.number().int().min(0),
    paymentMethod: z.enum(['cod', 'online']),
    note: Text(1, 300).nullable().optional(),
    /** Optional business purchase: GSTIN (checksum) + business name, both or neither (buyer GSTIN plan). */
    business: BusinessPurchaseSchema.nullable().optional(),
    locale: Locale,
  })
  .strict()
  .openapi('PlaceOrderRequest');

const Placed = z
  .object({
    code: z.string(),
    paymentMethod: z.enum(['cod', 'online']),
    paymentStatus: z.string(),
    totalPaise: z.number().int(),
    orders: z.array(z.object({ code: z.string(), totalPaise: z.number().int() })),
    replayed: z.boolean(),
    /** Online orders: what the browser needs to open Razorpay Checkout (null once paid or expired). */
    razorpay: z
      .object({
        keyId: z.string(),
        orderId: z.string(),
        amountPaise: z.number().int(),
        currency: z.literal('INR'),
      })
      .nullable()
      .optional(),
  })
  .openapi('PlacedOrder');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const quote = createRoute({
  method: 'post',
  path: '/checkout/quote',
  tags: ['checkout'],
  summary: 'Price a cart for a delivery PIN: per-shop groups, delivery, GST, COD eligibility, line issues',
  request: { body: { required: true, content: { 'application/json': { schema: QuoteBody } } } },
  responses: {
    200: json(Quote, 'Quote'),
    422: json(ErrorSchema, 'PIN not served / invalid cart'),
    ...errorResponses,
  },
});

const place = createRoute({
  method: 'post',
  path: '/orders',
  tags: ['orders'],
  summary: 'Place a cash-on-delivery order (Idempotency-Key header required)',
  security: [{ bearerAuth: [] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }),
    body: { required: true, content: { 'application/json': { schema: PlaceBody } } },
  },
  responses: {
    201: json(Placed, 'Placed'),
    200: json(Placed, 'Already placed with this key'),
    409: json(ErrorSchema, 'PRICE_CHANGED or OUT_OF_STOCK: re-quote and confirm again'),
    422: json(
      ErrorSchema,
      'CHECKOUT_UNAVAILABLE (details.lines), COD_NOT_ALLOWED, PAYMENT_METHOD_UNAVAILABLE',
    ),
    ...errorResponses,
  },
});

const GroupCode = z
  .string()
  .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'MD-RPR-2026-7K3Q9X' });
const SubCode = z
  .string()
  .regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}-\d{1,2}$/)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'MD-RPR-2026-7K3Q9X-1' });
const Summary = z.object({
  code: z.string(),
  placedAt: z.string(),
  /** Still payable: cancelled or rejected parts excluded. */
  totalPaise: z.number().int(),
  /** Confirmed at checkout. */
  placedTotalPaise: z.number().int(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
});
const Tracked = z.object({
  code: z.string(),
  status: z.string(),
  version: z.number().int(),
  totalPaise: z.number().int(),
  shippingPaise: z.number().int(),
  seller: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      sku: z.string(),
      qty: z.number().int(),
      unitPaise: z.number().int(),
      totalPaise: z.number().int(),
    }),
  ),
  timeline: z.array(z.object({ status: z.string(), at: z.string() })),
  message: z.string().nullable(),
  deliveryCode: z.string().nullable(),
  canCancel: z.boolean(),
});

const myOrders = createRoute({
  method: 'get',
  path: '/orders',
  tags: ['orders'],
  summary: 'Your orders, newest first (pass `nextCursor` back as `cursor` for the next page)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: json(
      z.object({
        orders: z.array(
          Summary.extend({
            orders: z.array(z.object({ code: z.string(), status: z.string(), totalPaise: z.number().int() })),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      'Orders',
    ),
    ...errorResponses,
  },
});

const myOrder = createRoute({
  method: 'get',
  path: '/orders/{code}',
  tags: ['orders'],
  summary: 'Track one of your orders: timeline, seller, delivery code while out for delivery',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: GroupCode }), query: z.object({ locale: Locale }) },
  responses: {
    200: json(
      Summary.extend({
        address: z.record(z.string(), z.unknown()),
        business: z.object({ gstin: z.string(), businessName: z.string() }).nullable(),
        orders: z.array(Tracked),
      }),
      'Order',
    ),
    404: json(ErrorSchema, 'Not found'),
    ...errorResponses,
  },
});

const cancel = createRoute({
  method: 'post',
  path: '/orders/{code}/cancel',
  tags: ['orders'],
  summary: 'Cancel one part of your order before it is packed (reason code required)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ code: SubCode }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({ reasonCode: z.enum(PERSON_CANCEL_REASONS), version: z.number().int().min(1) })
            .strict()
            .openapi('CancelMyOrder'),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ status: z.string(), version: z.number().int() }), 'Cancelled'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'NOT_CANCELLABLE or changed meanwhile'),
    ...errorResponses,
  },
});

export function checkoutRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/checkout/quote',
    rateLimit(deps.rateLimiter, QUOTE_RATE, (c) => c.get('clientIp')),
  );
  // One pattern: Hono's '/orders/*' also matches '/orders' (L54), so nothing runs twice.
  app.use('/orders/*', authenticate(deps, cache));
  app.use(
    '/orders/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/orders',
    rateLimit(deps.rateLimiter, PLACE_RATE, (c) => c.get('auth').user.id),
  );
  app.on('POST', '/orders', requireCustomerVerified(deps));
  app.on('POST', '/orders', requirePermission('orders:place'));

  return app
    .openapi(quote, async (c) => {
      const body = c.req.valid('json');
      return c.json(await quoteCheckout(deps.db, body), 200);
    })
    .openapi(place, async (c) => {
      const body = c.req.valid('json');
      const razorpay = deps.razorpay ?? null;
      if (body.paymentMethod === 'online' && !razorpay)
        throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not available yet');
      const userId = c.get('auth').user.id;
      const placed = await placeOrder(deps.db, {
        method: body.paymentMethod,
        userId,
        idempotencyKey: c.req.valid('header')['idempotency-key'],
        address: {
          contactName: body.address.contactName,
          contactPhone: body.address.contactPhone,
          line1: body.address.line1,
          line2: body.address.line2 ?? null,
          landmark: body.address.landmark ?? null,
          pincode: body.address.pincode,
        },
        lines: body.lines,
        expectedTotalPaise: body.expectedTotalPaise,
        note: body.note ?? null,
        business: body.business ?? null,
        locale: body.locale,
      });
      // The Razorpay order exists (stored) before the client sees it; a retried place reuses it.
      const handle =
        placed.paymentMethod === 'online' && razorpay
          ? await ensureRazorpayOrder(deps.db, razorpay, { userId, groupCode: placed.code })
          : undefined;
      return c.json(
        handle === undefined ? placed : { ...placed, razorpay: handle },
        placed.replayed ? 200 : 201,
      );
    })
    .openapi(myOrders, async (c) => {
      const page = await listMyOrders(deps.db, c.get('auth').user.id, c.req.valid('query'));
      return c.json(
        {
          orders: page.orders.map((r) => ({ ...r, placedAt: r.placedAt.toISOString() })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    })
    .openapi(myOrder, async (c) => {
      const o = await getMyOrder(deps.db, c.get('auth').user.id, c.req.valid('param').code, {
        locale: c.req.valid('query').locale,
        keyring: deps.keyring ?? null,
      });
      return c.json(
        {
          ...o,
          placedAt: o.placedAt.toISOString(),
          orders: o.orders.map((x) => ({
            ...x,
            timeline: x.timeline.map((e) => ({ status: e.status, at: e.at.toISOString() })),
          })),
        },
        200,
      );
    })
    .openapi(cancel, async (c) => {
      const b = c.req.valid('json');
      const r = await cancelMyOrder(deps.db, {
        userId: c.get('auth').user.id,
        code: c.req.valid('param').code,
        reasonCode: b.reasonCode,
        expectedVersion: b.version,
      });
      return c.json(r, 200);
    });
}
