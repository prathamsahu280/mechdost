import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { activeBlockLevels, ensureUser, loadGrants } from '@mechdost/db/repo';
import { isStaffGrant, STAFF_SESSION_MAX_AGE_SECONDS } from '@mechdost/shared/auth';
import { blockEffects } from '@mechdost/shared/customers';
import { can, type Permission, type Target } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import { TokenError } from '../auth/token-verifier';
import { ApiError, Forbidden, Unauthorized } from '../errors';
import type { AppDeps, AppEnv } from '../types';

export const BEARER = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

/**
 * Verify the Firebase ID token, load (or auto-provision) the user and their grants
 * (skill firebase-phone-auth-rbac). Identity comes only from the verified token — never from the body.
 */
export function authenticate(
  deps: Pick<AppDeps, 'db' | 'verifier'>,
  cache: SessionCache,
  opts: { checkRevoked?: boolean } = {},
) {
  const checkRevoked = opts.checkRevoked ?? false;
  return createMiddleware<AppEnv>(async (c, next) => {
    const match = BEARER.exec(c.req.header('authorization') ?? '');
    const token = match?.[1];
    if (!token) throw Unauthorized();

    let identity;
    try {
      identity = await deps.verifier.verify(token, { checkRevoked });
    } catch (err) {
      if (err instanceof TokenError) {
        if (err.code === 'USER_DISABLED') throw Forbidden('ACCOUNT_DISABLED', 'This account is disabled');
        throw Unauthorized(err.code, 'Your session is invalid or expired — sign in again');
      }
      throw err;
    }

    const key = `${identity.firebaseUid}|${identity.phone ?? ''}|${identity.email ?? ''}|${String(identity.emailVerified)}`;
    let session = cache.get(key);
    if (!session) {
      const user = await ensureUser(deps.db, identity);
      session = {
        user,
        grants: await loadGrants(deps.db, user.id),
        blocks: await activeBlockLevels(deps.db, user.id),
      };
      cache.set(key, session);
    }
    if (session.user.status !== 'active')
      throw Forbidden('ACCOUNT_DEACTIVATED', 'This account is not active');
    // A `full` customer block (shared/customers.ts) refuses every signed-in request; it applies within the
    // session-cache TTL like role changes (Q29).
    if (!blockEffects(session.blocks).signIn) throw Forbidden('ACCOUNT_BLOCKED', 'This account is blocked');

    // Staff permissions need the two-step staff session (password + fresh phone code, decision 2026-11-01),
    // at most one working day old. Any other session of a staff member keeps only the non-staff grants, so a
    // phone code alone (sign-up / reset path) never opens the admin side.
    const staffSession =
      identity.staff2fa && Date.now() / 1000 - identity.authTime <= STAFF_SESSION_MAX_AGE_SECONDS;
    const staffWithheld = staffSession ? [] : session.grants.filter(isStaffGrant);
    c.set('auth', {
      user: session.user,
      grants: staffSession ? session.grants : session.grants.filter((g) => !isStaffGrant(g)),
      authTime: identity.authTime,
      staffWithheld,
    });
    await next();
  });
}

/** Ordering, booking, partner and staff actions need both phone and email verified (spec 01). */
export const requireVerified = createMiddleware<AppEnv>(async (c, next) => {
  const { user } = c.get('auth');
  if (!user.phoneVerifiedAt || !user.emailVerifiedAt) {
    throw new ApiError(403, 'VERIFICATION_REQUIRED', 'Verify your phone number and email to continue', {
      phoneVerified: Boolean(user.phoneVerifiedAt),
      emailVerified: Boolean(user.emailVerifiedAt),
    });
  }
  await next();
});

/**
 * Permission gate (spec 13). `target` names the city/shop/workshop being acted on when the route knows it;
 * repositories still scope every query by the actor (cross-tenant ids → 404, not 403).
 */
export function requirePermission(permission: Permission, target?: (c: Context<AppEnv>) => Target) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth');
    const t = target ? target(c) : {};
    if (!can(auth.grants, permission, t)) {
      if (can(auth.staffWithheld, permission, t))
        throw Forbidden('STAFF_2FA_REQUIRED', 'Sign in with your password and the code sent to your phone');
      throw Forbidden();
    }
    await next();
  });
}
