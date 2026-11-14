'use client';

import { lazy, Suspense } from 'react';

/**
 * The API bulk-quote screens, loaded on demand (real data mode only): demo builds never carry them, and the API
 * client stays out of /shop and /cart. `React.lazy` rather than `next/dynamic` (no extra runtime; learning L79).
 */
const Form = lazy(() => import('./quote-request-form-api').then((m) => ({ default: m.QuoteRequestFormApi })));
const Thread = lazy(() => import('./quote-thread-api').then((m) => ({ default: m.QuoteThreadApi })));

export function QuoteRequestFormLazy() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-tile" aria-hidden="true" />}>
      <Form />
    </Suspense>
  );
}

export function QuoteThreadLazy({ code }: { code: string }) {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-card" aria-hidden="true" />}>
      <Thread code={code} />
    </Suspense>
  );
}
