import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import {
  addWorkshopMember,
  cityScopeFrom,
  createWorkshop,
  currentLabourPromiseDays,
  findNearbyWorkshops,
  getAdminWorkshop,
  getPublicWorkshop,
  listAdminWorkshops,
  setWorkshopStanding,
  updateWorkshop,
} from '@mechdost/db/repo';
import { can } from '@mechdost/shared/rbac';
import {
  CreateWorkshopSchema,
  NEARBY_DEFAULT_RADIUS_KM,
  NEARBY_MAX_RADIUS_KM,
  SERVICE_KEY_RE,
  UpdateWorkshopSchema,
  WORKSHOP_SLUG_RE,
  WorkshopMemberSchema,
  WorkshopStandingSchema,
} from '@mechdost/shared/service-requests';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import type { SessionCache } from '../auth/session-cache';
import { Forbidden } from '../errors';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';
import { body, conflict, json, Locale, PublicWorkshop } from './service-schemas';

/**
 * Workshops (spec 06, spec 08). Public: nearby bookable workshops (PostGIS, nearest first) and one workshop's page
 * with its menu — no sign-in, per-IP limit, short CDN cache. Staff (verified, city-scoped): list, add and edit
 * workshops and menus (`partners:write`), publish / verify the location and set standing or portal access
 * (`partners:approve`). Out-of-city workshops are 404.
 */
export const WORKSHOPS_RATE: RateRule = { name: 'workshops_ip', limit: 120, windowSeconds: 60 };
const CACHE = 'public, max-age=30, stale-while-revalidate=120';

const Slug = z
  .string()
  .min(3)
  .max(80)
  .regex(WORKSHOP_SLUG_RE)
  .openapi({ param: { name: 'slug', in: 'path' }, example: 'shankar-nagar-auto-hub' });
const WorkshopId = z.uuid().openapi({ param: { name: 'id', in: 'path' } });

const bool = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const nearby = createRoute({
  method: 'get',
  path: '/workshops',
  tags: ['workshops'],
  summary: 'Bookable workshops near a point (lat+lng) or a PIN code centroid, nearest first (max 50)',
  request: {
    query: z
      .object({
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        pincode: z
          .string()
          .regex(/^[1-9][0-9]{5}$/)
          .optional(),
        radiusKm: z.coerce.number().min(1).max(NEARBY_MAX_RADIUS_KM).default(NEARBY_DEFAULT_RADIUS_KM),
        vehicleType: z.enum(VEHICLE_TYPES).optional(),
        ev: bool,
        pickup: bool,
        service: z.string().max(40).regex(SERVICE_KEY_RE).optional(),
        /** `home`: workshops whose own radius covers the pin (needs lat and lng); the radius is ignored. */
        mode: z.enum(['workshop', 'home']).default('workshop'),
        locale: Locale,
      })
      .refine((q) => (q.lat !== undefined && q.lng !== undefined) || q.pincode !== undefined, {
        message: 'give lat and lng, or a pincode',
        path: ['pincode'],
      }),
  },
  responses: {
    200: json(
      z.object({
        origin: z.object({ lat: z.number(), lng: z.number() }),
        workshops: z.array(PublicWorkshop),
      }),
      'Workshops',
    ),
    422: json(ErrorSchema, 'Unknown PIN code'),
    ...errorResponses,
  },
});

const detail = createRoute({
  method: 'get',
  path: '/workshops/{slug}',
  tags: ['workshops'],
  summary: 'A bookable workshop with its active service menu',
  request: { params: z.object({ slug: Slug }), query: z.object({ locale: Locale }) },
  responses: {
    200: json(PublicWorkshop, 'Workshop'),
    404: json(ErrorSchema, 'Not found'),
    ...errorResponses,
  },
});

