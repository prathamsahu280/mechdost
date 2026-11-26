'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isUstaadPublicPath } from '@/lib/ustaad/public-paths';
import { canonicalPath } from '@/lib/locale-path';

/**
 * The share teaser `/ustaad/s/[token]` is the one page under `/ustaad` that people who are not members open (a
 * WhatsApp link, SR-44): it renders without the network's gate and shell, so a signed-out visitor sees the generic
 * card instead of "page not found" or the dock. Every other `/ustaad` page stays behind the gate.
 */
export function UstaadPublicSwitch({
  open,
  enabled,
  children,
}: {
  open: ReactNode;
  /** Only while `ustaad.access = open`: during the staff preview the gate decides ("page not found" for others). */
  enabled: boolean;
  children: ReactNode;
}) {
  const pathname = canonicalPath(usePathname());
  return <>{enabled && isUstaadPublicPath(pathname) ? open : children}</>;
}
