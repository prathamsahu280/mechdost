import type { Instrumentation } from 'next';

/**
 * Server error reports to Sentry (decision 2026-11-14): nothing is loaded without `NEXT_PUBLIC_SENTRY_DSN`, and
 * only in the Node.js runtime. The SDK module is imported on demand, so it never reaches a browser bundle.
 */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !DSN) return;
  const { startServerReporting } = await import('./lib/sentry-server');
  startServerReporting(DSN);
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !DSN) return;
  const { captureRequestError } = await import('./lib/sentry-server');
  captureRequestError(error, request, context);
};
