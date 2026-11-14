import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors';
import type { RateLimiter, RateRule } from '../rate-limit/limiter';
import type { AppEnv } from '../types';

/** Limits from docs/specs/13 "Abuse protection". Values tuned later via settings/overrides. */
export const RATE_RULES = {
  apiPerIp: { name: 'api_ip', limit: 600, windowSeconds: 60 },
  apiPerUser: { name: 'api_user', limit: 120, windowSeconds: 60 },
  /** CSV catalogue imports (checks and real runs) per staff user: up to 500 rows each (plan 2026-11-14 B). */
  catalogueImport: { name: 'catalogue_import', limit: 30, windowSeconds: 3600 },
  /** Staff test sends of an email template to their own address (spec 10): a typo must not become a mail loop. */
  emailTest: { name: 'email_test', limit: 20, windowSeconds: 3600 },
  /** Staff searches and audit queries (customer search, audit viewer): scans over indexes, so a typing burst is fine, a script is not. */
  adminSearch: { name: 'admin_search', limit: 30, windowSeconds: 60 },
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
