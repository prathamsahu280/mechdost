import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '@mechdost/db/repo';
import { log } from './logger';
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
  if (err instanceof ConflictError || err instanceof ValidationError) {
    return c.json(errorBody(c, err.code, err.message), err.status);
  }
  if (err instanceof HTTPException) {
    const code = err.status === 413 ? 'PAYLOAD_TOO_LARGE' : err.status === 504 ? 'TIMEOUT' : 'HTTP_ERROR';
    return c.json(errorBody(c, code, err.message || 'Request failed'), err.status);
  }
  log('error', 'unhandled_error', {
    requestId: c.get('requestId'),
    path: routePath(c),
    error: err.name,
    message: err.message,
    stack: err.stack,
  });
  return c.json(errorBody(c, 'INTERNAL', 'Something went wrong'), 500);
}

export function handleNotFound(c: Context<AppEnv>): Response {
  return c.json(errorBody(c, 'NOT_FOUND', 'Not found'), 404);
}
