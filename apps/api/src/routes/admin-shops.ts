import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addShopMember,
  cityScopeFrom,
  getAdminShop,
  issuePartnerWarning,
  listAdminShops,
  listPartnerWarningsForAdmin,
  setShopCoverage,
  setShopStanding,
  updateShopProfile,
  ValidationError,
  withdrawPartnerWarning,
} from '@mechdost/db/repo';
import {
  AdminPartnerWarnings,
  IssueWarningSchema,
  WarningIssued,
  WithdrawWarningSchema,
} from '@mechdost/shared/partner-warnings';
import {
  AdminShopDetail,
  AdminShopList,
  SHOP_STATUSES,
  ShopCoverageSchema,
  ShopMemberAdded,
  ShopMemberSchema,
  ShopProfilePatchSchema,
  ShopStandingSaved,
  ShopStandingSchema,
  ShopVersion,
} from '@mechdost/shared/shop-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';
import { registerAdminShopInventory } from './shop-inventory';

/**
 * Admin → Partners → Shops (specs 07/08 "Real API mode"; decision 2026-11-14 "Shop management"). Verified staff,
 * city-scoped (a shop elsewhere is 404): read with `partners:read`; edit the profile, coverage and offers with
 * `partners:write`; pause / suspend / reactivate and portal access with `partners:approve` (in the shop's city).
 * A GSTIN change is an approval too (checked against the approve scope in the repository). One router owns
 * `/admin/shops/*`, so each request is authenticated and rate-counted once (L54).
 */
const ShopId = z.uuid().openapi({ param: { name: 'shopId', in: 'path' } });

const list = createRoute({
  method: 'get',
  path: '/admin/shops',
  tags: ['admin'],
  summary: 'Shops in your cities by name (cursor), with standing, coverage and offers on sale',
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      status: z.enum(SHOP_STATUSES).optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: { 200: json(AdminShopList.openapi('AdminShopList'), 'Shops'), ...conflict, ...errorResponses },
});

const detail = createRoute({
  method: 'get',
  path: '/admin/shops/{shopId}',
  tags: ['admin'],
  summary: 'One shop: profile, hours, coverage per PIN, standing history, portal members (masked)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId }) },
  responses: {
    200: json(AdminShopDetail.openapi('AdminShopDetail'), 'Shop'),
    ...conflict,
    ...errorResponses,
  },
});

const patch = createRoute({
  method: 'patch',
  path: '/admin/shops/{shopId}',
  tags: ['admin'],
  summary: 'Edit the profile (only the fields sent; compare-and-set on version). GSTIN needs approval rights',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(ShopProfilePatchSchema.openapi('ShopProfilePatch')),
  },
  responses: { 200: json(ShopVersion, 'Saved'), ...conflict, ...errorResponses },
});

const coverage = createRoute({
  method: 'put',
  path: '/admin/shops/{shopId}/coverage',
  tags: ['admin'],
  summary: "Add or change delivery PIN codes (charge, days, on/off) and remove others (the shop's city only)",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(ShopCoverageSchema.openapi('ShopCoverage')),
  },
  responses: { 200: json(ShopVersion, 'Saved'), ...conflict, ...errorResponses },
});

const standing = createRoute({
  method: 'post',
  path: '/admin/shops/{shopId}/standing',
  tags: ['admin'],
  summary: 'Pause, suspend or reactivate with a reason code and a note the shop reads (history kept)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(ShopStandingSchema.openapi('ShopStanding')),
  },
  responses: { 200: json(ShopStandingSaved, 'Saved'), ...conflict, ...errorResponses },
});

const member = createRoute({
  method: 'post',
  path: '/admin/shops/{shopId}/members',
  tags: ['admin'],
  summary: 'Give a signed-up person (by phone) owner or staff access to the shop portal',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(ShopMemberSchema.openapi('ShopMember')),
  },
  responses: { 200: json(ShopMemberAdded, 'Granted'), ...conflict, ...errorResponses },
});

const warningsList = createRoute({
  method: 'get',
  path: '/admin/shops/{shopId}/warnings',
  tags: ['admin'],
  summary: 'Warnings given to the shop in the window, how many count, and whether to consider a pause',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ shopId: ShopId }) },
  responses: { 200: json(AdminPartnerWarnings, 'Warnings'), ...conflict, ...errorResponses },
});

const warningIssue = createRoute({
  method: 'post',
  path: '/admin/shops/{shopId}/warnings',
  tags: ['admin'],
  summary: 'Warn the shop with a reason code (a note the shop reads; required for "other")',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ shopId: ShopId }),
    body: body(IssueWarningSchema),
  },
  responses: { 200: json(WarningIssued, 'Issued'), ...conflict, ...errorResponses },
});

