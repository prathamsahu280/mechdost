import { OpenAPIHono } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import { timeout } from 'hono/timeout';
import { SessionCache } from './auth/session-cache';
import { handleError, handleNotFound } from './errors';
import { log } from './logger';
import { rateLimit, RATE_RULES } from './middleware/rate-limit';
import { securityMiddleware } from './middleware/security';
import { adminCustomerRoutes } from './routes/admin-customers';
import { adminNotificationRoutes } from './routes/admin-notifications';
import { adminOrderRoutes } from './routes/admin-orders';
import { assistantRoutes } from './routes/assistant';
import { catalogueRoutes } from './routes/catalogue';
import { checkoutRoutes } from './routes/checkout';
import { meRoutes } from './routes/me';
import { shopOrderRoutes } from './routes/shop-orders';
import { supportRoutes } from './routes/support';
import { systemRoutes } from './routes/system';
import { whatsAppWebhookRoutes } from './routes/whatsapp-webhook';
import type { AppDeps, AppEnv } from './types';
import { validationHook } from './validation';

const REQUEST_TIMEOUT_MS = 10_000;

/** One line per request: route pattern (not the raw URL with ids/query), status, duration. No PII. */
const requestLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = performance.now();
  await next();
  log(c.res.status >= 500 ? 'error' : 'info', 'request', {
    requestId: c.get('requestId'),
    method: c.req.method,
    route: routePath(c),
    status: c.res.status,
    ms: Math.round(performance.now() - started),
  });
});

/**
 * Build the API. Stateless (rule 7): per-instance caches are optional accelerators; shared state lives in
 * Postgres and Redis. Layout: system probes at the root, versioned business routes under /v1.
 */
export function createApp(deps: AppDeps) {
  const sessions = new SessionCache();
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use('*', ...securityMiddleware(deps.config));
  app.use('*', requestLog);
  app.onError(handleError);
  app.notFound(handleNotFound);

  app.route('/', systemRoutes(deps));
  // Provider webhooks: signature-checked, outside /v1 (no user auth, no per-IP API limit; Meta retries).
  app.route('/', whatsAppWebhookRoutes(deps));

  const v1 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  v1.use('*', timeout(REQUEST_TIMEOUT_MS));
  v1.use(
    '*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerIp, (c) => c.get('clientIp')),
  );
  v1.route('/', meRoutes(deps, sessions));
  v1.route('/', assistantRoutes(deps));
  v1.route('/', catalogueRoutes(deps));
  v1.route('/', checkoutRoutes(deps, sessions));
  v1.route('/', adminNotificationRoutes(deps, sessions));
  v1.route('/', supportRoutes(deps, sessions));
  v1.route('/', adminCustomerRoutes(deps, sessions));
  v1.route('/', adminOrderRoutes(deps, sessions));
  v1.route('/', shopOrderRoutes(deps, sessions));
  app.route('/v1', v1);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'Firebase ID token',
  });
  if (deps.config.apiDocs) {
    app.doc31('/openapi.json', {
      openapi: '3.1.0',
      info: { title: 'MechDost API', version: '1.0.0', description: 'docs/specs — one spec per feature' },
    });
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
