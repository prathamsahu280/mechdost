import { OpenAPIHono } from '@hono/zod-openapi';
import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import { timeout } from 'hono/timeout';
import { SessionCache } from './auth/session-cache';
import { handleError, handleNotFound } from './errors';
import { log } from './logger';
import { rateLimit, RATE_RULES } from './middleware/rate-limit';
import { securityMiddleware } from './middleware/security';
import { adminAnalyticsRoutes } from './routes/admin-analytics';
import { adminCatalogueRoutes } from './routes/admin-catalogue';
import { adminPriceRoutes } from './routes/admin-prices';
import { adminCustomerRoutes } from './routes/admin-customers';
import { adminNotificationRoutes } from './routes/admin-notifications';
import { adminOrderRoutes } from './routes/admin-orders';
import { adminSettingsRoutes } from './routes/admin-settings';
import { assistantRoutes } from './routes/assistant';
import { authRoutes } from './routes/auth';
import { catalogueRoutes } from './routes/catalogue';
import { paymentRoutes, razorpayWebhookRoutes } from './routes/payments';
import { checkoutRoutes } from './routes/checkout';
import { adminContentRoutes, contentRoutes } from './routes/content';
import { eventRoutes } from './routes/events';
import { pincodeAdminRoutes, pincodePublicRoutes } from './routes/geo';
import { meRoutes } from './routes/me';
import { partnerAdminRoutes, partnerPublicRoutes, shopOnboardingRoutes } from './routes/partner-onboarding';
import { shopInventoryRoutes } from './routes/shop-inventory';
import { shopOrderRoutes } from './routes/shop-orders';
import { supportRoutes } from './routes/support';
import { systemRoutes } from './routes/system';
import { whatsAppWebhookRoutes } from './routes/whatsapp-webhook';
import { adminServiceRequestRoutes } from './routes/admin-service-requests';
import { serviceRequestRoutes } from './routes/service-requests';
import { workshopPortalRoutes } from './routes/workshop-portal';
import { workshopAdminRoutes, workshopPublicRoutes } from './routes/workshops';
import { reviewPublicRoutes, reviewRoutes } from './routes/reviews';
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
  app.route('/', razorpayWebhookRoutes(deps));

  const v1 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  v1.use('*', timeout(REQUEST_TIMEOUT_MS));
  v1.use(
    '*',
    rateLimit(deps.rateLimiter, RATE_RULES.apiPerIp, (c) => c.get('clientIp')),
  );
  v1.route('/', authRoutes(deps));
  v1.route('/', meRoutes(deps, sessions));
  v1.route('/', assistantRoutes(deps));
  v1.route('/', catalogueRoutes(deps));
  v1.route('/', contentRoutes(deps));
  v1.route('/', eventRoutes(deps));
  v1.route('/', checkoutRoutes(deps, sessions));
  v1.route('/', paymentRoutes(deps, sessions));
  v1.route('/', adminNotificationRoutes(deps, sessions));
  v1.route('/', supportRoutes(deps, sessions));
  v1.route('/', adminCustomerRoutes(deps, sessions));
  v1.route('/', adminCatalogueRoutes(deps, sessions));
  v1.route('/', adminPriceRoutes(deps, sessions));
  v1.route('/', adminOrderRoutes(deps, sessions));
  v1.route('/', adminSettingsRoutes(deps, sessions));
  v1.route('/', adminAnalyticsRoutes(deps, sessions));
  v1.route('/', adminContentRoutes(deps, sessions));
  v1.route('/', shopOrderRoutes(deps, sessions));
  v1.route('/', shopInventoryRoutes(deps, sessions));
  v1.route('/', partnerPublicRoutes(deps));
  v1.route('/', partnerAdminRoutes(deps, sessions));
  v1.route('/', shopOnboardingRoutes(deps, sessions));
  v1.route('/', workshopPublicRoutes(deps));
  v1.route('/', workshopAdminRoutes(deps, sessions));
  v1.route('/', serviceRequestRoutes(deps, sessions));
  v1.route('/', workshopPortalRoutes(deps, sessions));
  v1.route('/', adminServiceRequestRoutes(deps, sessions));
  v1.route('/', reviewPublicRoutes(deps));
  v1.route('/', reviewRoutes(deps, sessions));
  v1.route('/', pincodePublicRoutes(deps));
  v1.route('/', pincodeAdminRoutes(deps, sessions));
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
