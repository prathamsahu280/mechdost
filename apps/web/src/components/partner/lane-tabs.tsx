'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import type { KeyboardEvent } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';

export interface Lane {
  id: string;
  label: string;
  /** "3", "20+", or null while loading. */
  count: string | null;
  /** Accessible name with the count in words, e.g. "Packing, 3 orders". */
  name?: string;
}

/**
 * Order/job lanes as tabs with counts (design 2026-11-27 § 4): links with `?lane=` so the URL keeps the state,
 * `aria-current` on the open lane, scrolls inside its own box at 360 px, arrow keys (wrapping) and Home/End move between lanes. The caller
 * reads the lane from its page's `searchParams` (no search-params hook here, so no Suspense boundary is needed).
 */
export function LaneTabs({
  portal,
  label,
  lanes,
  current,
  hrefFor,
}: {
  portal: PartnerPortal;
  label: string;
  lanes: readonly Lane[];
  current: string;
  /** Locale-free href for a lane, e.g. `(id) => '/partner/shop/orders?lane=' + id`. */
  hrefFor: (id: string) => string;
}) {
  function onKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return; // keep Alt+Left, Ctrl+Home, … for the browser
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a')];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    e.preventDefault();
    let to = 0;
    if (e.key === 'End') to = links.length - 1;
    else if (e.key !== 'Home') to = (at + (e.key === 'ArrowRight' ? 1 : links.length - 1)) % links.length;
    links[to]?.focus();
  }
  // 8 px of room on every side: the 3 px focus outline + 2 px offset is 5 px and an `overflow` box clips it (2.4.7/2.4.11).
  return (
    <nav aria-label={label} className="lane-seg -mx-2 -my-2 scroll-px-2 overflow-x-auto px-2 py-2">
      <ul className="flex w-max gap-2" onKeyDown={onKey}>
        {lanes.map((lane) => {
          const on = lane.id === current;
          return (
            <li key={lane.id}>
              <LocalLink
                href={hrefFor(lane.id)}
                scroll={false}
                aria-current={on ? 'page' : undefined}
                aria-label={lane.name}
                onClick={() => {
                  track('partner_lane_viewed', { portal, lane: lane.id });
                }}
                className="lane-tab press inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-sm font-bold whitespace-nowrap text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {lane.label}
                <span className="lane-tab-count min-w-6 rounded-pill px-1.5 text-center text-xs font-extrabold tabular-nums">
                  {lane.count ?? '…'}
                </span>
              </LocalLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
