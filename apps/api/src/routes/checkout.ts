import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { CART_MAX_LINES, LINE_MAX_QTY, placeCodOrder, quoteCheckout } from '@mechdost/db/repo';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

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
    locale: Locale,
  })
  .strict()
  .openapi('PlaceOrderRequest');

const Placed = z
  .object({
    code: z.string(),
    paymentMethod: z.literal('cod'),
    paymentStatus: z.string(),
    totalPaise: z.number().int(),
    orders: z.array(z.object({ code: z.string(), totalPaise: z.number().int() })),
    replayed: z.boolean(),
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

export function checkoutRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/checkout/quote',
    rateLimit(deps.rateLimiter, QUOTE_RATE, (c) => c.get('clientIp')),
  );
  app.use('/orders', authenticate(deps, cache));
  app.use(
    '/orders',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/orders',
    rateLimit(deps.rateLimiter, PLACE_RATE, (c) => c.get('auth').user.id),
  );
  app.on('POST', '/orders', requireVerified);
  app.on('POST', '/orders', requirePermission('orders:place'));

  return app
    .openapi(quote, async (c) => {
      const body = c.req.valid('json');
      return c.json(await quoteCheckout(deps.db, body), 200);
    })
    .openapi(place, async (c) => {
      const body = c.req.valid('json');
      if (body.paymentMethod !== 'cod')
        throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Only cash on delivery is available for now');
      const placed = await placeCodOrder(deps.db, {
        userId: c.get('auth').user.id,
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
        locale: body.locale,
      });
      return c.json(placed, placed.replayed ? 200 : 201);
    });
}
