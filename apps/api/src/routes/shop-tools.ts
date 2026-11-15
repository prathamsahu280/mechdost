import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  applyShopCsv,
  getApplicationStatus,
  getPackingSlip,
  getShopPerformance,
  NotFoundError,
  previewShopCsv,
  shopCsvTemplateFor,
  shopIdsFrom,
} from '@mechdost/db/repo';
import { SHOP_CSV_MAX_BYTES } from '@mechdost/shared/shop-csv';
import {
  ApplicationStatusBody,
  ApplicationStatusDto,
  PackingSlip,
  ShopCsvApplied,
  ShopCsvPreview,
  ShopPerformance,
} from '@mechdost/shared/shop-tools';
import type { SessionCache } from '../auth/session-cache';
import { TokenError } from '../auth/token-verifier';
import { ApiError, errorBody, Forbidden, Unauthorized } from '../errors';
import { authenticate, BEARER, requirePermission, requireVerified } from '../middleware/auth';
import { enforceRate, rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Shop portal next tier, part 2 (design 2026-11-15 items 4 to 7; spec 07, 13):
 * - the stock and price CSV (`/shop/csv/{shopId}/…`: template, check, apply; shop owner and staff of that shop);
 * - the packing slip (`/shop/slip/{code}`; owner and staff, only while the shop is fulfilling the order);
 * - performance (`/shop/performance/{shopId}`; the owner only, 403 `OWNER_ONLY` for staff);
 * - the public application status lookup (`POST /partner-applications/status`: reference + a phone proved by a
 *   one-time code, shown the stage only).
 * A shop outside the caller's grants is a 404 everywhere. The CSV upload is multipart with its own body limit (1 MB of
 * file) and a per-user hourly limit; the file is read as text and never executed or echoed.
 */
export const SHOP_CSV_RATE: RateRule = { name: 'shop_csv_user', limit: 30, windowSeconds: 3600 };
export const STATUS_LOOKUP_IP: RateRule = { name: 'partner_status_ip', limit: 30, windowSeconds: 3600 };
export const STATUS_LOOKUP_PHONE: RateRule = { name: 'partner_status_phone', limit: 10, windowSeconds: 3600 };
/** A little over the file limit: the multipart envelope. */
const UPLOAD_BODY_MAX = SHOP_CSV_MAX_BYTES + 64 * 1024;
/** Changes listed in a check (the counts are complete). */
const PREVIEW_LIST_MAX = 200;

const ShopId = z.uuid().openapi({ param: { name: 'shopId', in: 'path' } });
const Code = z
  .string()
  .regex(/^MD-[A-Z0-9]{2,6}-\d{4}-[0-9A-Z]{6}(-\d{1,3})?$/)
  .openapi({ param: { name: 'code', in: 'path' } });

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const slip = createRoute({
  method: 'get',
  path: '/shop/slip/{code}',
  tags: ['shop'],
  summary:
    'Packing slip data: items, quantities, delivery PIN and area, first name and masked phone (no prices)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ code: Code }) },
  responses: {
    200: json(PackingSlip, 'Slip'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'The order is not being fulfilled by this shop now'),
    ...errorResponses,
  },
});

const performance = createRoute({
  method: 'get',
  path: '/shop/performance/{shopId}',
  tags: ['shop'],
  summary: 'The owner’s performance page: 30 and 90 days next to the anonymous city median',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId }) },
  responses: {
    200: json(ShopPerformance, 'Performance'),
    404: json(ErrorSchema, 'Not found'),
    ...errorResponses,
  },
});

/** The uploaded `file` part as text (400/413/422 for anything else); the file name and type are never trusted. */
async function readCsv(c: Context<AppEnv>): Promise<string> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data'))
    throw new ApiError(422, 'CSV_TYPE', 'Send the file as a form upload');
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new ApiError(422, 'CSV_TYPE', 'Send a CSV file in the "file" field');
  if (file.size > SHOP_CSV_MAX_BYTES)
    throw new ApiError(413, 'CSV_TOO_LARGE', 'The file is bigger than 1 MB');
  return file.text();
}

/** Excel opens a UTF-8 CSV correctly only with a byte-order mark. */
const BOM = String.fromCodePoint(0xfeff);
const phoneKey = (phone: string) => createHash('sha256').update(`partner_status:${phone}`).digest('hex');

