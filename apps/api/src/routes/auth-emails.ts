import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { queueAuthActionEmail, recordAuthActionSkipped } from '@mechdost/db/repo';
import { isAnnounceable, NEW_ACCOUNT_MS } from '../auth/email-actions';
import { announcePasswordChange, RecentChangeCache } from '../auth/password-notice';
import { ApiError } from '../errors';
import { log, safeError } from '../logger';
import { authenticate } from '../middleware/auth';
import { enforceRate } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { SessionCache } from '../auth/session-cache';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { closed, keyOf, unavailable } from './auth';
import { errorResponses } from './schemas';

/**
 * The account emails we send ourselves (decision 2026-11-24, spec 01 "Account emails"): Firebase refuses a custom
 * action URL (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`), so the Admin SDK makes the one-time code and the email goes
 * through the outbox and Resend with a link to `{WEB_BASE_URL}/auth/action`.
 *
 * - `POST /v1/auth/password-reset-email` (public): per-IP limit → Turnstile → per-address limit (counted for every
 *   address before any lookup) → code → outbox. The answer is the same `200 accepted` whether or not an account
 *   exists, the address is over its limit, or Firebase failed (logged, never shown), and a minimum duration hides
 *   the difference in work. Limits and Turnstile fail closed.
 * - `POST /v1/auth/verification-email` (signed in): the address comes from the Firebase account of the caller, never
 *   from the request; already verified → `not_needed`.
 * - `POST /v1/auth/password-changed` (public): the "your password was changed" notice. The browser changes the
 *   password with Firebase, so the page tells us afterwards; we never trust that and ask Firebase when the account's
 *   password last changed (`passwordChangeFor`), sending only for a change in the last 10 minutes, once per change
 *   (outbox dedupe key). No Turnstile on purpose: the caller has just proved control of the address (a reset code or
 *   the current password), the answer is always the same, and a request cannot make a mail that Firebase's own
 *   record does not justify, so abuse is capped at one mail per real change; per-IP and per-address limits (fail
 *   closed) bound the Firebase lookups.
 * Changing the address (`verifyBeforeUpdateEmail`, mode `verifyAndChangeEmail`) is not used by the app, so it has no
 * route; the action page still handles such links.
 */
const RESET_PER_IP: RateRule = { name: 'auth_reset_ip', limit: 10, windowSeconds: 3600, failClosed: true };
const RESET_PER_EMAIL: RateRule = {
  name: 'auth_reset_email',
  limit: 3,
  windowSeconds: 3600,
  failClosed: true,
};
const VERIFY_PER_USER: RateRule = {
  name: 'auth_verify_user',
  limit: 5,
  windowSeconds: 3600,
  failClosed: true,
};
const CHANGED_PER_IP: RateRule = {
  name: 'auth_changed_ip',
  limit: 20,
  windowSeconds: 3600,
  failClosed: true,
};
/** Every reset answer takes at least this long, so an unknown address does not answer visibly faster. */
const RESET_MIN_MS = 600;

const Locale = z.enum(['en', 'hi']);

