'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { stripLocale } from '@/lib/locale-path';
import { ustaadTabFor, type UstaadTabKey } from './tabs';

export interface UstaadTab {
  key: UstaadTabKey;
  /** Localised href (`/hi/ustaad/…` in Hindi). */
  href: string;
  /** Canonical path (kept for the rail and tests). */
  path: string;
  label: string;
  /** Accessible name when it differs from the label ("Create a post"). */
  ariaLabel?: string;
  icon: ReactNode;
  /** The filled icon shown while the tab is current (state is never colour alone). */
  iconCurrent: ReactNode;
}

/**
 * Whether a canonical path is the page being shown, in either language: the locale prefix (`/hi`, internal `/en`) is
 * stripped first — the Hindi dock never marked its tab when only `/en` was removed (QA 2026-11-27).
 */
export function isCurrentUstaadTab(pathname: string, path: string): boolean {
  const here = stripLocale(pathname);
  if (path === '/ustaad') return here === '/ustaad';
  return here === path || here.startsWith(`${path}/`);
}

/** Rail-only entries under the five tabs (Discover, Learn, My network, Messages, Saved). */
export interface UstaadRailLink {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
}

/** Shared class constants (the visual-language pass swaps colours and motion here, in one place). */
const DOCK =
  'fixed inset-x-0 bottom-0 z-40 h-[calc(64px+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] nav:hidden';
const DOCK_TAB =
  'relative flex h-16 flex-col items-center justify-center gap-0.5 px-0.5 text-center text-[13px] leading-tight font-bold transition-colors duration-150 focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus [&:lang(hi)]:text-[14px]';
const DOCK_CURRENT = 'text-ink';
const DOCK_IDLE = 'text-muted hover:text-ink';
/** The 3 px accent bar on the current tab (accent on surface ≥ 3:1). */
const DOCK_BAR = 'block h-[3px] rounded-b-full bg-accent';
/** The track the bar slides in: one tab wide, moved by `translateX(index × 100%)` (280 ms spring, motion-safe only). */
const DOCK_BAR_SLOT =
  'pointer-events-none absolute top-0 left-0 px-3 motion-safe:transition-transform motion-safe:duration-[280ms] motion-safe:ease-spring-snappy';
const CREATE_DISC =
  'flex size-10 items-center justify-center rounded-full bg-accent-button text-white shadow-card group-hover:bg-accent-button-hover';
const RAIL_ITEM =
  'press flex min-h-12 items-center gap-3 rounded-button px-4 text-[15px] font-bold transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-focus';

/**
 * The network's navigation (spec 23 § 5; UI upgrade U1, design § 3.0; founder Q-UI-1): a full-width dock of five tabs
 * under 1024 px — Home · Ask · + Create · Jobs · Me — with a word under every icon (13 px, Hindi 14 px), the current
 * tab marked by a filled icon, ink text and a 3 px accent bar, and exactly one `aria-current`; a left rail above
 * 1024 px with the same tabs plus Discover, Learn, My network, Messages and Saved. Labels and icons come from the
 * server (no i18n runtime here). The dock hides while a text field has focus on phones (globals.css).
 */
export function UstaadNav({
  tabs,
  extras = [],
  label,
}: {
  tabs: readonly UstaadTab[];
  extras?: readonly UstaadRailLink[];
  label: string;
}) {
  const pathname = usePathname();
  const currentTab = ustaadTabFor(pathname);
  const barIndex = tabs.findIndex((t) => t.key === currentTab);
  return (
    <>
      <nav aria-label={label} data-ustaad-dock className={DOCK}>
        <div className="relative mx-auto h-16 max-w-xl">
          {/* M3 dock shift (visual language § 5): one bar that slides to the current tab (compositor-only). */}
          <span
            aria-hidden="true"
            className={`${DOCK_BAR_SLOT} ${barIndex < 0 ? 'opacity-0' : ''}`}
            style={{
              width: `${String(100 / tabs.length)}%`,
              transform: `translateX(${String(Math.max(barIndex, 0) * 100)}%)`,
            }}
          >
            <span className={DOCK_BAR} />
          </span>
          <ul className="grid h-16 grid-cols-5">
            {tabs.map((tab) => {
              const current = currentTab === tab.key;
              const create = tab.key === 'create';
              return (
                <li key={tab.key}>
                  <Link
                    href={tab.href}
                    aria-label={create ? (tab.ariaLabel ?? tab.label) : undefined}
                    aria-current={current ? 'page' : undefined}
                    data-track={`ustaad_tab_${tab.key}`}
                    className={`group ${DOCK_TAB} ${current ? DOCK_CURRENT : DOCK_IDLE}`}
                  >
                    {create ? (
                      <span className={CREATE_DISC}>{tab.icon}</span>
                    ) : current ? (
                      tab.iconCurrent
                    ) : (
                      tab.icon
                    )}
                    <span>{tab.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
      <nav aria-label={label} className="hidden nav:block">
        <ul className="sticky top-20 grid gap-1">
          {tabs.map((tab) => {
            const current = currentTab === tab.key;
            const create = tab.key === 'create';
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={current ? 'page' : undefined}
                  data-track={`ustaad_rail_${tab.key}`}
                  className={`${RAIL_ITEM} ${
                    create
                      ? 'my-2 bg-accent-button text-white hover:bg-accent-button-hover'
                      : current
                        ? 'bg-accent-soft text-accent-soft-text'
                        : 'text-ink hover:bg-pill'
                  }`}
                >
                  {current && !create ? tab.iconCurrent : tab.icon}
                  <span>{create ? (tab.ariaLabel ?? tab.label) : tab.label}</span>
                </Link>
              </li>
            );
          })}
          {extras.length > 0 ? <li aria-hidden="true" className="my-2 border-t border-line" /> : null}
          {extras.map((x) => {
            const current = currentTab === null && isCurrentUstaadTab(pathname, `/ustaad/${x.key}`);
            return (
              <li key={x.key}>
                <Link
                  href={x.href}
                  aria-current={current ? 'page' : undefined}
                  data-track={`ustaad_rail_${x.key}`}
                  className={`${RAIL_ITEM} ${current ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'}`}
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
