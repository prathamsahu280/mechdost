import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  acceptQuoteOffer,
  cityScopeFrom,
  createQuote,
  declineQuote,
  getAdminQuote,
  getMyQuote,
  listAdminQuotes,
  listMyQuotes,
  postCustomerQuoteMessage,
  postStaffQuoteMessage,
  quoteRules,
  sendQuoteOffer,
  ValidationError,
  withdrawQuote,
} from '@mechdost/db/repo';
import {
  ADMIN_QUOTE_VIEWS,
  AcceptQuoteSchema,
  CreateQuoteSchema,
  DeclineQuoteSchema,
  QuoteAcceptedDto,
  QuoteChangedDto,
  QuoteCreatedDto,
  QuoteDetailDto,
  QuoteMessageSchema,
  QuoteOfferSentDto,
  QuotePageDto,
  QuoteRulesDto,
  SendOfferSchema,
  WithdrawQuoteSchema,
} from '@mechdost/shared/quote-api';
import { QUOTE_CODE_RE, QUOTE_CUSTOMER_MESSAGES_PER_HOUR } from '@mechdost/shared/quote-rules';
import type { SessionCache } from '../auth/session-cache';
import { ApiError } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json, Locale } from './service-schemas';

/**
 * Bulk quotes (spec 19). Customers: signed in; asking, writing, accepting and closing need phone + email verified.
 * `Idempotency-Key` makes a retried request return the same quote (201 then 200) and a retried accept the same
 * order. Staff: verified, city-scoped by the grant of each permission (`quotes:read` to see, `quotes:negotiate` to
 * write, offer or withdraw). Foreign codes are 404. Message bodies are personal data: never logged.
 *
 * The shared request/response schemas are used as they are (no `.openapi()` names): they may have been built before
 * `@hono/zod-openapi` extended Zod, and calling `.openapi()` on them would then crash this module (L101).
 */
export const QUOTE_CREATE_RATE: RateRule = { name: 'quote_create_user', limit: 20, windowSeconds: 3600 };
export const QUOTE_MESSAGE_RATE: RateRule = {
  name: 'quote_message_user',
  limit: QUOTE_CUSTOMER_MESSAGES_PER_HOUR * 2,
  windowSeconds: 3600,
};
export const QUOTE_ACCEPT_RATE: RateRule = { name: 'quote_accept_user', limit: 20, windowSeconds: 600 };

const Code = z
  .string()
  .regex(QUOTE_CODE_RE)
  .openapi({ param: { name: 'code', in: 'path' }, example: 'QT-RPR-2026-7K3Q9X' });
const IdempotencyHeader = z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
const Page = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  locale: Locale,
});
const secured = [{ bearerAuth: [] }];

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────

const rules = createRoute({
  method: 'get',
  path: '/quotes/rules',
  tags: ['quotes'],
  summary:
    'Bulk quote rules for the request form: minimum units (for a PIN code city, else global), limits, open quotes',
  security: secured,
  request: {
    query: z.object({
      pincode: z
        .string()
        .regex(/^[1-9][0-9]{5}$/)
        .optional(),
    }),
  },
  responses: { 200: json(QuoteRulesDto, 'Rules'), ...errorResponses },
});

const create = createRoute({
  method: 'post',
  path: '/quotes',
  tags: ['quotes'],
  summary: 'Ask for a bulk price (products by slug, delivery address); Idempotency-Key required',
  security: secured,
  request: { headers: IdempotencyHeader, body: body(CreateQuoteSchema) },
  responses: {
    201: json(QuoteCreatedDto, 'Requested'),
    200: json(QuoteCreatedDto, 'Replay of an earlier request with the same key'),
    ...conflict,
    ...errorResponses,
  },
});

