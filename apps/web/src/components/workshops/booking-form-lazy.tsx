'use client';

import { lazy, Suspense, type ComponentProps } from 'react';
import type { BookingFormApi } from './booking-form-api';

/**
 * The API booking form, loaded on demand (real data mode only): the workshop page's demo build never carries it.
 * `React.lazy` rather than `next/dynamic` (no extra runtime on the page; learning L79).
 */
const Inner = lazy(() => import('./booking-form-api').then((m) => ({ default: m.BookingFormApi })));

export function BookingFormLazy(props: ComponentProps<typeof BookingFormApi>) {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" aria-hidden="true" />}>
      <Inner {...props} />
    </Suspense>
  );
}