const ResetBody = z
  .object({
    email: z.string().max(254).trim().toLowerCase().pipe(z.email()),
    locale: Locale,
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict()
  .openapi('PasswordResetEmailRequest');

const ChangedBody = z
  .object({ email: z.string().max(254).trim().toLowerCase().pipe(z.email()), locale: Locale })
  .strict()
  .openapi('PasswordChangedRequest');

const VerifyBody = z.object({ locale: Locale.optional() }).strict().openapi('VerificationEmailRequest');

const resetRoute = createRoute({
  method: 'post',
  path: '/auth/password-reset-email',
  tags: ['auth'],
  summary: 'Email a password reset link (the same answer for every address)',
  request: { body: { required: true, content: { 'application/json': { schema: ResetBody } } } },
  responses: {
    200: {
      description: 'Accepted (says nothing about whether the address has an account)',
      content: { 'application/json': { schema: z.object({ status: z.literal('accepted') }) } },
    },
    ...errorResponses,
  },
});

const changedRoute = createRoute({
  method: 'post',
  path: '/auth/password-changed',
  tags: ['auth'],
  summary: 'Tell the account holder their password was changed (the same answer for every address)',
  request: { body: { required: true, content: { 'application/json': { schema: ChangedBody } } } },
  responses: {
    200: {
      description: 'Accepted (says nothing about whether a notice was sent)',
      content: { 'application/json': { schema: z.object({ status: z.literal('accepted') }) } },
    },
    ...errorResponses,
  },
});

const verifyRoute = createRoute({
  method: 'post',
  path: '/auth/verification-email',
  tags: ['auth'],
  summary: 'Email the signed-in account a link to confirm its email address',
  security: [{ bearerAuth: [] }],
  request: { body: { required: true, content: { 'application/json': { schema: VerifyBody } } } },
  responses: {
    200: {
      description: 'Sent, or nothing to send (the address is already verified)',
      content: { 'application/json': { schema: z.object({ status: z.enum(['sent', 'not_needed']) }) } },
    },
    ...errorResponses,
  },
});

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function authEmailRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const minMs = deps.config.env === 'test' ? 0 : RESET_MIN_MS;
  app.use('/auth/verification-email', authenticate(deps, cache));
  const recentChanges = new RecentChangeCache();

  return app
    .openapi(resetRoute, async (c) => {
      const { emailActions, turnstile } = deps;
      if (!emailActions || !turnstile) throw unavailable();
      const body = c.req.valid('json');
      const ip = c.get('clientIp');
      const started = Date.now();
      await closed(() => enforceRate(c, deps.rateLimiter, RESET_PER_IP, ip));
      let human: boolean;
      try {
        human = await turnstile.verify(body.turnstileToken, ip);
      } catch (err) {
        log('error', 'turnstile_unavailable', safeError(err));
        throw unavailable();
      }
      if (!human) throw new ApiError(400, 'TURNSTILE_FAILED', 'Complete the check and try again');

      // Counted for every address before any lookup; past the limit the answer stays the same and nothing is sent.
      const turn = await closed(() => deps.rateLimiter.hit(RESET_PER_EMAIL, keyOf(body.email)));
      if (turn.allowed) {
        try {
          const code = await emailActions.passwordResetCode(body.email);
          if (code)
            await queueAuthActionEmail(deps.db, {
              mode: 'resetPassword',
              email: body.email,
              locale: body.locale,
              code,
              keyring: deps.keyring ?? null,
            });
          else await recordAuthActionSkipped(deps.db, { mode: 'resetPassword' });
        } catch (err) {
          // Firebase or the database failing must not look different from "no such account".
          log('error', 'password_reset_email_failed', safeError(err));
        }
      }
      const wait = minMs - (Date.now() - started);
      if (wait > 0) await pause(wait);
      return c.json({ status: 'accepted' as const }, 200);
    })
    .openapi(changedRoute, async (c) => {
      const { emailActions } = deps;
      if (!emailActions) throw unavailable();
      const body = c.req.valid('json');
      const started = Date.now();
      await closed(() => enforceRate(c, deps.rateLimiter, CHANGED_PER_IP, c.get('clientIp')));
      // No per-address budget: someone could use it up just before taking an account over and so hide the change
      // from its owner (security review 2026-11-24). The per-IP limit bounds the lookups; a found change is
      // remembered for a short while so repeat calls do not each ask Firebase.
      try {
        const now = Date.now();
        const change =
          recentChanges.get(body.email, now) ?? (await emailActions.passwordChangeFor({ email: body.email }));
        // Only a change worth announcing is remembered: "nothing changed" must never hide one that follows.
        if (change && isAnnounceable(change, now, NEW_ACCOUNT_MS)) recentChanges.set(body.email, change, now);
        await announcePasswordChange(deps.db, change, {
          locale: body.locale,
          now: Date.now(),
          newAccountMs: NEW_ACCOUNT_MS,
          recordSkip: true,
        });
      } catch (err) {
        // Firebase or the database failing must not look different from "nothing changed".
        log('error', 'password_changed_notice_failed', safeError(err));
      }
      const wait = minMs - (Date.now() - started);
      if (wait > 0) await pause(wait);
      return c.json({ status: 'accepted' as const }, 200);
    })
    .openapi(verifyRoute, async (c) => {
      const { emailActions } = deps;
      if (!emailActions) throw unavailable();
      const { user } = c.get('auth');
      const body = c.req.valid('json');
      await closed(() => enforceRate(c, deps.rateLimiter, VERIFY_PER_USER, user.id));
      let found: Awaited<ReturnType<typeof emailActions.verificationFor>>;
      try {
        found = await emailActions.verificationFor(user.firebaseUid);
      } catch (err) {
        log('error', 'verification_email_failed', safeError(err));
        throw unavailable();
      }
      if (!found) {
        await recordAuthActionSkipped(deps.db, { mode: 'verifyEmail', userId: user.id });
        return c.json({ status: 'not_needed' as const }, 200);
      }
      await queueAuthActionEmail(deps.db, {
        mode: 'verifyEmail',
        email: found.email,
        locale: body.locale ?? (user.language === 'hi' ? 'hi' : 'en'),
        code: found.code,
        keyring: deps.keyring ?? null,
        userId: user.id,
      });
      return c.json({ status: 'sent' as const }, 200);
    });
}
