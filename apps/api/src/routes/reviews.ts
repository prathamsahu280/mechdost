import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  cityScopeFrom,
  listPublicReviews,
  listReviewQueue,
  moderateReview,
  myReviewTargets,
  PUBLIC_REVIEWS_MAX,
  REVIEW_QUEUE_MAX,
  submitReview,
  type ReviewPurchase,
} from '@mechdost/db/repo';
import {
  REVIEW_BODY_MAX,
  REVIEW_DAILY_LIMIT,
  REVIEW_HIDE_REASONS,
  REVIEW_NOTE_MAX,
  REVIEW_STATES,
  REVIEW_TARGETS,
} from '@mechdost/shared/reviews';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Customer reviews (spec 02 § Reviews; decision 2026-10-31: verified purchase only, staff approve before publish).
 *
 * - Public: `GET /reviews/{product|workshop}/{slug}` — approved reviews (newest first, cursor) + rating summary;
 *   per-IP limit; cached briefly (60 s) by browsers, the CDN and the website's fetch cache.
 * - Customer (`reviews:write`): `GET /my-reviews/eligible?order|service` lists what one delivered order or
 *   paid service lets them review; `POST /my-reviews` writes one (verified account; spec 13 velocity
 *   5 a day, also enforced in the database transaction).
 * - Staff (`reviews:moderate`, verified, city-scoped): `GET /admin/reviews?status`, `POST
 *   /admin/reviews/{id}/moderate` (state machine, compare-and-set on version, reason code to hide).
 *
 * Review text is user content: plain text, at most 1000 characters, never logged.
 */
const PUBLIC_RATE: RateRule = { name: 'reviews_ip', limit: 120, windowSeconds: 60 };
/**
 * Spec 13 "Reviews/tickets/forms 5/user/day": the database counts the accepted reviews per 24 h
 * (`REVIEW_DAILY_LIMIT`); this rule caps attempts (invalid ones included) so a script cannot hammer the endpoint.
 */
export const REVIEW_WRITE_RATE: RateRule = {
  name: 'review_write',
  limit: REVIEW_DAILY_LIMIT * 4,
  windowSeconds: 3600,
};
const CACHE = 'public, max-age=60, stale-while-revalidate=300';

const Slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const OrderCode = z.string().regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
const ServiceCode = z.string().regex(/^SR-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/);
const Cursor = z.string().min(1).max(256);
const Status = z.enum(REVIEW_STATES);
const Target = z.enum(REVIEW_TARGETS);

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const conflict = {
  404: json(ErrorSchema, 'Not found (or not yours)'),
  409: json(ErrorSchema, 'Already reviewed, or changed meanwhile'),
  422: json(ErrorSchema, 'A business rule was not met'),
};

const Summary = z.object({
  avg: z.number().nullable(),
  count: z.number().int(),
  distribution: z.array(z.number().int()).length(5),
});

const PublicReview = z.object({
  id: z.string(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  createdAt: z.string(),
});

const PublicReviews = z
  .object({ summary: Summary, reviews: z.array(PublicReview), nextCursor: z.string().nullable() })
  .openapi('PublicReviews');

const MyReview = z.object({
  id: z.string(),
  rating: z.number().int(),
  body: z.string().nullable(),
  status: Status,
  createdAt: z.string(),
});

const Targets = z
  .object({
    targets: z.array(
      z.object({ targetType: Target, slug: z.string(), name: z.string(), review: MyReview.nullable() }),
    ),
  })
  .openapi('ReviewTargets');

const NewReview = z
  .object({
    orderCode: OrderCode.optional(),
    serviceCode: ServiceCode.optional(),
    targetType: Target,
    targetSlug: Slug,
    rating: z.number().int().min(1).max(5),
    body: z.string().max(REVIEW_BODY_MAX).nullable().optional(),
  })
  .strict()
  .refine((b) => (b.orderCode === undefined) !== (b.serviceCode === undefined), {
    message: 'Give exactly one of orderCode or serviceCode',
  })
  .openapi('ReviewCreate');

const AdminReview = z.object({
  id: z.string(),
  targetType: Target,
  targetSlug: z.string(),
  targetName: z.string(),
  rating: z.number().int(),
  body: z.string().nullable(),
  author: z.string().nullable(),
  status: Status,
  hiddenReason: z.enum(REVIEW_HIDE_REASONS).nullable(),
  note: z.string().nullable(),
  orderCode: z.string().nullable(),
  serviceCode: z.string().nullable(),
  createdAt: z.string(),
  moderatedAt: z.string().nullable(),
  version: z.number().int(),
});

const Moderate = z
  .object({
    to: z.enum(['approved', 'hidden']),
    reasonCode: z.enum(REVIEW_HIDE_REASONS).optional(),
    note: z.string().max(REVIEW_NOTE_MAX).optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .openapi('ReviewModerate');

const Moderated = z.object({ status: Status, version: z.number().int() }).openapi('ReviewModerated');

const publicList = createRoute({
  method: 'get',
  path: '/reviews/{targetType}/{slug}',
  tags: ['reviews'],
  summary: 'Approved reviews of a live product or published workshop, newest first, with the rating summary',
  request: {
    params: z.object({
      targetType: Target.openapi({ param: { name: 'targetType', in: 'path' } }),
      slug: Slug.openapi({ param: { name: 'slug', in: 'path' }, example: 'castrol-activ-4t-20w40' }),
    }),
    query: z.object({
      cursor: Cursor.optional(),
      limit: z.coerce.number().int().min(1).max(PUBLIC_REVIEWS_MAX).optional(),
    }),
  },
  responses: {
    200: json(PublicReviews, 'Reviews'),
    404: json(ErrorSchema, 'No such public product or workshop'),
    422: json(ErrorSchema, 'Invalid cursor'),
    ...errorResponses,
  },
});

const eligible = createRoute({
  method: 'get',
  path: '/my-reviews/eligible',
  tags: ['reviews'],
  summary: 'What one of your delivered orders or paid services lets you review, with what you already wrote',
  security: [{ bearerAuth: [] }],
  request: {
    query: z
      .object({
        order: OrderCode.optional(),
        service: ServiceCode.optional(),
        locale: z.enum(['en', 'hi']).default('en'),
      })
      .refine((q) => (q.order === undefined) !== (q.service === undefined), {
        message: 'Give exactly one of order or service',
      }),
  },
  responses: { 200: json(Targets, 'Targets'), ...conflict, ...errorResponses },
});

const create = createRoute({
  method: 'post',
  path: '/my-reviews',
  tags: ['reviews'],
  summary: 'Review a product you received or a workshop that serviced your vehicle (pending until approved)',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: NewReview } } } },
  responses: {
    201: json(z.object({ id: z.string(), status: Status }).openapi('ReviewCreated'), 'Created'),
    ...conflict,
    ...errorResponses,
  },
});

