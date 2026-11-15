'use client';

import Link, { useLinkStatus } from 'next/link';
import type { ComponentProps } from 'react';

/** Small dot at the end of the clicked link while its page loads: absolute, so nothing around it moves (CLS). */
function PendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      data-pending=""
      className="absolute top-1/2 right-2 size-1.5 -translate-y-1/2 rounded-full bg-accent-button motion-safe:animate-pulse"
    />
  );
}

/**
 * Side-bar link of the account and admin portals. The bars live in a layout and stay mounted between sections; this
 * link only adds a light "loading" cue on the link that was clicked, instead of blanking the frame.
 */
export function PortalNavLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link {...rest} className={`relative ${className ?? ''}`}>
      {children}
      <PendingDot />
    </Link>
  );
}
