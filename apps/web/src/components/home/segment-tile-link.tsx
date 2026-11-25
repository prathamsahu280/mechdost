'use client';

import NextLink from 'next/link';
import type { ReactNode } from 'react';
import type { VehicleSegment } from '@mechdost/shared/vehicle-segments';
import { track } from '@/lib/analytics';

/** A "Shop by vehicle" tile: a plain link that also reports `home_segment_tile_clicked` (spec 12). */
export function SegmentTileLink({
  href,
  segment,
  className,
  children,
}: {
  /** The locale-prefixed shop path with the segment filter, built on the server. */
  href: string;
  segment: VehicleSegment;
  className: string;
  children: ReactNode;
}) {
  return (
    <NextLink
      href={href}
      className={className}
      onClick={() => {
        track('home_segment_tile_clicked', { segment });
      }}
    >
      {children}
    </NextLink>
  );
}
