import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  acceptQuoteOffer,
  assertCanAttachToQuote,
  cityScopeFrom,
  createQuote,
  declineQuote,
  findQuoteMediaForServing,
  getAdminQuote,
  getMyQuote,
  listAdminQuotes,
  listMyQuotes,
  markQuoteRead,
  postCustomerQuoteMessage,
  postStaffQuoteMessage,
  quoteOrderCodeToPay,
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
  QuoteReadDto,
  QuotePayDto,
  QuotePageDto,
  QuoteRulesDto,
  SendOfferSchema,
  WithdrawQuoteSchema,
} from '@mechdost/shared/quote-api';
import {
  QUOTE_ATTACH_MAX,
  QUOTE_CODE_RE,
  QUOTE_CUSTOMER_MESSAGES_PER_HOUR,
  QUOTE_UPLOAD_WINDOW_SECONDS,
  QUOTE_UPLOADS_PER_WINDOW,
} from '@mechdost/shared/quote-rules';
import { PHOTO_MAX_BYTES } from '@mechdost/shared/service-photos';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, errorBody } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import { formFiles, signQuotePhoto, storeImages, uploadKit, type UploadKit } from '../photos/message-upload';
import { verifyPhotoUrl } from '../photos/url-token';
import { ensureRazorpayOrder } from '../payments/service';
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
/** Photo messages per person per window (an upload is the expensive call); counted once per upload. */
export const QUOTE_UPLOAD_RATE: RateRule = {
  name: 'quote_upload_user',
  limit: QUOTE_UPLOADS_PER_WINDOW,
  windowSeconds: QUOTE_UPLOAD_WINDOW_SECONDS,
};
const IMAGE_RATE: RateRule = { name: 'quote_photo_read_ip', limit: 600, windowSeconds: 60 };

/** Four photos of the upload limit each, plus multipart framing and the text field. */
const PHOTO_MESSAGE_BODY_MAX = QUOTE_ATTACH_MAX * PHOTO_MAX_BYTES + 256 * 1024;
const MessageText = QuoteMessageSchema.shape.body;
const tooLarge = bodyLimit({
  maxSize: PHOTO_MESSAGE_BODY_MAX,
  onError: (c) => c.json(errorBody(c, 'PHOTO_TOO_LARGE', 'The photos are too big'), 413),
});

/** The text and the photos of a multipart photo message (a message with photos has at least one). */
async function photoMessageForm(c: Context<AppEnv>): Promise<{ text: string; files: File[] }> {
  const type = (c.req.header('content-type') ?? '').toLowerCase();
  if (!type.startsWith('multipart/form-data'))
    throw new ApiError(422, 'PHOTO_TYPE', 'Send the message as a form');
  const form = await c.req.parseBody({ all: true });
  const text = MessageText.safeParse(form.body);
  if (!text.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Write a message of up to 1000 characters');
  const files = formFiles(form.file, QUOTE_ATTACH_MAX, PHOTO_MAX_BYTES);
  if (files.length === 0) throw new ApiError(422, 'PHOTO_TYPE', 'Add at least one photo');
  return { text: text.data, files };
}

/** A thread with its photos as short-lived signed URLs (issued only after the caller's rights were checked). */
function withPhotoUrls(view: Awaited<ReturnType<typeof getMyQuote>>, keyring: UploadKit['keyring'] | null) {
  return {
    ...view,
    messages: view.messages.map(({ attachments, ...m }) => ({
      ...m,
      attachments: keyring
        ? attachments.map((a) => ({
            id: a.mediaId,
            width: a.width,
            height: a.height,
            ...signQuotePhoto(keyring, a.mediaId),
          }))
        : [],
    })),
  };
}

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

const read = createRoute({
  method: 'post',
  path: '/quotes/{code}/read',
  tags: ['quotes'],
  summary: 'Mark the thread as read (the newest message you have now seen; never moves back)',
  security: secured,
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(QuoteReadDto, 'Marked'), ...errorResponses },
});