const list = createRoute({
  method: 'get',
  path: '/quotes',
  tags: ['quotes'],
  summary: 'Your bulk quotes, newest first (keyset paged)',
  security: secured,
  request: { query: Page },
  responses: { 200: json(QuotePageDto, 'Quotes'), ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/quotes/{code}',
  tags: ['quotes'],
  summary: 'One of your quotes: lines, the current offer and the thread',
  security: secured,
  request: { params: z.object({ code: Code }), query: z.object({ locale: Locale }) },
  responses: { 200: json(QuoteDetailDto, 'Quote'), ...conflict, ...errorResponses },
});

const message = createRoute({
  method: 'post',
  path: '/quotes/{code}/messages',
  tags: ['quotes'],
  summary: 'Write to MechDost (on an offered quote this reopens talks: the offer is withdrawn)',
  security: secured,
  request: { params: z.object({ code: Code }), body: body(QuoteMessageSchema) },
  responses: { 200: json(QuoteChangedDto, 'Sent'), ...conflict, ...errorResponses },
});

const accept = createRoute({
  method: 'post',
  path: '/quotes/{code}/accept',
  tags: ['quotes'],
  summary: 'Accept the active offer version (cash on delivery) → a normal order; Idempotency-Key required',
  security: secured,
  request: {
    params: z.object({ code: Code }),
    headers: IdempotencyHeader,
    body: body(AcceptQuoteSchema),
  },
  responses: {
    201: json(QuoteAcceptedDto, 'Order placed'),
    200: json(QuoteAcceptedDto, 'Replay of an earlier accept with the same key'),
    ...conflict,
    ...errorResponses,
  },
});

const decline = createRoute({
  method: 'post',
  path: '/quotes/{code}/decline',
  tags: ['quotes'],
  summary: 'Close your quote with a reason code',
  security: secured,
  request: { params: z.object({ code: Code }), body: body(DeclineQuoteSchema) },
  responses: { 200: json(QuoteChangedDto, 'Closed'), ...conflict, ...errorResponses },
});

export function quoteRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern: '/quotes/*' also matches '/quotes' (L54).
  app.use('/quotes/*', authenticate(deps, cache));
  app.use(
    '/quotes/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/quotes/*', requirePermission('quotes:request'));
  app.on('POST', '/quotes/*', requireVerified);
  app.on(
    'POST',
    '/quotes',
    rateLimit(deps.rateLimiter, QUOTE_CREATE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/quotes/:code/messages',
    rateLimit(deps.rateLimiter, QUOTE_MESSAGE_RATE, (c) => c.get('auth').user.id),
  );
  app.on(
    'POST',
    '/quotes/:code/accept',
    rateLimit(deps.rateLimiter, QUOTE_ACCEPT_RATE, (c) => c.get('auth').user.id),
  );
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;

  return (
    app
      // Registered before '/quotes/{code}' so the static path wins.
      .openapi(rules, async (c) =>
        c.json(await quoteRules(deps.db, me(c), c.req.valid('query').pincode ?? null), 200),
      )
      .openapi(create, async (c) => {
        const b = c.req.valid('json');
        try {
          const r = await createQuote(deps.db, {
            userId: me(c),
            idempotencyKey: c.req.valid('header')['idempotency-key'],
            lines: b.lines,
            address: { ...b.address, landmark: b.address.landmark ?? null },
            note: b.note ?? null,
            locale: b.locale,
          });
          const out = { code: r.code, status: r.status, version: r.version };
          return r.replayed ? c.json(out, 200) : c.json(out, 201);
        } catch (err) {
          // Spec 19: a quote below the minimum is a bad request (400), like any other invalid body.
          if (err instanceof ValidationError && err.code === 'QUOTE_MIN_UNITS')
            throw new ApiError(400, err.code, err.message, err.details);
          throw err;
        }
      })
      .openapi(list, async (c) => {
        const q = c.req.valid('query');
        return c.json(
          await listMyQuotes(deps.db, me(c), { cursor: q.cursor ?? null, limit: q.limit }, q.locale),
          200,
        );
      })
      .openapi(detail, async (c) =>
        c.json(await getMyQuote(deps.db, me(c), c.req.valid('param').code, c.req.valid('query').locale), 200),
      )
      .openapi(message, async (c) =>
        c.json(
          await postCustomerQuoteMessage(deps.db, {
            userId: me(c),
            code: c.req.valid('param').code,
            body: c.req.valid('json').body,
          }),
          200,
        ),
      )
      .openapi(accept, async (c) => {
        const b = c.req.valid('json');
        const r = await acceptQuoteOffer(deps.db, {
          userId: me(c),
          code: c.req.valid('param').code,
          offerVersion: b.offerVersion,
          idempotencyKey: c.req.valid('header')['idempotency-key'],
          locale: b.locale,
        });
        return c.json(r, r.replayed ? 200 : 201);
      })
      .openapi(decline, async (c) =>
        c.json(
          await declineQuote(deps.db, {
            userId: me(c),
            code: c.req.valid('param').code,
            reasonCode: c.req.valid('json').reasonCode,
          }),
          200,
        ),
      )
  );
}

// ── staff ─────────────────────────────────────────────────────────────────────────────────────────────────────

const adminList = createRoute({
  method: 'get',
  path: '/admin/quotes',
  tags: ['admin'],
  summary: 'Bulk quotes in your cities: waiting for us, active, offered, expiring within 24 h, closed',
  security: secured,
  request: {
    query: Page.extend({
      view: z.enum(ADMIN_QUOTE_VIEWS).default('waiting'),
    }),
  },
  responses: { 200: json(QuotePageDto, 'Quotes'), ...errorResponses },
});

const adminDetail = createRoute({
  method: 'get',
  path: '/admin/quotes/{code}',
  tags: ['admin'],
  summary: 'One quote: lines with catalogue prices, the current offer and the thread (phone masked)',
  security: secured,
  request: { params: z.object({ code: Code }), query: z.object({ locale: Locale }) },
  responses: { 200: json(QuoteDetailDto, 'Quote'), ...conflict, ...errorResponses },
});

const adminMessage = createRoute({
  method: 'post',
  path: '/admin/quotes/{code}/messages',
  tags: ['admin'],
  summary: 'Reply as MechDost (the first reply moves a new request to negotiating)',
  security: secured,
  request: { params: z.object({ code: Code }), body: body(QuoteMessageSchema) },
  responses: { 200: json(QuoteChangedDto, 'Sent'), ...conflict, ...errorResponses },
});

const adminOffer = createRoute({
  method: 'post',
  path: '/admin/quotes/{code}/offer',
  tags: ['admin'],
  summary: 'Send the final price as a new offer version (supersedes the active one); COD',
  security: secured,
  request: { params: z.object({ code: Code }), body: body(SendOfferSchema) },
  responses: { 200: json(QuoteOfferSentDto, 'Offer sent'), ...conflict, ...errorResponses },
});

const adminWithdraw = createRoute({
  method: 'post',
  path: '/admin/quotes/{code}/withdraw',
  tags: ['admin'],
  summary: 'Close a quote MechDost cannot fulfil, with a reason code and a message for the customer',
  security: secured,
  request: { params: z.object({ code: Code }), body: body(WithdrawQuoteSchema) },
  responses: { 200: json(QuoteChangedDto, 'Withdrawn'), ...conflict, ...errorResponses },
});

export function adminQuoteRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use('/admin/quotes/*', authenticate(deps, cache));
  app.use(
    '/admin/quotes/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/quotes/*', requireVerified);
  app.use('/admin/quotes/*', requirePermission('quotes:read'));
  app.on('POST', '/admin/quotes/*', requirePermission('quotes:negotiate'));
  const staff = (c: Context<AppEnv>) => c.get('auth').user.id;
  const scope = (c: Context<AppEnv>, permission: 'quotes:read' | 'quotes:negotiate') =>
    cityScopeFrom(c.get('auth').grants, permission);

  return app
    .openapi(adminList, async (c) => {
      const q = c.req.valid('query');
      return c.json(
        await listAdminQuotes(
          deps.db,
          scope(c, 'quotes:read'),
          q.view,
          { cursor: q.cursor ?? null, limit: q.limit },
          q.locale,
        ),
        200,
      );
    })
    .openapi(adminDetail, async (c) =>
      c.json(
        await getAdminQuote(
          deps.db,
          scope(c, 'quotes:read'),
          c.req.valid('param').code,
          c.req.valid('query').locale,
        ),
        200,
      ),
    )
    .openapi(adminMessage, async (c) =>
      c.json(
        await postStaffQuoteMessage(deps.db, {
          scope: scope(c, 'quotes:negotiate'),
          staffUserId: staff(c),
          code: c.req.valid('param').code,
          body: c.req.valid('json').body,
        }),
        200,
      ),
    )
    .openapi(adminOffer, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await sendQuoteOffer(deps.db, {
          scope: scope(c, 'quotes:negotiate'),
          staffUserId: staff(c),
          code: c.req.valid('param').code,
          expectedVersion: b.version,
          lines: b.lines,
          deliveryPaise: b.deliveryPaise,
          validDays: b.validDays,
          terms: b.terms ?? null,
          confirmLowPrices: b.confirmLowPrices === true,
        }),
        200,
      );
    })
    .openapi(adminWithdraw, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await withdrawQuote(deps.db, {
          scope: scope(c, 'quotes:negotiate'),
          staffUserId: staff(c),
          code: c.req.valid('param').code,
          expectedVersion: b.version,
          reasonCode: b.reasonCode,
          message: b.message,
        }),
        200,
      );
    });
}
