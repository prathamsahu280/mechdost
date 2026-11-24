'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { canonicalPath } from '@/lib/locale-path';
import { isActive, type NavKey } from '@/lib/nav';

export interface NavItem {
  key: NavKey;
  /** Already localised on the server (`/hi/shop`). */
  href: string;
  label: string;
  /** Mark active on every page under this path (the business pages share one link). */
  activePrefix?: string;
  /** A lucide icon, rendered by the server so no icon code ships in the client bundle (spec 16 JS budget). */
  icon: ReactNode;
  /** Roadside help (spec 22): drawn in the accent colour so it stands out from the other destinations. */
  emphasis?: boolean;
}

/**
 * Desktop primary navigation (≥1024px, v4 header, decision 2026-11-23): a segmented control on a soft pill. The
 * current page is a white chip with the small orange dashed "tread" under it (`.nav-chip-active`, pure CSS: the chip
 * fades between items as the class moves). Labels show from xl and are visually hidden (still the accessible name)
 * between 1024 and 1279 px. A client island only to mark the current page. Hrefs and labels are localised on the
 * server, so no i18n library ships to the browser.
 */
export function NavLinks({ label, items }: { label: string; items: readonly NavItem[] }) {
  const pathname = canonicalPath(usePathname());
  return (
    <nav aria-label={label} className="mx-auto hidden nav:block">
      <ul className="flex gap-0.5 rounded-[14px] bg-pill p-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href, item.key === 'home', item.activePrefix);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.label}
                data-track={`nav_${item.key}`}
                className={`relative flex min-h-10 min-w-10 items-center justify-center gap-[7px] rounded-[10px] px-2.5 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,box-shadow,color] duration-200 ${
                  active
                    ? 'nav-chip-active bg-chip text-ink'
                    : item.emphasis
                      ? 'bg-accent-soft text-accent-soft-text hover:bg-accent-soft/70'
                      : 'text-muted hover:text-ink'
                }`}
              >
                <span aria-hidden="true" className={`flex ${active ? 'text-accent' : ''}`}>
                  {item.icon}
                </span>
                <span className="sr-only min-[1440px]:not-sr-only min-[1440px]:whitespace-nowrap">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
