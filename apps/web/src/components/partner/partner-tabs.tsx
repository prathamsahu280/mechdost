'use client';

import type { PartnerPortal } from '@mechdost/shared/partner-client-events';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import { LocalLink } from '@/components/ui/local-link';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';

export interface PartnerTab {
  /** Short code (analytics + test ids), e.g. `today`. */
  id: string;
  /** Locale-free path, e.g. `/partner/shop/orders`. */
  href: string;
  label: string;
  icon: ReactNode;
  /** Current only on this exact path (the portal home); other tabs also match their sub-pages. */
  exact?: boolean;
}

export function useCurrentTab(tabs: readonly PartnerTab[]): string | null {
  const locale = useLocale();
  const pathname = usePathname();
  for (const tab of tabs) {
    const full = localePath(tab.href, locale);
    if (tab.exact ? pathname === full : pathname === full || pathname.startsWith(`${full}/`)) return tab.id;
  }
  return null;
}

/**
 * The partner tabs (design 2026-11-27 § 4): a bottom bar under 1024 px (52 px tiles, icon over a word, the
 * `accent-soft` current tile like the storefront dock) and a navy side rail from 1024 px. Links with
 * `aria-current="page"`; Hindi labels may wrap to two lines (no fixed widths).
 */
export function PartnerTabs({
  portal,
  tabs,
  label,
  variant,
  onUserNavigate,
}: {
  portal: PartnerPortal;
  tabs: readonly PartnerTab[];
  label: string;
  variant: 'bar' | 'rail';
  /** Called when the partner picks a tab (not on load, back or forward): the frame then moves focus to the heading. */
  onUserNavigate?: () => void;
}) {
  const current = useCurrentTab(tabs);
  const onTab = (id: string) => () => {
    onUserNavigate?.();
    track('partner_tab_viewed', { portal, tab: id });
  };
  if (variant === 'rail') {
    return (
      <nav aria-label={label}>
        <ul className="grid gap-1">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <LocalLink
                href={tab.href}
                onClick={onTab(tab.id)}
                aria-current={current === tab.id ? 'page' : undefined}
                className="flex min-h-12 items-center gap-3 rounded-button px-3 text-[15px] font-bold text-white/85 hover:bg-navy-sidebar-active hover:text-white aria-[current=page]:bg-navy-sidebar-active aria-[current=page]:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span aria-hidden="true" className="flex shrink-0 [&_svg]:size-5 [&_svg]:stroke-[1.9]">
                  {tab.icon}
                </span>
                <span className="min-w-0">{tab.label}</span>
              </LocalLink>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav
      aria-label={label}
      data-partner-tabbar
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-card bg-surface/95 px-1.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] shadow-float backdrop-blur-[16px] nav:hidden"
    >
      <ul
        className="mx-auto grid max-w-xl gap-1"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <li key={tab.id}>
            <LocalLink
              href={tab.href}
              onClick={onTab(tab.id)}
              aria-current={current === tab.id ? 'page' : undefined}
              className="flex min-h-[52px] flex-col items-center justify-center gap-[3px] rounded-2xl px-0.5 text-center leading-tight font-bold text-muted hover:text-ink aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-text focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span aria-hidden="true" className="flex [&_svg]:size-5 [&_svg]:stroke-[1.9]">
                {tab.icon}
              </span>
              <span className="partner-tab-label">{tab.label}</span>
            </LocalLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
