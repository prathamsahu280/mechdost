/**
 * Browser error reports to Sentry (decision 2026-11-14), sized for the JS budget (spec 16): this module is all that
 * ships with every page — two listeners and a queue. The Sentry SDK (`./sentry-browser`, its own chunk) is
 * downloaded only when an error actually happens, so an error-free visit costs no extra request or bytes. After it
 * loads, Sentry's own global handlers take over and these listeners are removed. Nothing runs without
 * `NEXT_PUBLIC_SENTRY_DSN`. Errors are essential processing (no consent banner purpose); reports carry no personal
 * data (`scrubErrorEvent`) and no session or user tracking.
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const MAX_PER_PAGE = 10;

type Capture = (error: unknown) => void;
let capture: Capture | null = null;
let loading: Promise<void> | null = null;
let sent = 0;
const queue: unknown[] = [];

function onError(e: ErrorEvent) {
  // Without an error object it is a cross-origin "Script error." (extensions, third-party frames): nothing to fix.
  if (e.error) reportClientError(e.error);
}
function onRejection(e: PromiseRejectionEvent) {
  reportClientError(e.reason);
}

function load(): Promise<void> {
  loading ??= import('./sentry-browser')
    .then((m) => {
      capture = m.startSentry(DSN ?? '');
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      for (const err of queue.splice(0)) capture(err);
    })
    .catch(() => {
      // Reporting never breaks the page (offline, blocked by an extension …).
      queue.length = 0;
    });
  return loading;
}

/** Report an error (also from error boundaries); loads the SDK on first use. No-op without a DSN. */
export function reportClientError(error: unknown): void {
  if (!DSN || sent >= MAX_PER_PAGE) return;
  sent += 1;
  if (capture) {
    capture(error);
    return;
  }
  queue.push(error);
  void load();
}

let started = false;

/** Listen for uncaught errors and unhandled rejections (called once from the site-wide analytics island). */
export function startErrorReporting(): void {
  if (!DSN || started) return;
  started = true;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
}