const accept = createRoute({
  method: 'post',
  path: '/quotes/{code}/accept',
  tags: ['quotes'],
  summary:
    'Accept the active offer version (cash on delivery or online) → a normal order; Idempotency-Key required',
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

const pay = createRoute({
  method: 'post',
  path: '/quotes/{code}/pay',
  tags: ['quotes'],
  summary:
    'Pay now: the Razorpay handle of the accepted quote’s unpaid online order (the same order every time)',
  security: secured,
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(QuotePayDto, 'Handle (null once paid or expired)'), ...conflict, ...errorResponses },
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
  // "Pay now" may create a Razorpay order: same limit as accepting.
  app.on(
    'POST',
    '/quotes/:code/pay',
    rateLimit(deps.rateLimiter, QUOTE_ACCEPT_RATE, (c) => c.get('auth').user.id),
  );
  const me = (c: Context<AppEnv>) => c.get('auth').user.id;

  // A message with photos. Multipart: body + file x 1..4 (not an OpenAPI route; its own, larger body limit). Rights
  // and state first (404 / 409 before any image work), then the pipeline, then the message in one transaction.
  app.post(
    '/quotes/:code/photo-messages',
    rateLimit(deps.rateLimiter, QUOTE_MESSAGE_RATE, (c) => me(c)),
    tooLarge,
    async (c) => {
      const code = Code.safeParse(c.req.param('code'));
      if (!code.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const { text, files } = await photoMessageForm(c);
      const kit = uploadKit(deps);
      await assertCanAttachToQuote(deps.db, { userId: me(c) }, code.data);
      await enforceRate(c, deps.rateLimiter, QUOTE_UPLOAD_RATE, me(c));
      const stored = await storeImages(files, kit, 'quote');
      try {
        const done = await postCustomerQuoteMessage(deps.db, {
          userId: me(c),
          code: code.data,
          body: text,
          images: stored.images,
        });
        return c.json(done, 200);
      } catch (err) {
        await stored.cleanup();
        throw err;
      }
    },
  );

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
        c.json(
          withPhotoUrls(
            await getMyQuote(deps.db, me(c), c.req.valid('param').code, c.req.valid('query').locale),
            deps.keyring ?? null,
          ),
          200,
        ),
      )
      .openapi(read, async (c) =>
        c.json(
          await markQuoteRead(deps.db, { side: 'customer', userId: me(c), code: c.req.valid('param').code }),
          200,
        ),
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
        const razorpay = deps.razorpay ?? null;
        // Refused before anything is placed: an unpaid online order must never exist without a way to pay it.
        if (b.paymentMethod === 'online' && !razorpay)
          throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not available yet');
        const r = await acceptQuoteOffer(deps.db, {
          userId: me(c),
          code: c.req.valid('param').code,
          offerVersion: b.offerVersion,
          idempotencyKey: c.req.valid('header')['idempotency-key'],
          locale: b.locale,
          paymentMethod: b.paymentMethod,
        });
        // The Razorpay order exists (stored, one open per group) before the client sees it; a retry reuses it, and a
        // replay of an accept whose Razorpay call failed creates it now.
        const handle =
          r.paymentMethod === 'online' && razorpay
            ? await ensureRazorpayOrder(deps.db, razorpay, { userId: me(c), groupCode: r.orderCode })
            : undefined;
        return c.json(handle === undefined ? r : { ...r, razorpay: handle }, r.replayed ? 200 : 201);
      })
      .openapi(pay, async (c) => {
        const razorpay = deps.razorpay ?? null;
        if (!razorpay)
          throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Online payment is not available yet');
        const orderCode = await quoteOrderCodeToPay(deps.db, {
          userId: me(c),
          code: c.req.valid('param').code,
        });
        const handle = await ensureRazorpayOrder(deps.db, razorpay, { userId: me(c), groupCode: orderCode });
        return c.json({ orderCode, razorpay: handle }, 200);
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

const adminRead = createRoute({
  method: 'post',
  path: '/admin/quotes/{code}/read',
  tags: ['admin'],
  summary: 'Mark the thread as read by the MechDost team (never moves back)',
  security: secured,
  request: { params: z.object({ code: Code }) },
  responses: { 200: json(QuoteReadDto, 'Marked'), ...errorResponses },
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

  // The staff reply with photos (same pipeline and limits as the customer's).
  app.post(
    '/admin/quotes/:code/photo-messages',
    rateLimit(deps.rateLimiter, QUOTE_MESSAGE_RATE, (c) => staff(c)),
    tooLarge,
    async (c) => {
      const code = Code.safeParse(c.req.param('code'));
      if (!code.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const { text, files } = await photoMessageForm(c);
      const kit = uploadKit(deps);
      const where = scope(c, 'quotes:negotiate');
      await assertCanAttachToQuote(deps.db, { scope: where }, code.data);
      await enforceRate(c, deps.rateLimiter, QUOTE_UPLOAD_RATE, staff(c));
      const stored = await storeImages(files, kit, 'quote');
      try {
        const done = await postStaffQuoteMessage(deps.db, {
          scope: where,
          staffUserId: staff(c),
          code: code.data,
          body: text,
          images: stored.images,
        });
        return c.json(done, 200);
      } catch (err) {
        await stored.cleanup();
        throw err;
      }
    },
  );

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
        withPhotoUrls(
          await getAdminQuote(
            deps.db,
            scope(c, 'quotes:read'),
            c.req.valid('param').code,
            c.req.valid('query').locale,
          ),
          deps.keyring ?? null,
        ),
        200,
      ),
    )
    .openapi(adminRead, async (c) =>
      c.json(
        await markQuoteRead(deps.db, {
          side: 'staff',
          scope: scope(c, 'quotes:negotiate'),
          userId: staff(c),
          code: c.req.valid('param').code,
        }),
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

/**
 * The image route of quote photos: the signed URL (10 minutes, one photo) is the capability, so it sits outside the
 * sign-in stack like job and support photos. Anything else is 404, never a hint why.
 */
export function quotePhotoRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.get(
    '/quote-photos/:mediaId/:variant',
    rateLimit(deps.rateLimiter, IMAGE_RATE, (c) => c.get('clientIp')),
    async (c) => {
      const kit = uploadKit(deps);
      const mediaId = z.uuid().safeParse(c.req.param('mediaId'));
      const variant = z.enum(['thumb', 'large']).safeParse(c.req.param('variant'));
      if (!mediaId.success || !variant.success) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const exp = Number(c.req.query('e'));
      const sig = c.req.query('s');
      if (sig === undefined || !verifyPhotoUrl(kit.keyring, mediaId.data, exp, sig))
        throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const media = await findQuoteMediaForServing(deps.db, mediaId.data);
      if (!media) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      const bytes = await kit.storage.get(variant.data === 'thumb' ? media.thumbPath : media.path);
      if (!bytes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'image/webp',
        'Content-Disposition': 'inline; filename="photo.webp"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });
    },
  );
  return app;
}
