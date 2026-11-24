import { createHash } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { findPasswordAccount, recordSignInAudit, recordStaffSignIn } from '@mechdost/db/repo';
import { parseSignInIdentifier, STAFF_2FA_CLAIM, STAFF_CODE_MAX_AGE_SECONDS } from '@mechdost/shared/auth';
import { PASSWORD_CHANGE_WINDOW_MS } from '../auth/email-actions';
import { announcePasswordChange } from '../auth/password-notice';
import { TokenError } from '../auth/token-verifier';
import { ApiError } from '../errors';
import { log, safeError } from '../logger';
import { BEARER } from '../middleware/auth';
import { enforceRate } from '../middleware/rate-limit';
import { RateLimitUnavailable, type RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';

/**
 * Password sign-in (spec 01 "Password sign-in", decision 2026-11-01). Phone number or email + password →
 * Firebase custom token; the browser then calls `signInWithCustomToken`. Accounts are only made by phone
 * sign-up, so this route never creates one.
 *
 * - Turnstile first, then per-IP and per-identifier limits that **fail closed** (Q18). Every attempt is counted
 *   atomically **before** Firebase is asked (security review 2026-11-09: a read-then-count let parallel guesses
 *   through), the 6th within 15 minutes is refused, and a successful sign-in clears the count — so in effect 5
 *   failures lock the identifier, known or unknown (a lock says nothing about whether an account exists).
 * - One answer for an unknown account and a wrong password, after the same Firebase call (constant work).
 * - Staff (any platform/city grant): the password alone returns `staff_code` and the account's phone; the client
 *   signs in with a phone code and repeats this call with that fresh phone ID token as Bearer → a custom token
 *   with the `staff_2fa` claim, which staff routes require (middleware/auth.ts).
 */
const SIGN_IN_PER_IP: RateRule = { name: 'auth_pw_ip', limit: 60, windowSeconds: 3600, failClosed: true };
const SIGN_IN_FAILURES: RateRule = { name: 'auth_pw_fail', limit: 5, windowSeconds: 900, failClosed: true };
/** Asked when no account matches, so unknown and known identifiers cost the same (RFC 2606 domain). */
const NO_ACCOUNT_EMAIL = 'no-account@invalid.mechdost.example';

const Body = z
  .object({
    identifier: z.string().min(1).max(254),
    password: z.string().min(1).max(256),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict()
  .openapi('PasswordSignIn');

const Result = z
  .union([
    z.object({ status: z.literal('signed_in'), customToken: z.string() }),
    z.object({ status: z.literal('staff_code'), phone: z.string() }),
  ])
  .openapi('PasswordSignInResult');

const route = createRoute({
  method: 'post',
  path: '/auth/password',
  tags: ['auth'],
  summary: 'Sign in with phone number or email + password (staff: then repeat with a fresh phone token)',
  request: { body: { required: true, content: { 'application/json': { schema: Body } } } },
  responses: {
    200: {
      description: 'Signed in, or the staff phone step',
      content: { 'application/json': { schema: Result } },
    },
    ...errorResponses,
  },
});

export const unavailable = () =>
  new ApiError(503, 'AUTH_UNAVAILABLE', 'Sign-in is unavailable right now — please try again shortly');

/** Rate-limit store errors on sign-in rules mean "refuse", never "allow" (Q18). */
/** A staff phone session may finish one staff sign-in (keyed by uid and sign-in time). */
const STAFF_CODE_ONCE: RateRule = {
  name: 'staff_code_once',
  limit: 1,
  windowSeconds: STAFF_CODE_MAX_AGE_SECONDS,
  failClosed: true,
};

export async function closed<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof RateLimitUnavailable) throw unavailable();
    throw err;
  }
}