const warningWithdraw = createRoute({
  method: 'post',
  path: '/admin/shops/{shopId}/warnings/{warningId}/withdraw',
  tags: ['admin'],
  summary: 'Withdraw a warning given by mistake (it stays in the history, marked withdrawn)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      shopId: ShopId,
      warningId: z.uuid().openapi({ param: { name: 'warningId', in: 'path' } }),
    }),
    body: body(WithdrawWarningSchema),
  },
  responses: { 200: json(AdminPartnerWarnings, 'Withdrawn'), ...conflict, ...errorResponses },
});

export function adminShopRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // '/admin/shops/*' also matches '/admin/shops' (Hono): one pattern, so nothing runs twice.
  app.use('/admin/shops/*', authenticate(deps, cache));
  app.use(
    '/admin/shops/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/shops/*', requireVerified);
  app.use('/admin/shops/*', requirePermission('partners:read'));
  app.on(['POST', 'PATCH', 'PUT'], '/admin/shops/*', requirePermission('partners:write'));
  app.on('POST', '/admin/shops/:shopId/standing', requirePermission('partners:approve'));
  app.on('POST', '/admin/shops/:shopId/members', requirePermission('partners:approve'));
  // Warnings are a disciplinary step, like pausing: same permission and city scope.
  app.on('POST', '/admin/shops/:shopId/warnings', requirePermission('partners:approve'));
  app.on('POST', '/admin/shops/:shopId/warnings/:warningId/withdraw', requirePermission('partners:approve'));

  registerAdminShopInventory(app, deps);

  return app
    .openapi(list, async (c) => {
      const q = c.req.valid('query');
      const page = await listAdminShops(deps.db, cityScopeFrom(c.get('auth').grants, 'partners:read'), {
        status: q.status ?? null,
        cursor: q.cursor ?? null,
        ...(q.limit === undefined ? {} : { limit: q.limit }),
      });
      return c.json(page, 200);
    })
    .openapi(detail, async (c) => {
      const scope = cityScopeFrom(c.get('auth').grants, 'partners:read');
      return c.json(await getAdminShop(deps.db, scope, c.req.valid('param').shopId), 200);
    })
    .openapi(patch, async (c) => {
      const { version, ...changes } = c.req.valid('json');
      const grants = c.get('auth').grants;
      const r = await updateShopProfile(deps.db, {
        scope: cityScopeFrom(grants, 'partners:write'),
        approveScope: cityScopeFrom(grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        shopId: c.req.valid('param').shopId,
        expectedVersion: version,
        patch: changes,
        keyring: deps.keyring ?? null,
      });
      return c.json(r, 200);
    })
    .openapi(coverage, async (c) => {
      const b = c.req.valid('json');
      const r = await setShopCoverage(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:write'),
        staffUserId: c.get('auth').user.id,
        shopId: c.req.valid('param').shopId,
        expectedVersion: b.version,
        upsert: b.upsert,
        remove: b.remove,
      });
      return c.json(r, 200);
    })
    .openapi(standing, async (c) => {
      const b = c.req.valid('json');
      if (b.pausedUntil && Date.parse(b.pausedUntil) <= Date.now())
        throw new ValidationError('A pause ends in the future', 'STATUS_ENDS_AT');
      const r = await setShopStanding(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        shopId: c.req.valid('param').shopId,
        to: b.status,
        reasonCode: b.reasonCode,
        reason: b.note,
        staffUserId: c.get('auth').user.id,
        expectedVersion: b.version,
        pausedUntil: b.pausedUntil ? new Date(b.pausedUntil) : null,
      });
      return c.json(r, 200);
    })
    .openapi(warningsList, async (c) => {
      const scope = cityScopeFrom(c.get('auth').grants, 'partners:read');
      return c.json(
        await listPartnerWarningsForAdmin(deps.db, scope, 'shop', c.req.valid('param').shopId),
        200,
      );
    })
    .openapi(warningIssue, async (c) => {
      const b = c.req.valid('json');
      const r = await issuePartnerWarning(deps.db, {
        kind: 'shop',
        partnerId: c.req.valid('param').shopId,
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        reasonCode: b.reasonCode,
        note: b.note ?? null,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(warningWithdraw, async (c) => {
      const p = c.req.valid('param');
      const r = await withdrawPartnerWarning(deps.db, {
        kind: 'shop',
        partnerId: p.shopId,
        warningId: p.warningId,
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        note: c.req.valid('json').note,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(member, async (c) => {
      const b = c.req.valid('json');
      const r = await addShopMember(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        shopId: c.req.valid('param').shopId,
        phone: b.phone,
        role: b.role,
      });
      return c.json(r, 200);
    });
}
