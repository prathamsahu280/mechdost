'use client';

import { lazy, Suspense } from 'react';
import type { RecentlyViewedProps } from './recently-viewed';

/**
 * "Recently viewed" (shopping personalisation phase 2), loaded on demand: the pages import only this wrapper (JS
 * budget, spec 16; learning L177). The list, its browser store, the signed-in sync and the suggestion tracker arrive in
 * their own chunk after the page is interactive. Nothing is reserved while it loads: the list sits at the end of the
 * page (below the fold), and an empty list renders nothing at all.
 */
const List = /* @__PURE__ */ lazy(() => import('./recently-viewed'));

export function RecentlyViewedLazy(props: RecentlyViewedProps) {
  return (
    <Suspense fallback={null}>
      <List {...props} />
    </Suspense>
  );
}
