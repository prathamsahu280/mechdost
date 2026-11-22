'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { switchLocalePath, type SiteLocale } from '@/lib/locale-path';

/**
 * Switches between English and Hindi on the same page. The link text is written in the target language and
 * marked with its `lang`, so screen readers pronounce it correctly. Footer button (v4); the account menu has its own
 * menu item with the same behaviour (`account-menu-panel.tsx`).
 *
 * A full page load on purpose (bugs 2026-11-13): the locale proxy only updates the language cookie on a document
 * request, so a client-side switch left `NEXT_LOCALE=hi` and Hindi → English bounced straight back to `/hi`; and a
 * client-side switch rebuilt `<html>` without the saved theme. The query string and hash are kept (they are read
 * at click time: `useSearchParams` would opt static pages out of pre-rendering, and cannot see the hash).
 */
export function LanguageSwitcher({
  target,
  text,
  icon,
}: {
  target: SiteLocale;
  text: string;
  /** The globe icon, rendered by the server. */
  icon: ReactNode;
}) {
  const pathname = usePathname();
  const href = switchLocalePath(pathname, target);
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        window.location.assign(href + window.location.search + window.location.hash);
      }}
      lang={target}
      hrefLang={target}
      data-track={`language_${target}`}
      className="press inline-flex min-h-11 items-center gap-2 rounded-xl bg-pill px-3.5 text-[13.5px] font-bold text-ink hover:bg-line"
    >
      <span aria-hidden="true" className="inline-grid size-[18px] place-items-center">
        {icon}
      </span>
      {text}
    </a>
  );
}
