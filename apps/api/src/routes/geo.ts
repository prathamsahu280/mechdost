import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  addPincode,
  cityCodeOfPincode,
  listActivePincodes,
  listCityPincodes,
  NotFoundError,
  setPincodeActive,
  updatePincode,
} from '@mechdost/db/repo';
import {
  FREE_DELIVERY_MAX_PAISE,
  INDIA_BOUNDS,
  PINCODE_AREA_MAX,
  PINCODE_AREA_MIN,
  PINCODE_INACTIVE_REASONS,
  PINCODE_NOTE_MAX,
  PINCODE_RE,
  PINCODE_SOURCES,
} from '@mechdost/shared/geo';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { scopedCity } from './city-scope';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * Service-area PIN codes (spec 15 "PIN codes", spec 08 "Settings"). Public: a live city's active PIN codes (staff
 * pickers, PIN suggestions), per-IP limit, short CDN cache. Staff (verified, city-scoped): `settings:read` lists a
 * city's PIN codes, `cities:manage` adds, edits (centroid, English + Hindi area, free-delivery threshold) and
 * switches a PIN on or off with a reason code. Writes are compare-and-set on `version` and audited; an inactive PIN
 * is refused by checkout, nearby workshops, service requests and shop coverage.
 */
export const PINCODES_RATE: RateRule = { name: 'pincodes_ip', limit: 60, windowSeconds: 60 };
const CACHE = 'public, max-age=300, stale-while-revalidate=600';

const CityCode = z.string().regex(/^[A-Z]{3}$/);
const Pin = z.string().regex(PINCODE_RE);
const Lat = z.number().min(INDIA_BOUNDS.minLat).max(INDIA_BOUNDS.maxLat);
const Lng = z.number().min(INDIA_BOUNDS.minLng).max(INDIA_BOUNDS.maxLng);
const Area = z.string().trim().min(PINCODE_AREA_MIN).max(PINCODE_AREA_MAX);
const FreeMin = z.number().int().min(0).max(FREE_DELIVERY_MAX_PAISE).nullable();

