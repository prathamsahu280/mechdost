'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canonicalPath } from '@/lib/locale-path';
import { isActive } from '@/lib/nav';
import { isPortalPath } from '@/lib/portal-path';
import type { NavItem } from './nav-links';

/**
 * Floating dock under 1024px (v4, decision 2026-11-23): a glass rounded bar inset from the screen edges with 4 tabs,
 * line icon over a label, the current one a soft orange tile. Safe-area aware, ≥48px targets. Labels are translated
 * and icons rendered on the server and passed in (no i18n runtime or icon code in the browser).
 */
export function MobileTabBar({ label, items }: { label: string; items: readonly NavItem[] }) {
  const raw = usePathname();
  const pathname = canonicalPath(raw);
  // Shopper navigation; the portals have their own section bar (QA 2026-11-14, U16).
  if (isPortalPath(raw)) return null;
  // Five tabs (the roadside tab is on) get a slightly wider bar and tighter tiles so "Workshops" stays on one line at 320 px.
  const five = items.length > 4;
  return (
    <nav
      aria-label={label}
      data-dock
      className={`fixed ${five ? 'inset-x-2' : 'inset-x-3.5'} bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-xl rounded-[22px] bg-surface/92 ${five ? 'p-1' : 'p-1.5'} shadow-float backdrop-blur-[16px] backdrop-saturate-150 nav:hidden`}
    >
      <ul className={five ? 'grid grid-cols-5 gap-0' : 'grid grid-cols-4 gap-1'}>
        {items.map((item) => {
          const active = isActive(pathname, item.href, item.key === 'home');
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-track={`tab_${item.key}`}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-[3px] rounded-2xl ${five ? 'px-0' : 'px-1'} text-center text-[11px] leading-tight font-bold transition-colors duration-200 ${
                  active
                    ? 'bg-accent-soft text-accent-soft-text'
                    : item.emphasis
                      ? 'text-accent-soft-text hover:bg-accent-soft/60'
                      : 'text-muted hover:text-ink'
                }`}
              >
                <span aria-hidden="true" className="flex">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
