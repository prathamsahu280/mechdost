'use client';

import { CircleDot, Cog, House, LayoutGrid, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canonicalPath } from '@/lib/locale-path';
import { isActive, type PrimaryNavKey } from '@/lib/nav';
import type { NavItem } from './nav-links';

const ICONS: Record<PrimaryNavKey, LucideIcon> = {
  home: House,
  shop: LayoutGrid,
  workshops: Cog,
  vehicles: CircleDot,
};

/**
 * Fixed bottom tab bar under 1024px (phones and tablets): 4 tabs, icon + label, safe-area aware, ≥44px targets.
 * Labels are translated on the server and passed in.
 */
export function MobileTabBar({ label, items }: { label: string; items: readonly NavItem[] }) {
  const pathname = canonicalPath(usePathname());
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur nav:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4 gap-1 px-2 py-1.5">
        {items.map((item) => {
          const Icon = ICONS[item.key];
          const active = isActive(pathname, item.href, item.key === 'home');
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-track={`tab_${item.key}`}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[11px] leading-tight font-bold transition-colors duration-200 ${
                  active ? 'bg-accent-soft text-accent-soft-text' : 'text-muted'
                }`}
              >
                <Icon aria-hidden="true" className="size-[21px]" strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
