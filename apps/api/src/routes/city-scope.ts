import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { cityIdByCode, cityScopeFrom, NotFoundError } from '@mechdost/db/repo';
import type { Permission } from '@mechdost/shared/rbac';
import { Forbidden } from '../errors';
import type { AppDeps, AppEnv } from '../types';

/**
 * Platform-wide screens (staff, customers, audit log) belong to no city: a city-scoped grant is refused with
 * `SCOPE_REQUIRED`, an all-cities grant passes.
 */
export const requireAllCities = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!cityScopeFrom(c.get('auth').grants, permission).all)
      throw Forbidden('SCOPE_REQUIRED', 'This needs an all-cities role');
    await next();
  });

/**
 * The city a staff member may act on for `permission` (null = the global value). A global value needs an
 * all-cities grant; a city needs a grant covering it; anything else is 404, like other out-of-scope targets.
 * Shared by the admin settings and content routes.
 */
export async function scopedCity(
  deps: AppDeps,
  c: Context<AppEnv>,
  code: string | null | undefined,
  permission: Permission,
): Promise<string | null> {
  const scope = cityScopeFrom(c.get('auth').grants, permission);
  if (!code) {
    if (!scope.all) throw new NotFoundError('Not found');
    return null;
  }
  const id = await cityIdByCode(deps.db, code);
  if (!scope.all && !scope.cityIds.includes(id)) throw new NotFoundError('City not found');
  return id;
}
