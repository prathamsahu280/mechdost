import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { log } from '../logger';
import {
  activeBlockLevels,
  ensureUser,
  globalFlagSetting,
  linkApplicantOwner,
  loadGrants,
  sessionStateByKey,
  touchSessionActive,
} from '@mechdost/db/repo';
import { DEVICE_ACTIVE_REFRESH_MS } from '@mechdost/shared/devices';
import { isStaffGrant, STAFF_SESSION_MAX_AGE_SECONDS } from '@mechdost/shared/auth';
import { blockEffects } from '@mechdost/shared/customers';
import { can, isSellerAccount, type Permission, type Target } from '@mechdost/shared/rbac';
import type { SessionCache } from '../auth/session-cache';
import { TokenError } from '../auth/token-verifier';
import { ApiError, Forbidden, Unauthorized } from '../errors';
import type { AppDeps, AppEnv } from '../types';

export const BEARER = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

async function verifyOrThrow(verifier: AppDeps['verifier'], token: string, checkRevoked: boolean) {
  try {
    return await verifier.verify(token, { checkRevoked });
  } catch (err) {
    if (err instanceof TokenError) {
      if (err.code === 'USER_DISABLED') throw Forbidden('ACCOUNT_DISABLED', 'This account is disabled');
      throw Unauthorized(err.code, 'Your session is invalid or expired — sign in again');
    }
    throw err;
  }
}

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

    // The global API limit has already verified this token (no revocation check); a route that wants the revocation
    // check, or a request without that step, verifies here.
    const pre = c.get('verifiedToken');
    const identity =
      !checkRevoked && pre?.token === token
        ? pre.identity
        : await verifyOrThrow(deps.verifier, token, checkRevoked);

    // `authTime` is in the key: token refreshes of one sign-in share the entry, while every new sign-in loads the
    // user's roles, status and blocks again on every instance (a role granted moments ago works on next sign-in).
    // The device-list session (claim `mds`) is part of the key: each sign-in has its own entry, so ending one device
    // never depends on another's. Only a prefix of the key is used; the entry lives in this instance's memory only.
    const key = `${identity.firebaseUid}|${String(identity.authTime)}|${identity.phone ?? ''}|${identity.email ?? ''}|${String(identity.emailVerified)}|${identity.sessionKey?.slice(0, 16) ?? ''}`;
    let session = cache.get(key);
    if (!session) {
      // Revocation (sign out everywhere, password reset) and accounts disabled in Firebase are checked whenever
      // the session is loaded, so they apply within the cache period on every route at one network call per
      // user per period (security review 2026-11-14: no route checked it before).
      if (!checkRevoked) await verifyOrThrow(deps.verifier, token, true);
      const user = await ensureUser(deps.db, identity);
      // An approved seller applicant becomes the owner of their shop on sign-in (the phone was proved by OTP).
      if (
        identity.phone &&
        (await linkApplicantOwner(deps.db, { userId: user.id, phone: identity.phone })) > 0
      )
        log('info', 'applicant_owner_linked', { userId: user.id });
      // Device list (decision 2026-11-28): a token that carries a session key is valid only while its row is live
      // and the person's own. Tokens without one (phone-code sessions, sign-ins from before the device list) skip
      // this. Checked on the cache-miss path only, so an ended device is out within the cache period.
      let sessionId: string | null = null;
      if (identity.sessionKey) {
        const state = await sessionStateByKey(deps.db, identity.sessionKey);
        if (!state || state.revoked || state.userId !== user.id)
          throw Unauthorized('SESSION_ENDED', 'This sign-in was ended — sign in again');
        sessionId = state.id;
        // Last active, at most hourly: a failure here is logged and never fails the request.
        if (Date.now() - state.lastActiveAt.getTime() >= DEVICE_ACTIVE_REFRESH_MS) {
          try {
            await touchSessionActive(deps.db, state.id);
          } catch (err) {
            log('warn', 'session_touch_failed', { message: err instanceof Error ? err.message : 'unknown' });
          }
        }
      }
      session = {
        user,
        grants: await loadGrants(deps.db, user.id),
        blocks: await activeBlockLevels(deps.db, user.id),
        sessionId,
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
      sessionId: session.sessionId,
    });
    await next();
  });
}

/**
 * Shop accounts cannot buy (user 2026-11-22): runs after `authenticate` on every customer buying route (cart writes,
 * checkout, coupon check, bulk quotes). Any shop role refuses, even when the person also holds a MechDost staff role.
 */
export const forbidSellers = createMiddleware<AppEnv>(async (c, next) => {
  if (isSellerAccount(c.get('auth').grants))
    throw Forbidden(
      'SELLER_CANNOT_ORDER',
      'Shop accounts cannot place orders. Sign in with a customer account.',
    );
  await next();
});

/**
 * The same refusal for a route that is public for guests (the checkout quote): when the request carries a sign-in
 * that is valid, a shop account is refused; a missing or invalid token is a guest, as before.
 */
export function forbidSignedInSellers(deps: Pick<AppDeps, 'db' | 'verifier'>, cache: SessionCache) {
  const auth = authenticate(deps, cache);
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.req.header('authorization')) return next();
    const found = { seller: false };
    try {
      await auth(c, () => {
        found.seller = isSellerAccount(c.get('auth').grants);
        return Promise.resolve();
      });
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
    }
    if (found.seller)
      throw Forbidden(
        'SELLER_CANNOT_ORDER',
        'Shop accounts cannot place orders. Sign in with a customer account.',
      );
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
 * Customer actions (ordering, booking, reviewing): a verified phone always; a verified email only when the admin
 * switches on `customers.require_verified_email` (off by default, user 2026-11-14). Staff and partner routes keep
 * `requireVerified` (both).
 */
export function requireCustomerVerified(deps: Pick<AppDeps, 'db'>) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const { user } = c.get('auth');
    const emailNeeded =
      !user.emailVerifiedAt && (await globalFlagSetting(deps.db, 'customers.require_verified_email'));
    if (!user.phoneVerifiedAt || emailNeeded) {
      throw new ApiError(403, 'VERIFICATION_REQUIRED', 'Verify your phone number and email to continue', {
        phoneVerified: Boolean(user.phoneVerifiedAt),
        emailVerified: Boolean(user.emailVerifiedAt),
      });
    }
    await next();
  });
}

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
