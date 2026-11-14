/**
 * Sentry error reports for the API and the worker (decision 2026-11-14). Off until `SENTRY_DSN` is set: then
 * `@sentry/node` is loaded (dynamic import, so an unset DSN costs nothing) and initialised for errors only — no
 * tracing, no OpenTelemetry setup, no breadcrumbs (console breadcrumbs would copy log lines), no default PII, the
 * service name instead of the host name — and every event passes `scrubErrorEvent` (`@mechdost/shared/error-scrub`)
 * before it leaves. Two sources: exceptions the API could not map to a response (`errors.ts`) and `log('error', …)`
 * lines (worker loops, jobs), the latter throttled per message so a failing loop cannot use up the quota.
 */
import { scrubErrorEvent, type ScrubbableEvent } from '@mechdost/shared/error-scrub';
import { log, safeError, setErrorHook, type ErrorHook } from '../logger';

export interface SentrySettings {
  dsn: string;
  environment: string;
  release: string | null;
}

export type Service = 'api' | 'worker';

/** Options for `Sentry.init` (pure, so tests can check them without loading the SDK). */
export function sentryOptions<I>(settings: SentrySettings, service: Service, integrations: I[]) {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    ...(settings.release ? { release: settings.release } : {}),
    serverName: service,
    initialScope: { tags: { service } },
    sendDefaultPii: false as const,
    defaultIntegrations: false as const,
    integrations,
    skipOpenTelemetrySetup: true,
    // No import-in-the-middle loader hooks: nothing is auto-instrumented, and the hooks cost start-up time and memory.
    registerEsmLoaderHooks: false,
    maxBreadcrumbs: 0,
    beforeSend: <E extends ScrubbableEvent>(event: E): E => scrubErrorEvent(event),
  };
}

/** Messages that are already reported as exceptions (`unhandled_error`) or are one line per request. */
const NOT_REPORTED = new Set(['request', 'unhandled_error']);
const WINDOW_MS = 10 * 60_000;
const MAX_KEYS = 200;

/** Error-log hook: the first line of each message name per 10 minutes goes to `send`. */
export function errorHookFor(
  send: (message: string, fields: Record<string, unknown>) => void,
  now: () => number = Date.now,
): ErrorHook {
  const last = new Map<string, number>();
  return (message, fields) => {
    if (NOT_REPORTED.has(message)) return;
    const t = now();
    const prev = last.get(message);
    if (prev !== undefined && t - prev < WINDOW_MS) return;
    if (last.size >= MAX_KEYS) last.clear();
    last.set(message, t);
    send(message, fields);
  };
}

let captureException: ((err: unknown, context: Record<string, string>) => void) | null = null;

/** Report an exception the API could not handle (no-op while Sentry is off). Context: ids and route only. */
export function reportException(err: unknown, context: Record<string, string | undefined>): void {
  if (!captureException) return;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(context)) if (v) tags[k] = v;
  try {
    captureException(err, tags);
  } catch {
    // Reporting never breaks the response.
  }
}

/** Start Sentry when configured; returns a flush for graceful shutdown. Never throws. */
export async function startSentry(
  settings: SentrySettings | null,
  service: Service,
): Promise<{ flush: () => Promise<void> }> {
  const none = { flush: () => Promise.resolve() };
  if (!settings) return none;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init(
      sentryOptions(settings, service, [
        Sentry.eventFiltersIntegration(),
        Sentry.functionToStringIntegration(),
        Sentry.linkedErrorsIntegration(),
        Sentry.dedupeIntegration(),
        Sentry.nodeContextIntegration(),
        Sentry.contextLinesIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        // `strict` keeps Node's default: an unhandled rejection still ends the process (the container restarts).
        Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
      ]),
    );
    captureException = (err, tags) => {
      Sentry.captureException(err, { tags });
    };
    setErrorHook(
      errorHookFor((message, fields) => {
        Sentry.captureMessage(message, { level: 'error', tags: { log: message }, extra: fields });
      }),
    );
    return {
      flush: async () => {
        await Sentry.flush(2000);
      },
    };
  } catch (err) {
    log('warn', 'sentry_start_failed', safeError(err));
    return none;
  }
}