/** Keys and audit rows never hold the typed phone/email: a hash for keys, a truncated IP for the audit. */
export const keyOf = (s: string) => createHash('sha256').update(s).digest('hex');
function truncateIp(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0');
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::`;
  return null;
}

export function authRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  return app.openapi(route, async (c) => {
    const { passwordAuth, turnstile } = deps;
    if (!passwordAuth || !turnstile) throw unavailable();
    const body = c.req.valid('json');
    const ip = c.get('clientIp');
    await closed(() => enforceRate(c, deps.rateLimiter, SIGN_IN_PER_IP, ip));

    const ident = parseSignInIdentifier(body.identifier);
    // The account lookup does not depend on the Cloudflare answer: both run at once (nothing is revealed or
    // counted before the check passes), which takes one database round trip off every sign-in.
    const lookup = ident ? findPasswordAccount(deps.db, ident) : Promise.resolve(null);
    lookup.catch(() => undefined);
    let human: boolean;
    try {
      human = await turnstile.verify(body.turnstileToken, ip);
    } catch (err) {
      log('error', 'turnstile_unavailable', safeError(err));
      throw unavailable();
    }
    if (!human) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');

    const key = keyOf(ident ? `${ident.kind}:${ident.value}` : `raw:${body.identifier.trim().toLowerCase()}`);
    const attempt = await closed(() => deps.rateLimiter.hit(SIGN_IN_FAILURES, key));
    if (!attempt.allowed) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((attempt.resetAt - Date.now()) / 1000))));
      throw new ApiError(429, 'ACCOUNT_LOCKED', 'Too many attempts — wait 15 minutes or reset your password');
    }

    const account = await lookup;
    let uid: string | null;
    try {
      // Right after sign-up the profile row has no email yet (it syncs on the next API call), but Firebase knows
      // which email the password was linked to. Only such fresh accounts make this extra call.
      const email = account ? (account.email ?? (await passwordAuth.emailOf(account.firebaseUid))) : null;
      uid = await passwordAuth.check(email ?? NO_ACCOUNT_EMAIL, body.password);
    } catch (err) {
      log('error', 'password_check_unavailable', safeError(err));
      throw unavailable();
    }

    if (uid !== account?.firebaseUid) {
      const audit = { userId: account?.userId ?? null, ipTruncated: truncateIp(ip) };
      await recordSignInAudit(deps.db, { action: 'auth.password_failed', ...audit });
      if (attempt.remaining === 0) await recordSignInAudit(deps.db, { action: 'auth.locked', ...audit });
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'That phone number or email and password do not match');
    }

    await closed(() => deps.rateLimiter.reset(SIGN_IN_FAILURES, key));
    let claims: Record<string, boolean> | undefined;
    if (account.staff) {
      const phoneToken = BEARER.exec(c.req.header('authorization') ?? '')?.[1];
      if (!phoneToken || !account.phone)
        return c.json({ status: 'staff_code' as const, phone: account.phone ?? '' }, 200);
      let t;
      try {
        t = await deps.verifier.verify(phoneToken, { checkRevoked: true });
      } catch (err) {
        if (err instanceof TokenError)
          throw new ApiError(401, 'STAFF_CODE_INVALID', 'The phone code did not work — request a new one');
        throw err;
      }
      if (t.firebaseUid !== account.firebaseUid || t.signInProvider !== 'phone')
        throw new ApiError(403, 'STAFF_CODE_MISMATCH', 'That code was for a different account');
      if (Date.now() / 1000 - t.authTime > STAFF_CODE_MAX_AGE_SECONDS)
        throw new ApiError(401, 'STAFF_CODE_EXPIRED', 'The code is too old — request a new one');
      // One phone code finishes one staff sign-in: a replay of the same phone session within its lifetime is
      // refused (security review 2026-11-14). Fails closed when the store cannot answer.
      const once = await closed(() =>
        deps.rateLimiter.hit(STAFF_CODE_ONCE, `${t.firebaseUid}:${String(t.authTime)}`),
      );
      if (!once.allowed)
        throw new ApiError(401, 'STAFF_CODE_USED', 'That code was already used — request a new one');
      claims = { [STAFF_2FA_CLAIM]: true };
      // The Staff screen's "last sign-in" (design 2026-11-15): one audit row per completed staff sign-in.
      await recordStaffSignIn(deps.db, account.userId);
    }

    let customToken: string;
    try {
      customToken = await passwordAuth.customToken(account.firebaseUid, claims);
    } catch (err) {
      log('error', 'custom_token_failed', safeError(err));
      throw unavailable();
    }
    // Catch-up for the "password changed" notice (decision 2026-11-24): the page call can be blocked or never made,
    // so the first sign-in after a change sends it too (same dedupe key, so still one mail). After the answer is
    // ready and never in its way: a failure here is only logged.
    const { emailActions } = deps;
    if (emailActions) {
      void emailActions
        .passwordChangeFor({ uid: account.firebaseUid })
        .then((change) =>
          announcePasswordChange(deps.db, change, {
            locale: account.language === 'hi' ? 'hi' : 'en',
            now: Date.now(),
            newAccountMs: PASSWORD_CHANGE_WINDOW_MS,
            recordSkip: false,
          }),
        )
        .catch((err: unknown) => {
          log('error', 'password_changed_catchup_failed', safeError(err));
        });
    }
    return c.json({ status: 'signed_in' as const, customToken }, 200);
  });
}
