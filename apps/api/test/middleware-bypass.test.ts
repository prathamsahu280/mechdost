/**
 * Auth middleware cannot be skipped (Hono advisory GHSA-h7mg-cq63-vhpq, 2026-11: RegExpRouter skipped wildcard
 * middleware for a path with an encoded line terminator, and for a `/prefix*` route next to `/prefix/*`
 * middleware). Every protected route must refuse an anonymous request whatever the path encoding.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from './helpers';

const TERMINATORS = ['%0A', '%0D', '%0D%0A', '%E2%80%A8', '%E2%80%A9'];
const PROTECTED: [method: string, path: string][] = [
  ['GET', '/v1/me'],
  ['GET', '/v1/orders'],
  ['GET', '/v1/admin/settings'],
  ['PUT', '/v1/admin/settings/orders.acceptance_timeout_min'],
  ['GET', '/v1/admin/orders'],
  ['GET', '/v1/admin/customers/00000000-0000-7000-8000-000000000000/blocks'],
  ['GET', '/v1/shop/orders'],
  ['GET', '/v1/my-reviews/eligible?order=MD-RPR-2026-7K3Q9X'],
  ['POST', '/v1/my-reviews'],
  ['GET', '/v1/admin/reviews'],
];

describe('protected routes refuse anonymous requests under any path encoding', () => {
  it.each(PROTECTED)('%s %s', async (method, path) => {
    const { app } = await buildApp();
    const body = method === 'GET' ? undefined : JSON.stringify({ city: null, value: 20, version: null });
    const variants = [path, ...TERMINATORS.flatMap((t) => [`${path}${t}`, `${path}/${t}`])];
    for (const url of variants) {
      const res = await app.request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect([url, res.status < 300]).toEqual([url, false]);
    }
  });
});
