import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors';
import type { RateLimiter, RateRule } from '../rate-limit/limiter';
import type { AppEnv } from '../types';

/** Limits from docs/specs/13 "Abuse protection". Values tuned later via settings/overrides. */
export const RATE_RULES = {
  /** Razorpay webhook endpoint per IP (outside /v1, so not part of the global limits below). */
  apiPerIp: { name: 'api_ip', limit: 600, windowSeconds: 60 },
  /** Per-route cap on one signed-in account. The global /v1 limits are admin settings (`api_user`, `api_guest`, `api_ip_flood`; middleware/api-rate-limit.ts). */
  apiPerUser: { name: 'api_route_user', limit: 120, windowSeconds: 60 },
  /** CSV catalogue imports (checks and real runs) per staff user: up to 500 rows each (plan 2026-11-14 B). */
  catalogueImport: { name: 'catalogue_import', limit: 30, windowSeconds: 3600 },
  /** Staff test sends of an email template to their own address (spec 10): a typo must not become a mail loop. */
  emailTest: { name: 'email_test', limit: 20, windowSeconds: 3600 },
  /** Staff searches and audit queries (customer search, audit viewer): scans over indexes, so a typing burst is fine, a script is not. */
  adminSearch: { name: 'admin_search', limit: 30, windowSeconds: 60 },
  /** CSV exports (request and download each count): a few per hour per staff member is plenty, a script is not. */
  adminExport: { name: 'admin_export', limit: 40, windowSeconds: 3600 },
  /** Admin → Ustaad settings and tables per staff member (spec 23 § 8 "Admin": staff 300/min). */
  ustaadAdmin: { name: 'ustaad_admin', limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

/**
 * Apply `rule` keyed by `key(c)`; on excess respond 429 with Retry-After and IETF RateLimit headers.
 * Headers are set on success too so well-behaved clients can back off early.
 */
export function rateLimit(limiter: RateLimiter, rule: RateRule, key: (c: Context<AppEnv>) => string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    await enforceRate(c, limiter, rule, key(c));
    await next();
  });
}

/**
 * Count `weight` units against `rule` inside a handler (weighted limits, e.g. events per batch). RateLimit-*
 * headers describe the request rule set by the middleware, so a weighted rule only adds Retry-After when it refuses.
 */
export async function enforceRate(
  c: Context<AppEnv>,
  limiter: RateLimiter,
  rule: RateRule,
  key: string,
  weight?: number,
) {
  const r = await limiter.hit(rule, key, weight);
  const resetSeconds = Math.max(0, Math.ceil((r.resetAt - Date.now()) / 1000));
  if (weight === undefined) {
    c.header('RateLimit-Limit', String(r.limit));
    c.header('RateLimit-Remaining', String(r.remaining));
    c.header('RateLimit-Reset', String(resetSeconds));
  }
  if (!r.allowed) {
    c.header('Retry-After', String(Math.max(1, resetSeconds)));
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests — please wait a moment and try again');
  }
}
