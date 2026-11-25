'use client';

import type { ReactNode } from 'react';
import { ustaadAccessDecision } from '@mechdost/shared/ustaad/access';
import type { UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
import { useSession } from '@/demo/session';
import { useHydrated } from '@/demo/store';

/**
 * What the browser shows inside `/ustaad` (founder 2026-11-26 staff preview). The API is the real boundary (every
 * `/v1/ustaad/*` call is gated there); this only decides what to render, with the same pure rule as the API
 * (`ustaadAccessDecision`): during the preview only staff see the network, everyone else sees the site's ordinary
 * "page not found"; when open, signed-out visitors are asked to sign in. `off` never reaches here (the layout answers a
 * real 404). The shell carries no member data, so nothing personal is in the page for those who are turned away.
 */
export function UstaadGate({
  access,
  notFound,
  signIn,
  preview,
  children,
}: {
  access: Exclude<UstaadAccessMode, 'off'>;
  notFound: ReactNode;
  signIn: ReactNode;
  preview: ReactNode;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const session = useSession();
  if (!hydrated)
    return <div className="skeleton mx-auto mt-10 h-96 w-full max-w-2xl rounded-card" aria-hidden="true" />;
  const staff = session?.role === 'admin';
  const decision = ustaadAccessDecision(access, { signedIn: session !== null, staff });
  if (decision === 'hidden') return notFound;
  if (decision === 'sign_in') return signIn;
  return (
    <>
      {access === 'staff_preview' ? preview : null}
      {children}
    </>
  );
}

/** "Namaste, Ramesh": the signed-in name (user content), or a plain greeting. */
export function UstaadGreeting({ template, fallback }: { template: string; fallback: string }) {
  const session = useSession();
  const name = session?.name.split(' ')[0];
  if (!name) return <>{fallback}</>;
  const [before, after] = template.split('{name}');
  return (
    <>
      {before}
      <span data-user-content>{name}</span>
      {after}
    </>
  );
}