const queue = createRoute({
  method: 'get',
  path: '/admin/reviews',
  tags: ['admin'],
  summary: 'Review moderation queue in your cities (pending oldest first; approved/hidden newest first)',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: Status.default('pending'),
      cursor: Cursor.optional(),
      limit: z.coerce.number().int().min(1).max(REVIEW_QUEUE_MAX).optional(),
    }),
  },
  responses: {
    200: json(
      z.object({ reviews: z.array(AdminReview), nextCursor: z.string().nullable() }).openapi('AdminReviews'),
      'Queue',
    ),
    422: json(ErrorSchema, 'Invalid cursor'),
    ...errorResponses,
  },
});

const moderate = createRoute({
  method: 'post',
  path: '/admin/reviews/{id}/moderate',
  tags: ['admin'],
  summary: 'Approve or hide a review (state machine, compare-and-set on version; hiding needs a reason code)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) }),
    body: { required: true, content: { 'application/json': { schema: Moderate } } },
  },
  responses: { 200: json(Moderated, 'Moderated'), ...conflict, ...errorResponses },
});

/** Public review lists: per-IP limit on top of the global one. */
export function reviewPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/reviews/*',
    rateLimit(deps.rateLimiter, PUBLIC_RATE, (c) => c.get('clientIp')),
  );
  return app.openapi(publicList, async (c) => {
    const { targetType, slug } = c.req.valid('param');
    const q = c.req.valid('query');
    const page = await listPublicReviews(deps.db, {
      targetType,
      slug,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    c.header('Cache-Control', CACHE);
    return c.json(page, 200);
  });
}

/** The customer's reviews and the staff moderation queue. */
export function reviewRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern each: '/my-reviews/*' also matches '/my-reviews'.
  for (const path of ['/my-reviews/*', '/admin/reviews/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.use('/my-reviews/*', requirePermission('reviews:write'));
  app.on('POST', '/my-reviews', requireVerified);
  app.on(
    'POST',
    '/my-reviews',
    rateLimit(deps.rateLimiter, REVIEW_WRITE_RATE, (c) => c.get('auth').user.id),
  );
  app.use('/admin/reviews/*', requireVerified);
  app.use('/admin/reviews/*', requirePermission('reviews:moderate'));

  return app
    .openapi(eligible, async (c) => {
      const q = c.req.valid('query');
      const purchase: ReviewPurchase = q.order ? { orderCode: q.order } : { serviceCode: q.service ?? '' };
      const targets = await myReviewTargets(deps.db, {
        userId: c.get('auth').user.id,
        purchase,
        locale: q.locale,
      });
      return c.json({ targets }, 200);
    })
    .openapi(create, async (c) => {
      const b = c.req.valid('json');
      const purchase: ReviewPurchase = b.orderCode
        ? { orderCode: b.orderCode }
        : { serviceCode: b.serviceCode ?? '' };
      const created = await submitReview(deps.db, {
        userId: c.get('auth').user.id,
        purchase,
        targetType: b.targetType,
        targetSlug: b.targetSlug,
        rating: b.rating,
        body: b.body ?? null,
      });
      return c.json(created, 201);
    })
    .openapi(queue, async (c) => {
      const q = c.req.valid('query');
      const page = await listReviewQueue(deps.db, cityScopeFrom(c.get('auth').grants, 'reviews:moderate'), {
        status: q.status,
        ...(q.cursor ? { cursor: q.cursor } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
      });
      return c.json(page, 200);
    })
    .openapi(moderate, async (c) => {
      const b = c.req.valid('json');
      const result = await moderateReview(deps.db, cityScopeFrom(c.get('auth').grants, 'reviews:moderate'), {
        staffUserId: c.get('auth').user.id,
        id: c.req.valid('param').id,
        to: b.to,
        reasonCode: b.reasonCode ?? null,
        note: b.note ?? null,
        expectedVersion: b.version,
      });
      return c.json(result, 200);
    });
}