/** Signed-in shop routes (CSV, slip, performance). */
export function shopToolsRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  for (const prefix of ['/shop/csv/*', '/shop/slip/*', '/shop/performance/*']) {
    app.use(prefix, authenticate(deps, cache));
    app.use(
      prefix,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.use(prefix, requireVerified);
  }
  app.use('/shop/csv/*', requirePermission('inventory:write'));
  app.use('/shop/slip/*', requirePermission('orders:fulfil'));
  app.use('/shop/performance/*', requirePermission('inventory:write'));

  /** A shop the caller works at (owner or staff); anything else is a 404. */
  function ownShop(c: Context<AppEnv>, shopId: string): void {
    if (!shopIdsFrom(c.get('auth').grants, 'inventory:write').includes(shopId))
      throw new NotFoundError('Shop not found');
  }
  const userId = (c: Context<AppEnv>) => c.get('auth').user.id;

  app.get('/shop/csv/:shopId/template', async (c) => {
    const shopId = ShopId.safeParse(c.req.param('shopId'));
    if (!shopId.success) throw new NotFoundError('Shop not found');
    ownShop(c, shopId.data);
    const text = await shopCsvTemplateFor(deps.db, shopId.data);
    return c.body(`${BOM}${text}`, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="mechdost-stock-template.csv"',
    });
  });

  for (const mode of ['preview', 'apply'] as const) {
    app.post(
      `/shop/csv/:shopId/${mode}`,
      rateLimit(deps.rateLimiter, SHOP_CSV_RATE, (c) => userId(c)),
      bodyLimit({
        maxSize: UPLOAD_BODY_MAX,
        onError: (c) => c.json(errorBody(c, 'CSV_TOO_LARGE', 'The file is bigger than 1 MB'), 413),
      }),
      async (c) => {
        const shopId = ShopId.safeParse(c.req.param('shopId'));
        if (!shopId.success) throw new NotFoundError('Shop not found');
        ownShop(c, shopId.data);
        const text = await readCsv(c);
        const input = { shopId: shopId.data, userId: userId(c), text };
        if (mode === 'apply') return c.json(ShopCsvApplied.parse(await applyShopCsv(deps.db, input)), 200);
        const r = await previewShopCsv(deps.db, input);
        if (!r.ok) throw new ApiError(422, `CSV_${r.code}`, 'The file cannot be read');
        return c.json(
          ShopCsvPreview.parse({
            rows: r.rows,
            unchanged: r.plan.unchanged,
            errors: r.plan.errors.slice(0, 500),
            changes: r.plan.changes.slice(0, PREVIEW_LIST_MAX).map(({ version: _v, ...rest }) => rest),
            counts: r.counts,
          }),
          200,
        );
      },
    );
  }

  return app
    .openapi(slip, async (c) =>
      c.json(
        await getPackingSlip(deps.db, {
          shopIds: shopIdsFrom(c.get('auth').grants, 'orders:fulfil'),
          code: c.req.valid('param').code,
          userId: userId(c),
        }),
        200,
      ),
    )
    .openapi(performance, async (c) => {
      const { shopId } = c.req.valid('param');
      ownShop(c, shopId);
      const grants = c.get('auth').grants;
      const owned = grants
        .filter((g) => g.role === 'seller_owner' && g.shopId !== null)
        .map((g) => g.shopId)
        .filter((id): id is string => id !== null);
      // Shop staff see the rest of the portal, not how the business is doing (design 2026-11-15).
      if (!owned.includes(shopId)) throw Forbidden('OWNER_ONLY', 'Only the shop owner can see performance');
      return c.json(
        await getShopPerformance(deps.db, { shopId, ownerShopIds: owned, userId: userId(c) }),
        200,
      );
    });
}

const statusRoute = createRoute({
  method: 'post',
  path: '/partner-applications/status',
  tags: ['partners'],
  summary:
    'Where is my application? Reference + the Firebase token of the phone you applied with; stage only',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: ApplicationStatusBody } } } },
  responses: {
    200: json(ApplicationStatusDto, 'The stage'),
    404: json(ErrorSchema, 'No application with that reference and phone'),
    ...errorResponses,
  },
});

/**
 * Public status lookup. No account exists for an applicant, so this verifies the Firebase ID token directly (no user
 * row is created) and uses only its verified phone number. Per-IP and per-phone limits; a wrong reference and a wrong
 * phone get the same 404.
 */
export function partnerStatusRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/partner-applications/status',
    rateLimit(deps.rateLimiter, STATUS_LOOKUP_IP, (c) => c.get('clientIp')),
  );
  return app.openapi(statusRoute, async (c) => {
    const token = BEARER.exec(c.req.header('authorization') ?? '')?.[1];
    if (!token) throw Unauthorized();
    let phone: string | null;
    try {
      phone = (await deps.verifier.verify(token, { checkRevoked: false })).phone;
    } catch (err) {
      if (err instanceof TokenError) throw Unauthorized(err.code, 'Confirm your phone with the code again');
      throw err;
    }
    if (!phone) throw Forbidden('PHONE_REQUIRED', 'Confirm your phone number with a code first');
    await enforceRate(c, deps.rateLimiter, STATUS_LOOKUP_PHONE, phoneKey(phone), 1);
    const row = await getApplicationStatus(deps.db, {
      code: c.req.valid('json').code,
      verifiedPhone: phone,
    });
    if (!row) throw new NotFoundError('No application found for that reference and phone');
    return c.json({ ...row, updatedAt: row.updatedAt.toISOString() }, 200);
  });
}
