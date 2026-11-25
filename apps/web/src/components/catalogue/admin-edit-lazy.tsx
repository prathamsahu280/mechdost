'use client';

import { lazy, Suspense } from 'react';
import { useSession } from '@/demo/session-state';
import { shouldProbeSession } from '@/lib/catalogue/admin-edit';
import type { AdminEditProps } from './admin-edit-button';

/**
 * Storefront "Edit" shortcut for catalogue staff (user 2026-11-25; spec 08). This wrapper is all the shop and product
 * bundles carry: the button, its `/me` check and its analytics arrive in their own chunk, fetched only when the stored
 * session is a staff one (JS budget, spec 16). Nothing staff-only is rendered on the server: the shop pages are cached
 * and shared, so the server output is identical for everyone and the button appears after hydration. The stored
 * session is only a hint whether to ask; in real sign-in the chunk shows the button only after the live `/v1/me`
 * answer lists the catalogue permission.
 */
const Button = /* @__PURE__ */ lazy(() => import('./admin-edit-button'));

export function AdminEditLazy(props: Omit<AdminEditProps, 'accountId'>) {
  const session = useSession();
  if (!session || !shouldProbeSession(session.role)) return null;
  return (
    <Suspense fallback={null}>
      <Button {...props} accountId={session.id} />
    </Suspense>
  );
}