const AdminRow = z
  .object({
    pincode: z.string(),
    areaEn: z.string().nullable(),
    areaHi: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    active: z.boolean(),
    inactiveReason: z.enum(PINCODE_INACTIVE_REASONS).nullable(),
    inactiveNote: z.string().nullable(),
    source: z.enum(PINCODE_SOURCES),
    freeDeliveryMinPaise: z.number().int().nullable(),
    shopsCovering: z.number().int(),
    version: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi('AdminPincode');
const Saved = z.object({ pincode: z.string(), version: z.number().int() }).openapi('PincodeSaved');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const writeErrors = {
  404: json(ErrorSchema, 'Unknown PIN code or city out of scope'),
  409: json(ErrorSchema, 'PINCODE_EXISTS / STALE_PINCODE'),
  422: json(
    ErrorSchema,
    'PINCODE_INVALID / PINCODE_AREA / PINCODE_OUTSIDE_INDIA / PINCODE_FAR_FROM_CITY / PINCODE_REASON / PINCODE_NO_CENTROID',
  ),
};

const publicList = createRoute({
  method: 'get',
  path: '/cities/{city}/pincodes',
  tags: ['geo'],
  summary: "A live city's active PIN codes with the area name in the requested language",
  request: {
    params: z.object({ city: CityCode.openapi({ param: { name: 'city', in: 'path' }, example: 'RPR' }) }),
    query: z.object({ locale: z.enum(['en', 'hi']).default('en') }),
  },
  responses: {
    200: json(
      z
        .object({
          city: z.string(),
          pincodes: z.array(
            z.object({
              pincode: z.string(),
              area: z.string().nullable(),
              lat: z.number().nullable(),
              lng: z.number().nullable(),
            }),
          ),
        })
        .openapi('PublicPincodeList'),
      'Active PIN codes',
    ),
    404: json(ErrorSchema, 'Unknown or not live city'),
    ...errorResponses,
  },
});

const adminList = createRoute({
  method: 'get',
  path: '/admin/pincodes',
  tags: ['admin'],
  summary: "A city's PIN codes (active or not) with area names, centroid and shop coverage",
  description:
    'Name the city by its code, or by one of its PIN codes (the PIN of an application, for the approval form).',
  security: [{ bearerAuth: [] }],
  request: {
    query: z
      .object({ city: CityCode.optional(), pincode: Pin.optional() })
      .refine((q) => (q.city === undefined) !== (q.pincode === undefined), {
        message: 'Give either city or pincode',
      }),
  },
  responses: {
    200: json(
      z.object({
        city: z.object({ code: z.string(), name: z.string(), nameHi: z.string().nullable() }),
        pincodes: z.array(AdminRow),
      }),
      'PIN codes',
    ),
    404: json(ErrorSchema, 'City out of scope'),
    ...errorResponses,
  },
});

const add = createRoute({
  method: 'post',
  path: '/admin/pincodes',
  tags: ['admin'],
  summary: 'Add a PIN code to a city (active)',
  security: [{ bearerAuth: [] }],
  request: {
    body: body(
      z
        .object({
          city: CityCode,
          pincode: Pin,
          lat: Lat,
          lng: Lng,
          areaEn: Area,
          areaHi: Area,
          freeDeliveryMinPaise: FreeMin.default(null),
        })
        .strict()
        .openapi('AdminPincodeAdd'),
    ),
  },
  responses: { 200: json(Saved, 'Added'), ...writeErrors, ...errorResponses },
});

const PinParam = z.object({
  pincode: Pin.openapi({ param: { name: 'pincode', in: 'path' }, example: '492001' }),
});

const edit = createRoute({
  method: 'patch',
  path: '/admin/pincodes/{pincode}',
  tags: ['admin'],
  summary: 'Change the centroid, the area names (both languages) and/or the free-delivery threshold',
  security: [{ bearerAuth: [] }],
  request: {
    params: PinParam,
    body: body(
      z
        .object({
          city: CityCode,
          version: z.number().int().min(1),
          centroid: z.object({ lat: Lat, lng: Lng }).strict().optional(),
          area: z.object({ en: Area, hi: Area }).strict().optional(),
          freeDeliveryMinPaise: FreeMin.optional(),
        })
        .strict()
        .refine(
          (b) => b.centroid !== undefined || b.area !== undefined || b.freeDeliveryMinPaise !== undefined,
          { message: 'Nothing to change' },
        )
        .openapi('AdminPincodeEdit'),
    ),
  },
  responses: { 200: json(Saved, 'Saved'), ...writeErrors, ...errorResponses },
});

const status = createRoute({
  method: 'post',
  path: '/admin/pincodes/{pincode}/status',
  tags: ['admin'],
  summary: 'Switch a PIN code on, or off with a reason code (and an optional note)',
  security: [{ bearerAuth: [] }],
  request: {
    params: PinParam,
    body: body(
      z
        .discriminatedUnion('active', [
          z.object({ city: CityCode, version: z.number().int().min(1), active: z.literal(true) }).strict(),
          z
            .object({
              city: CityCode,
              version: z.number().int().min(1),
              active: z.literal(false),
              reason: z.enum(PINCODE_INACTIVE_REASONS),
              note: z.string().trim().max(PINCODE_NOTE_MAX).nullable().default(null),
            })
            .strict(),
        ])
        .openapi('AdminPincodeStatus'),
    ),
  },
  responses: { 200: json(Saved, 'Saved'), ...writeErrors, ...errorResponses },
});

/** Public read: per-IP limit on top of the global one. */
export function pincodePublicRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  app.use(
    '/cities/*',
    rateLimit(deps.rateLimiter, PINCODES_RATE, (c) => c.get('clientIp')),
  );
  return app.openapi(publicList, async (c) => {
    const city = c.req.valid('param').city;
    const pincodes = await listActivePincodes(deps.db, city, c.req.valid('query').locale);
    c.header('Cache-Control', CACHE);
    return c.json({ city, pincodes }, 200);
  });
}

/** Staff PIN code management (verified staff, city-scoped). */
export function pincodeAdminRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const prefix = '/admin/pincodes/*'; // one pattern per prefix (L54); also matches '/admin/pincodes'
  app.use(prefix, authenticate(deps, cache));
  app.use(
    prefix,
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
  );
  app.use(prefix, requireVerified);
  app.use(prefix, requirePermission('settings:read'));
  app.on(['POST', 'PATCH'], prefix, requirePermission('cities:manage'));

  /** The city id the caller may manage, else 404 (a code is always given: PIN codes belong to one city). */
  const cityFor = async (c: Parameters<typeof scopedCity>[1], code: string, write: boolean) => {
    const id = await scopedCity(deps, c, code, write ? 'cities:manage' : 'settings:read');
    if (!id) throw new NotFoundError('City not found');
    return id;
  };

  return app
    .openapi(adminList, async (c) => {
      const q = c.req.valid('query');
      const code = q.city ?? (await cityCodeOfPincode(deps.db, q.pincode ?? ''));
      const cityId = await cityFor(c, code, false);
      const { city, pincodes } = await listCityPincodes(deps.db, cityId);
      return c.json(
        {
          city,
          pincodes: pincodes.map((r) => AdminRow.parse({ ...r, updatedAt: r.updatedAt.toISOString() })),
        },
        200,
      );
    })
    .openapi(add, async (c) => {
      const b = c.req.valid('json');
      const cityId = await cityFor(c, b.city, true);
      const r = await addPincode(deps.db, {
        cityId,
        pincode: b.pincode,
        lat: b.lat,
        lng: b.lng,
        areaEn: b.areaEn,
        areaHi: b.areaHi,
        freeDeliveryMinPaise: b.freeDeliveryMinPaise,
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(edit, async (c) => {
      const b = c.req.valid('json');
      const cityId = await cityFor(c, b.city, true);
      const r = await updatePincode(deps.db, {
        cityId,
        pincode: c.req.valid('param').pincode,
        expectedVersion: b.version,
        ...(b.centroid && { centroid: b.centroid }),
        ...(b.area && { area: b.area }),
        ...(b.freeDeliveryMinPaise !== undefined && { freeDeliveryMinPaise: b.freeDeliveryMinPaise }),
        staffUserId: c.get('auth').user.id,
      });
      return c.json(r, 200);
    })
    .openapi(status, async (c) => {
      const b = c.req.valid('json');
      const cityId = await cityFor(c, b.city, true);
      const common = {
        cityId,
        pincode: c.req.valid('param').pincode,
        expectedVersion: b.version,
        staffUserId: c.get('auth').user.id,
      };
      const r = b.active
        ? await setPincodeActive(deps.db, { ...common, active: true })
        : await setPincodeActive(deps.db, { ...common, active: false, reason: b.reason, note: b.note });
      return c.json(r, 200);
    });
}
