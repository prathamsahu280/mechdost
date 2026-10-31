'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { switchLocalePath, type SiteLocale } from '@/lib/locale-path';

/**
 * Switches between English and Hindi on the same page. The link text is written in the target language and
 * marked with its `lang`, so screen readers pronounce it correctly. Not prefetched: the target redirects and
 * sets the language cookie, which should only happen on a real click.
 */
export function LanguageSwitcher({ target, text }: { target: SiteLocale; text: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={switchLocalePath(pathname, target)}
      prefetch={false}
      lang={target}
      hrefLang={target}
      data-track={`language_${target}`}
      className="inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-bold text-ink hover:bg-pill min-[400px]:px-3"
    >
      {text}
    </Link>
  );
}
