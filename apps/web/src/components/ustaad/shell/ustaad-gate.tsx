'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ShapeSkeleton, shapeForPath } from '@/components/ustaad/common/shape-skeleton';
import { canonicalPath } from '@/lib/locale-path';
import { ustaadAccessDecision } from '@mechdost/shared/ustaad/access';
import type { UstaadAccessMode } from '@mechdost/shared/ustaad/codes';
import { useSession } from '@/demo/session';
import { useHydrated } from '@/demo/store';
import { ustaadClient } from '@/lib/ustaad/client';
import { passedUstaadGate } from '@/lib/ustaad/tester-probe';

/**
 * Preview testers (founder 2026-11-27): only the API knows the list, so a signed-in non-staff viewer during the staff
 * preview asks the gated `/v1/ustaad/me` once; `null` while asking. Never asked for staff, signed-out viewers or other
 * modes.
 */
function useTesterProbe(enabled: boolean, viewer: string | null, locale: string): boolean | null {
  const [answer, setAnswer] = useState<{ viewer: string; tester: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || viewer === null) return;
    let live = true;
    ustaadClient(locale)
      .then(async (c) => {
        const r = await c.me();
        if (live) setAnswer({ viewer, tester: passedUstaadGate(r, c.sample) });
      })
      .catch(() => {
        if (live) setAnswer({ viewer, tester: false });
      });
    return () => {
      live = false;
    };
  }, [enabled, viewer, locale]);
  if (!enabled) return false;
  return answer?.viewer === viewer ? answer.tester : null;
}

/**
 * What the browser shows inside `/ustaad` (founder 2026-11-26 staff preview). The API is the real boundary (every
 * `/v1/ustaad/*` call is gated there); this only decides what to render, with the same pure rule as the API
 * (`ustaadAccessDecision`): during the preview only staff see the network, everyone else sees the site's ordinary
 * "page not found"; when open, signed-out visitors are asked to sign in. `off` never reaches here (the layout answers a
 * real 404). The shell carries no member data, so nothing personal is in the page for those who are turned away.
 * A preview tester (admin-edited list) is recognised by asking the API (`useTesterProbe`).
 */
export function UstaadGate({
  locale,
  access,
  notFound,
  signIn,
  preview,
  placeholder,
  children,
}: {
  /** From the layout: the gate renders outside the next-intl provider during static prerender. */
  locale: string;
  access: Exclude<UstaadAccessMode, 'off'>;
  notFound: ReactNode;
  signIn: ReactNode;
  preview: ReactNode;
  /**
   * What shows until the answer is known (UI upgrade U1, design § 7.1): the neutral frame (final geometry, no network
   * words) during the staff preview, or the page's shape skeleton inside the server-rendered shell when open. Either
   * way the swap replaces equal-height boxes, so nothing below moves (CLS).
   */
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const session = useSession();
  const staff = session?.role === 'admin';
  const probe = hydrated && access === 'staff_preview' && session !== null && !staff;
  const tester = useTesterProbe(probe, session?.id ?? null, locale);
  if (!hydrated || tester === null) return placeholder;
  const decision = ustaadAccessDecision(access, { signedIn: session !== null, staff, tester });
  if (decision === 'hidden') return notFound;
  if (decision === 'sign_in') return signIn;
  return (
    <>
      {children}
      {/* After the page, not above it: the staff note never pushes the frame down (CLS, U1). */}
      {access === 'staff_preview' && staff ? preview : null}
    </>
  );
}

/** The current page's loading shape (server-rendered with the path, so the first paint already has it). */
export function RouteShape() {
  return <ShapeSkeleton variant={shapeForPath(canonicalPath(usePathname()))} />;
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
