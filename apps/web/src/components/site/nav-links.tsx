'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canonicalPath } from '@/lib/locale-path';
import { NAV_ICONS } from '@/lib/icons';
import { isActive, type PrimaryNavKey } from '@/lib/nav';

export interface NavItem {
  key: PrimaryNavKey;
  /** Already localised on the server (`/hi/shop`). */
  href: string;
  label: string;
}

/**
 * Desktop primary navigation (≥1024px). A client island only to mark the current page. Hrefs and labels are
 * localised on the server, so no i18n library ships to the browser (performance budget, spec 16).
 */
export function NavLinks({ label, items }: { label: string; items: readonly NavItem[] }) {
  const pathname = canonicalPath(usePathname());
  return (
    <nav aria-label={label} className="hidden nav:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href, item.key === 'home');
          const Icon = NAV_ICONS[item.key];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                data-track={`nav_${item.key}`}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[13px] xl:px-3.5 font-bold transition-colors duration-200 ${
                  active ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
                }`}
              >
                <Icon aria-hidden="true" className="hidden size-4 shrink-0 xl:block" strokeWidth={2.25} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
