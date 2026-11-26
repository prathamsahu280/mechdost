'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { canonicalPath } from '@/lib/locale-path';

export interface UstaadTab {
  key: 'home' | 'discover' | 'create' | 'learn' | 'me';
  /** Localised href (`/hi/ustaad/…` in Hindi). */
  href: string;
  /** Canonical path used to decide the current tab. */
  path: string;
  label: string;
  /** Accessible name when it differs from the label ("Create a post"). */
  ariaLabel?: string;
  icon: ReactNode;
}

function isCurrent(pathname: string, path: string): boolean {
  if (path === '/ustaad') return pathname === '/ustaad';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The network's own navigation (spec 23 § 5): a dock of five tabs under 1024 px (Home · Discover · Create · Learn · Me,
 * Create raised in the middle, like the apps mechanics already use) and a left rail above. One tab bar per screen: the
 * site's dock hides itself inside `/ustaad` (`isPortalPath`). Labels and icons come from the server (no i18n runtime
 * here); the current tab carries `aria-current="page"`; every target is at least 52 px tall.
 */
/** Rail-only entries under the five tabs (My network, Messages, Saved); on phones they live on Home and the header. */
export interface UstaadRailLink {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
}

export function UstaadNav({
  tabs,
  extras = [],
  label,
}: {
  tabs: readonly UstaadTab[];
  extras?: readonly UstaadRailLink[];
  label: string;
}) {
  const pathname = canonicalPath(usePathname());
  return (
    <>
      <nav
        aria-label={label}
        data-ustaad-dock
        className="fixed inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-[22px] bg-surface/95 p-1.5 shadow-float backdrop-blur-[16px] nav:hidden"
      >
        <ul className="grid grid-cols-5 items-end gap-0.5">
          {tabs.map((tab) => {
            const current = isCurrent(pathname, tab.path);
            if (tab.key === 'create')
              return (
                <li key={tab.key} className="flex justify-center">
                  <Link
                    href={tab.href}
                    aria-label={tab.ariaLabel ?? tab.label}
                    aria-current={current ? 'page' : undefined}
                    data-track="ustaad_tab_create"
                    className="press -mt-6 flex size-[60px] items-center justify-center rounded-full bg-accent-button text-white shadow-float ring-4 ring-surface hover:bg-accent-button-hover"
                  >
                    {tab.icon}
                  </Link>
                </li>
              );
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={current ? 'page' : undefined}
                  data-track={`ustaad_tab_${tab.key}`}
                  className={`flex min-h-[54px] flex-col items-center justify-center gap-[3px] rounded-2xl px-0.5 text-center text-[11.5px] leading-tight font-bold transition-colors duration-200 ${
                    current ? 'bg-accent-soft text-accent-soft-text' : 'text-muted hover:text-ink'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <nav aria-label={label} className="hidden nav:block">
        <ul className="sticky top-24 grid gap-1">
          {tabs.map((tab) => {
            const current = isCurrent(pathname, tab.path);
            const create = tab.key === 'create';
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={current ? 'page' : undefined}
                  data-track={`ustaad_rail_${tab.key}`}
                  className={`press flex min-h-12 items-center gap-3 rounded-button px-4 text-[15px] font-bold transition-colors duration-200 ${
                    create
                      ? 'mt-2 bg-accent-button text-white hover:bg-accent-button-hover'
                      : current
                        ? 'bg-accent-soft text-accent-soft-text'
                        : 'text-ink hover:bg-pill'
                  }`}
                >
                  {tab.icon}
                  <span>{create ? (tab.ariaLabel ?? tab.label) : tab.label}</span>
                </Link>
              </li>
            );
          })}
          {extras.length > 0 ? <li aria-hidden="true" className="my-2 border-t border-line" /> : null}
          {extras.map((x) => {
            const current = isCurrent(pathname, `/ustaad/${x.key}`);
            return (
              <li key={x.key}>
                <Link
                  href={x.href}
                  aria-current={current ? 'page' : undefined}
                  data-track={`ustaad_rail_${x.key}`}
                  className={`press flex min-h-12 items-center gap-3 rounded-button px-4 text-[15px] font-bold transition-colors duration-200 focus-visible:outline-3 focus-visible:outline-focus ${
                    current ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
                  }`}
                >
                  {x.icon}
                  <span>{x.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
