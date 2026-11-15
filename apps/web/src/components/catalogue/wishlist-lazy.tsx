'use client';

import { lazy, Suspense } from 'react';
import { AUTH_MODE } from '@/lib/auth/mode';
import type { WishlistLabels } from './wishlist-heart';

/**
 * The wishlist heart, loaded on demand (JS budget, coordinator 2026-11-15: new client code never enters the header,
 * layout or shop bundles; learning L177). The shop pages import only this wrapper; the real component and the
 * wishlist store arrive in their own chunk after the page is interactive. `AUTH_MODE` is a build-time constant, so the
 * demo build contains neither the wrapper's lazy import nor the chunk: the wishlist exists with real sign-in only
 * (it lives on the server).
 */
const Heart = AUTH_MODE === 'firebase' ? lazy(() => import('./wishlist-heart')) : null;

export function WishlistHeartLazy(props: { slug: string; labels: WishlistLabels; source: 'card' | 'page' }) {
  if (!Heart) return null;
  return (
    <Suspense
      fallback={
        props.source === 'page' ? (
          <span aria-hidden="true" className="inline-block min-h-11 min-w-28" />
        ) : null
      }
    >
      <Heart {...props} />
    </Suspense>
  );
}
