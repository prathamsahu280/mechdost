'use client';

import { lazy, Suspense } from 'react';
import type { WishlistLabels } from './wishlist-heart';

/**
 * The wishlist heart, loaded on demand (JS budget, coordinator 2026-11-15: new client code never enters the header,
 * layout or shop bundles; learning L177). The shop pages import only this wrapper; the real component and the
 * wishlist store arrive in their own chunk after the page is interactive. `AUTH_MODE` is a build-time constant, so the
 * demo build contains neither the wrapper's lazy import nor the chunk: the wishlist exists with real sign-in only
 * (it lives on the server).
 */
const Heart = /* @__PURE__ */ lazy(() => import('./wishlist-heart'));

interface HeartProps {
  slug: string;
  labels: WishlistLabels;
  source: 'card' | 'page';
}

function RealHeart(props: HeartProps) {
  return (
    <Suspense
      fallback={
        props.source === 'page' ? (
          <span aria-hidden="true" className="inline-block min-h-11 min-w-28" />
        ) : (
          <span aria-hidden="true" className="inline-block size-10 shrink-0" />
        )
      }
    >
      <Heart {...props} />
    </Suspense>
  );
}

function NoHeart(_props: HeartProps) {
  return null;
}

/** Chosen at build time (budget incident 2026-11-15): the demo build keeps only the empty function on every card. */
// Inlined env value (the minifier folds a literal only inside one module).
export const WishlistHeartLazy = process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? RealHeart : NoHeart;
