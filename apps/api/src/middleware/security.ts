import { getConnInfo } from '@hono/node-server/conninfo';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from '../config';
import { ApiError, errorBody } from '../errors';
import type { AppEnv } from '../types';

export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB; photo uploads have their own limit (see below)

/** Client IP: the socket address, or the entry appended by the outermost trusted proxy. */
export function clientIp(config: Config) {
  return createMiddleware<AppEnv>(async (c, next) => {
    let ip = 'unknown';
    if (config.trustedProxyHops > 0) {
      const chain = (c.req.header('x-forwarded-for') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      ip = chain[chain.length - config.trustedProxyHops] ?? 'unknown';
    } else {
      try {
        ip = getConnInfo(c).remote.address ?? 'unknown';
      } catch {
        // Not running on a Node socket (tests, in-process requests).
      }
    }
    c.set('clientIp', ip);
    await next();
  });
}

/**
 * Compressed request bodies are refused: Node's Brotli decoder had an RCE (CVE-2026-111497) and compressed
 * bodies bypass size limits ("zip bombs"). Clients never need to compress requests to this API.
 */
export const rejectEncodedBodies = createMiddleware<AppEnv>(async (c, next) => {
  const enc = c.req.header('content-encoding');
  if (enc && enc.toLowerCase() !== 'identity') {
    throw new ApiError(415, 'UNSUPPORTED_ENCODING', 'Compressed request bodies are not accepted');
  }
  await next();
});

/** API responses carry user data; never let shared caches store them unless a route opts in. */
export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has('cache-control')) c.header('Cache-Control', 'no-store');
});

/** Job photo uploads carry up to 8 MB; that route has its own, larger limit (routes/service-photos.ts). */
const PHOTO_UPLOAD_PATH =
  /^\/v1\/(workshop\/requests\/[^/]+\/photos|support\/threads|support\/tickets\/[^/]+\/photo-messages)\/?$/;

const defaultBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json(errorBody(c, 'PAYLOAD_TOO_LARGE', 'Request body is too large'), 413),
});
const bodyLimitExceptPhotos = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST' && PHOTO_UPLOAD_PATH.test(c.req.path)) return next();
  return defaultBodyLimit(c, next);
});

/**
 * Photo images are embedded by the website, which may sit on another origin of the same site; the signed URL is the
 * capability. Runs outside secureHeaders so it can replace its same-site default for this one route.
 */
const imageCorp = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (
    (c.req.path.startsWith('/v1/service-photos/') || c.req.path.startsWith('/v1/support-photos/')) &&
    c.res.status === 200
  )
    c.res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
});

export function securityMiddleware(config: Config) {
  return [
    requestId({ headerName: 'X-Request-Id', limitLength: 64 }),
    clientIp(config),
    imageCorp,
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      crossOriginResourcePolicy: 'same-site',
      referrerPolicy: 'no-referrer',
    }),
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposeHeaders: [
        'X-Request-Id',
        'Retry-After',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
      ],
      maxAge: 600,
      credentials: false, // bearer tokens, not cookies → no CSRF surface on the API
    }),
    rejectEncodedBodies,
    bodyLimitExceptPhotos,
    noStore,
  ];
}
