import * as Sentry from '@sentry/node';
import { scrubErrorEvent, scrubUrl } from '@mechdost/shared/error-scrub';

/**
 * Sentry for the website's server (server rendering, server functions, route handlers; decision 2026-11-14).
 * Loaded from `instrumentation.ts` only when `NEXT_PUBLIC_SENTRY_DSN` is set. Errors only, like the API: no
 * tracing or OpenTelemetry, no breadcrumbs, no default PII, the service name instead of the host name, and every
 * event scrubbed. Next reports each failed request through `onRequestError`, so no process handlers are added.
 */
let started = false;

export function startServerReporting(dsn: string): void {
  if (started) return;
  started = true;
  const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  Sentry.init({
    dsn,
    // A Docker build passes an unset build argument as "", which also means the default.
    environment: environment !== undefined && environment !== '' ? environment : 'production',
    ...(release ? { release } : {}),
    serverName: 'web',
    sendDefaultPii: false,
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    maxBreadcrumbs: 0,
    initialScope: { tags: { service: 'web' } },
    beforeSend: (event) => scrubErrorEvent(event),
  });
}

/** One failed request: the error plus the route pattern and the path (no query string, secrets masked). */
export function captureRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
): void {
  if (!started) return;
  Sentry.captureException(error, {
    tags: { route: context.routePath, routeType: context.routeType, method: request.method },
    extra: { path: scrubUrl(request.path) },
  });
}
