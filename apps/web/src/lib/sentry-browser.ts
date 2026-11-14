import {
  captureException,
  dedupeIntegration,
  eventFiltersIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from '@sentry/browser';
import { scrubErrorEvent } from '@mechdost/shared/error-scrub';

/**
 * The Sentry browser SDK, loaded by `error-reporting.ts` only after the first error (its own chunk, not counted in
 * the page's JS). Errors only: no tracing, no session tracking or replay, no breadcrumbs, no default PII, and every
 * event passes `scrubErrorEvent` (no query strings, headers, user, phone numbers, emails or tokens).
 */
export function startSentry(dsn: string): (error: unknown) => void {
  const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  init({
    dsn,
    // A Docker build passes an unset build argument as "", which also means the default.
    environment: environment !== undefined && environment !== '' ? environment : 'production',
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      globalHandlersIntegration(),
    ],
    maxBreadcrumbs: 0,
    initialScope: { tags: { service: 'web' } },
    beforeSend: (event) => scrubErrorEvent(event),
  });
  return (error) => {
    captureException(error);
  };
}
