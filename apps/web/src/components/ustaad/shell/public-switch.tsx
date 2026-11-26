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
export function UstaadPublicSwitch({ open, children }: { open: ReactNode; children: ReactNode }) {
  const pathname = canonicalPath(usePathname());
  return <>{isUstaadPublicPath(pathname) ? open : children}</>;
}
