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
import { adminStaffRoutes } from './routes/admin-staff';
import { adminAuditRoutes } from './routes/admin-audit';
import { adminExportRoutes } from './routes/admin-exports';
import { adminNotificationRoutes } from './routes/admin-notifications';
import { adminOrderRoutes } from './routes/admin-orders';
import { adminSettingsRoutes } from './routes/admin-settings';
import { adminErrorRoutes } from './routes/admin-errors';
import { assistantRoutes } from './routes/assistant';
import { authRoutes } from './routes/auth';
import { catalogueRoutes } from './routes/catalogue';
import { adminRefundRoutes } from './routes/admin-refunds';
import { paymentRoutes, razorpayWebhookRoutes } from './routes/payments';
import { checkoutRoutes } from './routes/checkout';
import { couponRoutes } from './routes/coupons';
import { coinRoutes } from './routes/coins';
import { payoutRoutes } from './routes/payouts';
import { adminContentRoutes, contentRoutes } from './routes/content';
import { siteConfigAdminRoutes, siteConfigPublicRoutes } from './routes/site-config';
import { eventRoutes } from './routes/events';
import { pincodeAdminRoutes, pincodePublicRoutes } from './routes/geo';
import { accountRoutes } from './routes/account';
import { storefrontRoutes } from './routes/storefront';
import { productPhotoRoutes } from './routes/product-photos';
import { noticeRoutes } from './routes/notices';
import { meRoutes } from './routes/me';
import { partnerAdminRoutes, partnerPublicRoutes, shopOnboardingRoutes } from './routes/partner-onboarding';
import { shopInventoryRoutes } from './routes/shop-inventory';
import { shopTeamRoutes } from './routes/shop-team';
import { shopStaffPerformanceRoutes } from './routes/shop-staff-performance';
import { partnerStatusRoutes, shopToolsRoutes } from './routes/shop-tools';
import { adminShopRoutes } from './routes/admin-shops';
import { shopOrderRoutes } from './routes/shop-orders';
import { supportRoutes } from './routes/support';
import { supportGuestRoutes } from './routes/support-guest';
import { systemRoutes } from './routes/system';
import { whatsAppWebhookRoutes } from './routes/whatsapp-webhook';
import { adminServiceRequestRoutes } from './routes/admin-service-requests';
import { serviceRequestRoutes } from './routes/service-requests';
import { adminQuoteRoutes, quoteRoutes } from './routes/quotes';
import { workshopPortalRoutes } from './routes/workshop-portal';
import { workshopAnalyticsRoutes } from './routes/workshop-analytics';
import { servicePhotoRoutes } from './routes/service-photos';
import { workshopAdminRoutes, workshopPublicRoutes } from './routes/workshops';
import { reviewPublicRoutes, reviewRoutes } from './routes/reviews';
import { recommendationRoutes } from './routes/recommendations';
import { privacyRoutes } from './routes/privacy';
import { pincodeWaitlistRoutes } from './routes/pincode-waitlist';
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
  v1.route('/', accountRoutes(deps, sessions));
  v1.route('/', storefrontRoutes(deps, sessions));
  v1.route('/', noticeRoutes(deps, sessions));
  v1.route('/', assistantRoutes(deps));
  v1.route('/', catalogueRoutes(deps));
  v1.route('/', contentRoutes(deps));
  v1.route('/', siteConfigPublicRoutes(deps));
  v1.route('/', siteConfigAdminRoutes(deps, sessions));
  v1.route('/', eventRoutes(deps));
  v1.route('/', checkoutRoutes(deps, sessions));
  v1.route('/', couponRoutes(deps, sessions));
  v1.route('/', paymentRoutes(deps, sessions));
  v1.route('/', adminRefundRoutes(deps, sessions));
  v1.route('/', coinRoutes(deps, sessions));
  v1.route('/', payoutRoutes(deps, sessions));
  v1.route('/', adminNotificationRoutes(deps, sessions));
  v1.route('/', supportGuestRoutes(deps));
  v1.route('/', supportRoutes(deps, sessions));
  v1.route('/', adminCustomerRoutes(deps, sessions));
  v1.route('/', adminStaffRoutes(deps, sessions));
  v1.route('/', adminAuditRoutes(deps, sessions));
  v1.route('/', adminExportRoutes(deps, sessions));
  v1.route('/', adminCatalogueRoutes(deps, sessions));
  v1.route('/', adminPriceRoutes(deps, sessions));
  v1.route('/', adminOrderRoutes(deps, sessions));
  v1.route('/', adminSettingsRoutes(deps, sessions));
  v1.route('/', adminAnalyticsRoutes(deps, sessions));
  v1.route('/', adminErrorRoutes(deps, sessions));
  v1.route('/', adminContentRoutes(deps, sessions));
  v1.route('/', shopOrderRoutes(deps, sessions));
  v1.route('/', shopInventoryRoutes(deps, sessions));
  v1.route('/', shopTeamRoutes(deps, sessions));
  v1.route('/', shopToolsRoutes(deps, sessions));
  v1.route('/', shopStaffPerformanceRoutes(deps, sessions));
  v1.route('/', adminShopRoutes(deps, sessions));
  v1.route('/', partnerPublicRoutes(deps));
  v1.route('/', partnerStatusRoutes(deps));
  v1.route('/', partnerAdminRoutes(deps, sessions));
  v1.route('/', shopOnboardingRoutes(deps, sessions));
  v1.route('/', workshopPublicRoutes(deps));
  v1.route('/', workshopAdminRoutes(deps, sessions));
  v1.route('/', serviceRequestRoutes(deps, sessions));
  v1.route('/', workshopPortalRoutes(deps, sessions));
  v1.route('/', workshopAnalyticsRoutes(deps, sessions));
  v1.route('/', servicePhotoRoutes(deps, sessions));
  v1.route('/', productPhotoRoutes(deps, sessions));
  v1.route('/', adminServiceRequestRoutes(deps, sessions));
  v1.route('/', quoteRoutes(deps, sessions));
  v1.route('/', adminQuoteRoutes(deps, sessions));
  v1.route('/', reviewPublicRoutes(deps));
  v1.route('/', recommendationRoutes(deps, sessions));
  v1.route('/', privacyRoutes(deps, sessions));
  v1.route('/', pincodeWaitlistRoutes(deps, sessions));
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