const AdminMenuItem = z.object({
  key: z.string(),
  title: z.string(),
  titleHi: z.string().nullable(),
  included: z.string().nullable(),
  includedHi: z.string().nullable(),
  lowPaise: z.number().int(),
  highPaise: z.number().int(),
  minMinutes: z.number().int(),
  maxMinutes: z.number().int(),
  vehicleType: z.enum(VEHICLE_TYPES).nullable(),
  active: z.boolean(),
  homeAvailable: z.boolean(),
});

const AdminWorkshop = z
  .object({
    id: z.string(),
    cityId: z.string(),
    slug: z.string(),
    name: z.string(),
    nameHi: z.string().nullable(),
    addressLine: z.string(),
    addressLineHi: z.string().nullable(),
    area: z.string(),
    areaHi: z.string().nullable(),
    pincode: z.string(),
    lat: z.number(),
    lng: z.number(),
    phone: z.string().nullable(),
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)),
    evBasic: z.boolean(),
    pickup: z.boolean(),
    hours: z.object({ open: z.string(), close: z.string(), days: z.array(z.number().int()) }),
    gstin: z.string().nullable(),
    gstRegistered: z.boolean(),
    locationVerified: z.boolean(),
    published: z.boolean(),
    status: z.enum(['approved', 'paused', 'suspended']),
    statusReason: z.string().nullable(),
    busy: z.boolean(),
    homeService: z.boolean(),
    homeRadiusKm: z.number().int(),
    homeVisitFeePaise: z.number().int(),
    version: z.number().int(),
    missingHindi: z.array(z.string()),
    menu: z.array(AdminMenuItem),
  })
  .openapi('AdminWorkshop');

const adminList = createRoute({
  method: 'get',
  path: '/admin/workshops',
  tags: ['admin'],
  summary: 'Every workshop in your cities with its full menu (Hindi gaps flagged)',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(z.object({ workshops: z.array(AdminWorkshop) }), 'Workshops'), ...errorResponses },
});

const adminGet = createRoute({
  method: 'get',
  path: '/admin/workshops/{id}',
  tags: ['admin'],
  summary: 'One workshop with its full menu',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ id: WorkshopId }) },
  responses: { 200: json(AdminWorkshop, 'Workshop'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const Saved = z.object({ id: z.string(), version: z.number().int() });

const adminCreate = createRoute({
  method: 'post',
  path: '/admin/workshops',
  tags: ['admin'],
  summary: 'Add a workshop with its menu (publishing or verifying the location needs partners:approve)',
  security: [{ bearerAuth: [] }],
  request: { body: body(CreateWorkshopSchema.openapi('CreateWorkshop')) },
  responses: {
    201: json(Saved.extend({ slug: z.string() }), 'Created'),
    ...conflict,
    ...errorResponses,
  },
});

const adminUpdate = createRoute({
  method: 'patch',
  path: '/admin/workshops/{id}',
  tags: ['admin'],
  summary:
    'Edit fields (compare-and-set on version); `menu` replaces the menu by key (left-out keys switch off)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: WorkshopId }),
    body: body(UpdateWorkshopSchema.openapi('UpdateWorkshop')),
  },
  responses: { 200: json(Saved, 'Saved'), ...conflict, ...errorResponses },
});

const adminStanding = createRoute({
  method: 'post',
  path: '/admin/workshops/{id}/standing',
  tags: ['admin'],
  summary: 'Pause, suspend or reactivate with a reason (history kept); paused workshops take no new requests',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: WorkshopId }),
    body: body(WorkshopStandingSchema.openapi('WorkshopStanding')),
  },
  responses: {
    200: json(z.object({ status: z.string(), version: z.number().int() }), 'Saved'),
    ...conflict,
    ...errorResponses,
  },
});

const adminMember = createRoute({
  method: 'post',
  path: '/admin/workshops/{id}/members',
  tags: ['admin'],
  summary: 'Give a signed-up person (by phone) owner or staff access to the workshop portal',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ id: WorkshopId }),
    body: body(WorkshopMemberSchema.openapi('WorkshopMember')),
  },
  responses: { 200: json(z.object({ userId: z.string() }), 'Granted'), ...conflict, ...errorResponses },
});

