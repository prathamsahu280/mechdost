import type { Hook } from '@hono/zod-openapi';
import { errorBody, zodDetails } from './errors';
import type { AppEnv } from './types';

/** Zod validation failures → 400 in the standard error shape, listing paths but never echoing values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hook is generic over every route's input/output
export const validationHook: Hook<any, AppEnv, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(errorBody(c, 'VALIDATION', 'Request is invalid', zodDetails(result.error)), 400);
  }
  return undefined;
};
