'use client';

import { usePathname } from 'next/navigation';
import { UI_ICONS } from '@/lib/icons';
import { switchLocalePath, type SiteLocale } from '@/lib/locale-path';

/**
 * Switches between English and Hindi on the same page. The link text is written in the target language and
 * marked with its `lang`, so screen readers pronounce it correctly.
 *
 * Deliberately a plain `<a>` (full document navigation), not `next/link`: next-intl only writes the NEXT_LOCALE
 * cookie on document requests (`sec-fetch-dest: document`). A client-side `<Link>` fetch never updated it, so
 * after any reload on a Hindi page the stale `hi` cookie sent every "English" click back to `/hi/…`
 * (bug 2026-11-02, e2e `language switch survives reloads`). A language change re-renders every string anyway.
 */
export function LanguageSwitcher({ target, text }: { target: SiteLocale; text: string }) {
  const pathname = usePathname();
  return (
    <a
      href={switchLocalePath(pathname, target)}
      lang={target}
      hrefLang={target}
      data-track={`language_${target}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-bold text-ink hover:bg-pill min-[400px]:px-3"
    >
      <UI_ICONS.language aria-hidden="true" className="hidden size-4 shrink-0 xl:block" strokeWidth={2.25} />
      {text}
    </a>
  );
}
