import type { Context } from 'hono';
import { RateLimitUnavailable } from './rate-limit/limiter';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from '@mechdost/db/repo';
import { ActorNotAllowedError, IllegalTransitionError } from '@mechdost/shared/state';
import { log, safeError } from './logger';
import { reportException } from './monitoring/sentry';
import type { AppEnv } from './types';

/**
 * Every error leaves the API as `{ error: { code, message, requestId, details? } }`
 * (docs/specs/13 + advisor checklist). Codes are stable and translated by the client (hard rule 10);
 * messages are for developers. Internals (stack, SQL) are logged, never returned.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Unauthorized = (code = 'AUTH_REQUIRED', message = 'Sign in to continue') =>
  new ApiError(401, code, message);
export const Forbidden = (code = 'FORBIDDEN', message = 'You do not have access to this') =>
  new ApiError(403, code, message);

/** `requestId` is typed for every Context by hono/request-id's ContextVariableMap augmentation. */
export function errorBody(c: Context, code: string, message: string, details?: unknown) {
  return {
    error: { code, message, requestId: c.get('requestId'), ...(details === undefined ? {} : { details }) },
  };
}

export function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message }));
}

export function handleError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof ApiError) return c.json(errorBody(c, err.code, err.message, err.details), err.status);
  if (err instanceof ZodError) {
    return c.json(errorBody(c, 'VALIDATION', 'Request is invalid', zodDetails(err)), 400);
  }
  if (err instanceof NotFoundError) return c.json(errorBody(c, err.code, 'Not found'), 404);
  if (err instanceof ValidationError)
    return c.json(errorBody(c, err.code, err.message, err.details), err.status);
  if (err instanceof ForbiddenError) return c.json(errorBody(c, err.code, err.message), 403);
  if (err instanceof ConflictError) return c.json(errorBody(c, err.code, err.message), err.status);
  // A move the state machine forbids is the caller's mistake, not a server fault (review B5).
  if (err instanceof IllegalTransitionError || err instanceof ActorNotAllowedError)
    return c.json(errorBody(c, err.code, err.message), 409);
  // A fail-closed rate limit whose store did not answer (sign-in, codes, lookups): try again, not a server fault.
  if (err instanceof RateLimitUnavailable)
    return c.json(errorBody(c, 'RATE_LIMIT_UNAVAILABLE', 'Please try again in a minute'), 503);
  if (err instanceof HTTPException) {
    const code = err.status === 413 ? 'PAYLOAD_TOO_LARGE' : err.status === 504 ? 'TIMEOUT' : 'HTTP_ERROR';
    return c.json(errorBody(c, code, err.message || 'Request failed'), err.status);
  }
  // Postgres outcomes no repository mapped (code review 2026-11-03): a lost race is a retryable conflict, not a 500.
  const pg = pgCode(err);
  if (pg === '40P01' || pg === '40001')
    return c.json(errorBody(c, 'RETRY', 'Someone else changed this at the same moment; try again'), 409);
  if (pg === '23505') return c.json(errorBody(c, 'UNIQUE_VIOLATION', 'This already exists'), 409);
  // A statement over its timeout (reports run with a local statement_timeout): retryable, not a server fault.
  if (pg === '57014')
    return c.json(errorBody(c, 'QUERY_TIMEOUT', 'This took too long; try a shorter range'), 503);
  log('error', 'unhandled_error', {
    requestId: c.get('requestId'),
    path: routePath(c),
    ...safeError(err),
  });
  reportException(err, { requestId: c.get('requestId'), route: routePath(c) });
  return c.json(errorBody(c, 'INTERNAL', 'Something went wrong'), 500);
}

export function handleNotFound(c: Context<AppEnv>): Response {
  return c.json(errorBody(c, 'NOT_FOUND', 'Not found'), 404);
}