/** Public reads: per-IP limit on top of the global one. */
export function workshopPublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/workshops/*',
    rateLimit(deps.rateLimiter, WORKSHOPS_RATE, (c) => c.get('clientIp')),
  );
  return app
    .openapi(nearby, async (c) => {
      const q = c.req.valid('query');
      const r = await findNearbyWorkshops(deps.db, {
        at:
          q.lat !== undefined && q.lng !== undefined
            ? { lat: q.lat, lng: q.lng }
            : { pincode: q.pincode ?? '' },
        radiusKm: q.radiusKm,
        vehicleType: q.vehicleType ?? null,
        ev: q.ev,
        pickup: q.pickup,
        serviceKey: q.service ?? null,
        mode: q.mode,
        locale: q.locale,
      });
      c.header('Cache-Control', CACHE);
      return c.json(r, 200);
    })
    .openapi(detail, async (c) => {
      const w = await getPublicWorkshop(deps.db, c.req.valid('param').slug, c.req.valid('query').locale);
      c.header('Cache-Control', CACHE);
      return c.json({ ...w, labourPromiseDays: await currentLabourPromiseDays(deps.db) }, 200);
    });
}

/** Staff workshop management (verified staff, city-scoped). */
export function workshopAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern: '/admin/workshops/*' also matches '/admin/workshops' (no double rate counting).
  app.use('/admin/workshops/*', authenticate(deps, cache));
  app.use(
    '/admin/workshops/*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use('/admin/workshops/*', requireVerified);
  app.use('/admin/workshops/*', requirePermission('partners:read'));
  app.on(['POST', 'PATCH'], '/admin/workshops/*', requirePermission('partners:write'));
  app.on('POST', '/admin/workshops/:id/standing', requirePermission('partners:approve'));
  app.on('POST', '/admin/workshops/:id/members', requirePermission('partners:approve'));

  /** Listing a workshop (published) or vouching for its pin is an approval, not an edit. */
  const needsApproval = (c: Context<AppEnv>, b: { published?: boolean; locationVerified?: boolean }) => {
    if (
      (b.published === true || b.locationVerified === true) &&
      !can(c.get('auth').grants, 'partners:approve')
    )
      throw Forbidden('FORBIDDEN', 'Publishing a workshop or verifying its location needs approval rights');
  };

  return app
    .openapi(adminList, async (c) => {
      const scope = cityScopeFrom(c.get('auth').grants, 'partners:read');
      return c.json({ workshops: await listAdminWorkshops(deps.db, scope) }, 200);
    })
    .openapi(adminGet, async (c) => {
      const scope = cityScopeFrom(c.get('auth').grants, 'partners:read');
      return c.json(await getAdminWorkshop(deps.db, scope, c.req.valid('param').id), 200);
    })
    .openapi(adminCreate, async (c) => {
      const b = c.req.valid('json');
      needsApproval(c, b);
      const r = await createWorkshop(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:write'),
        approveScope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        workshop: b,
      });
      return c.json(r, 201);
    })
    .openapi(adminUpdate, async (c) => {
      const b = c.req.valid('json');
      needsApproval(c, b);
      const r = await updateWorkshop(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:write'),
        approveScope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        workshopId: c.req.valid('param').id,
        patch: b,
      });
      return c.json(r, 200);
    })
    .openapi(adminStanding, async (c) => {
      const b = c.req.valid('json');
      const r = await setWorkshopStanding(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        workshopId: c.req.valid('param').id,
        status: b.status,
        reason: b.reason,
        expectedVersion: b.version,
      });
      return c.json(r, 200);
    })
    .openapi(adminMember, async (c) => {
      const b = c.req.valid('json');
      const r = await addWorkshopMember(deps.db, {
        scope: cityScopeFrom(c.get('auth').grants, 'partners:approve'),
        staffUserId: c.get('auth').user.id,
        workshopId: c.req.valid('param').id,
        phone: b.phone,
        role: b.role,
      });
      return c.json(r, 200);
    });
}
