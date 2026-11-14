/**
 * Error mapping (spec 13): a statement timeout (Postgres 57014, e.g. an analytics report over its 10 s budget) is a
 * clear, retryable 503 `QUERY_TIMEOUT`, not a 500.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { handleError } from '../src/errors';
import { setLogSink } from '../src/logger';
import type { AppEnv } from '../src/types';

describe('handleError', () => {
  it('answers a statement timeout with 503 QUERY_TIMEOUT', async () => {
    setLogSink(() => undefined);
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get('/slow', () => {
      const pg = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      throw new Error('Failed query', { cause: pg });
    });
    const res = await app.request('/slow');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('QUERY_TIMEOUT');
  });
});
