import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  createAddress,
  createVehicle,
  deleteAddress,
  deleteVehicle,
  fitVariantForUser,
  listAddresses,
  listVehicles,
  setDefaultAddress,
  updateAddress,
  updateVehicle,
  type AccountLocale,
} from '@mechdost/db/repo';
import {
  AddressCreateDto,
  AddressDefaultDto,
  AddressDto,
  AddressesDto,
  AddressPatchDto,
  DeletedDto,
  VehicleCreateDto,
  VehicleDto,
  VehicleFitDto,
  VehiclePatchDto,
  VehiclesDto,
} from '@mechdost/shared/account-api';
import { CATALOGUE_SLUG_RE } from '@mechdost/shared/catalogue';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * The signed-in customer's saved addresses and vehicles (design 2026-11-15; spec 01). Every route is the caller's
 * own data only: the repository takes the user id from the session, never from the URL, so another customer's id
 * is 404. Writes are limited per customer (spec 13: no unbounded writes) and compare-and-set on `version`.
 */
export const ACCOUNT_WRITE_RATE: RateRule = { name: 'account_write', limit: 60, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const problems = {
  404: json(ErrorSchema, 'Not found (or not yours)'),
  409: json(ErrorSchema, 'Changed elsewhere, or a duplicate'),
  422: json(ErrorSchema, 'A business rule was not met (limit, unknown PIN)'),
  ...errorResponses,
};

const Id = z.uuid().openapi({ param: { name: 'id', in: 'path' } });
const params = z.object({ id: Id });
const localeQuery = z.object({ locale: z.enum(['en', 'hi']).optional() });
const deleteQuery = z.object({ version: z.coerce.number().int().min(1) });
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const tags = ['account'];
const security = [{ bearerAuth: [] }];

const listAddressesRoute = createRoute({
  method: 'get',
  path: '/me/addresses',
  tags,
  summary: 'Your saved addresses (oldest first; city and state follow the locale)',
  security,
  request: { query: localeQuery },
  responses: { 200: json(AddressesDto, 'Addresses'), ...errorResponses },
});
const createAddressRoute = createRoute({
  method: 'post',
  path: '/me/addresses',
  tags,
  summary: 'Save an address (up to 10); city and state come from the PIN',
  security,
  request: { query: localeQuery, ...body(AddressCreateDto) },
  responses: { 201: json(AddressDto, 'Saved'), ...problems },
});
const updateAddressRoute = createRoute({
  method: 'patch',
  path: '/me/addresses/{id}',
  tags,
  summary: 'Edit a saved address (send the version you last read)',
  security,
  request: { params, query: localeQuery, ...body(AddressPatchDto) },
  responses: { 200: json(AddressDto, 'Saved'), ...problems },
});
const defaultAddressRoute = createRoute({
  method: 'post',
  path: '/me/addresses/{id}/default',
  tags,
  summary: 'Make an address the default for shipping or billing',
  security,
  request: { params, query: localeQuery, ...body(AddressDefaultDto) },
  responses: { 200: json(AddressDto, 'Saved'), ...problems },
});
const deleteAddressRoute = createRoute({
  method: 'delete',
  path: '/me/addresses/{id}',
  tags,
  summary: 'Delete a saved address (send the version you last read as ?version=)',
  security,
  request: { params, query: deleteQuery },
  responses: { 200: json(DeletedDto, 'Deleted'), ...problems },
});

const listVehiclesRoute = createRoute({
  method: 'get',
  path: '/me/vehicles',
  tags,
  summary: 'Your saved vehicles (oldest first)',
  security,
  responses: { 200: json(VehiclesDto, 'Vehicles'), ...errorResponses },
});
const vehicleFitRoute = createRoute({
  method: 'get',
  path: '/me/vehicles/fit',
  tags,
  summary: 'Which size of a product fits your saved vehicles (the size only, never the fitment list)',
  security,
  request: { query: z.object({ product: z.string().regex(CATALOGUE_SLUG_RE) }) },
  responses: { 200: json(VehicleFitDto, 'The fitting size, or none'), ...problems },
});
const createVehicleRoute = createRoute({
  method: 'post',
  path: '/me/vehicles',
  tags,
  summary: 'Save a vehicle (up to 10)',
  security,
  request: body(VehicleCreateDto),
  responses: { 201: json(VehicleDto, 'Saved'), ...problems },
});
const updateVehicleRoute = createRoute({
  method: 'patch',
  path: '/me/vehicles/{id}',
  tags,
  summary: 'Edit a saved vehicle (send the version you last read)',
  security,
  request: { params, ...body(VehiclePatchDto) },
  responses: { 200: json(VehicleDto, 'Saved'), ...problems },
});
const deleteVehicleRoute = createRoute({
  method: 'delete',
  path: '/me/vehicles/{id}',
  tags,
  summary: 'Delete a saved vehicle (send the version you last read as ?version=)',
  security,
  request: { params, query: deleteQuery },
  responses: { 200: json(DeletedDto, 'Deleted'), ...problems },
});

export function accountRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern each: '/me/addresses/*' also matches '/me/addresses'.
  for (const path of ['/me/addresses/*', '/me/vehicles/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
    app.on(
      ['POST', 'PATCH', 'DELETE'],
      path,
      rateLimit(deps.rateLimiter, ACCOUNT_WRITE_RATE, (c) => c.get('auth').user.id),
    );
  }
  const localeOf = (c: { get: (k: 'auth') => { user: { language: string } } }, asked?: AccountLocale) =>
    asked ?? (c.get('auth').user.language === 'hi' ? 'hi' : 'en');

  return app
    .openapi(listAddressesRoute, async (c) => {
      const addresses = await listAddresses(
        deps.db,
        c.get('auth').user.id,
        localeOf(c, c.req.valid('query').locale),
      );
      return c.json({ addresses }, 200);
    })
    .openapi(createAddressRoute, async (c) => {
      const created = await createAddress(
        deps.db,
        c.get('auth').user.id,
        c.req.valid('json'),
        localeOf(c, c.req.valid('query').locale),
      );
      return c.json(created, 201);
    })
    .openapi(updateAddressRoute, async (c) => {
      const { version, ...changes } = c.req.valid('json');
      const saved = await updateAddress(
        deps.db,
        c.get('auth').user.id,
        c.req.valid('param').id,
        version,
        changes,
        localeOf(c, c.req.valid('query').locale),
      );
      return c.json(saved, 200);
    })
    .openapi(defaultAddressRoute, async (c) => {
      const { version, kind } = c.req.valid('json');
      const saved = await setDefaultAddress(
        deps.db,
        c.get('auth').user.id,
        c.req.valid('param').id,
        version,
        kind,
        localeOf(c, c.req.valid('query').locale),
      );
      return c.json(saved, 200);
    })
    .openapi(deleteAddressRoute, async (c) => {
      await deleteAddress(
        deps.db,
        c.get('auth').user.id,
        c.req.valid('param').id,
        c.req.valid('query').version,
      );
      return c.json({ deleted: true as const }, 200);
    })
    .openapi(listVehiclesRoute, async (c) =>
      c.json({ vehicles: await listVehicles(deps.db, c.get('auth').user.id) }, 200),
    )
    .openapi(vehicleFitRoute, async (c) =>
      c.json(await fitVariantForUser(deps.db, c.get('auth').user.id, c.req.valid('query').product), 200),
    )
    .openapi(createVehicleRoute, async (c) =>
      c.json(await createVehicle(deps.db, c.get('auth').user.id, c.req.valid('json')), 201),
    )
    .openapi(updateVehicleRoute, async (c) => {
      const { version, ...changes } = c.req.valid('json');
      return c.json(
        await updateVehicle(deps.db, c.get('auth').user.id, c.req.valid('param').id, version, changes),
        200,
      );
    })
    .openapi(deleteVehicleRoute, async (c) => {
      await deleteVehicle(
        deps.db,
        c.get('auth').user.id,
        c.req.valid('param').id,
        c.req.valid('query').version,
      );
      return c.json({ deleted: true as const }, 200);
    });
}
