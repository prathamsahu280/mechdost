'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics';

/** The sheet loads on intent (design § 7.5b): no sheet code in Home's first load. */
const Sheet = dynamic(() => import('./sheet').then((m) => m.Sheet), { ssr: false });

export interface MoreLink {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
}

/** One class constant for the tiles (the visual-language pass restyles them here). */
export const HOME_TILE =
  'press flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-tile border border-line-card bg-surface px-2 py-3 text-center text-[13.5px] leading-tight font-bold text-ink shadow-card hover:border-accent focus-visible:outline-3 focus-visible:outline-focus';
export const HOME_TILE_ICON =
  'flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text';

/**
 * Home "More" (UI upgrade U1, design § 3.1 item 3): the shortcuts beyond the first four (Discover, My network, Area
 * map, Saved, Pin garage, My card) in the shared sheet, so Home stays calm. Closes with Cancel, Escape and focus return
 * (the sheet's own rules); labels and links come from the server.
 */
export function HomeMore({
  label,
  title,
  icon,
  links,
}: {
  label: string;
  title: string;
  icon: ReactNode;
  links: readonly MoreLink[];
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          track('ustaad_home_more_opened', {});
        }}
        className={`${HOME_TILE} w-full`}
      >
        <span className={HOME_TILE_ICON}>{icon}</span>
        {label}
      </button>
      {open ? (
        <Sheet
          title={title}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        >
          <ul className="grid grid-cols-3 gap-3">
            {links.map((l) => (
              <li key={l.key}>
                <Link href={l.href} data-track={`ustaad_shortcut_${l.key}`} className={HOME_TILE}>
                  <span className={HOME_TILE_ICON}>{l.icon}</span>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}
