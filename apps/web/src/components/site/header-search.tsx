import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { localePath } from '@/lib/locale-path';

/**
 * Site-wide product search in the header (redesign 2026-11-02, SpareVillage-style: search is the first thing you
 * see). A plain GET to /shop?q=, so it works before JS loads; the shop page then filters live.
 */
export function HeaderSearch({ className = '' }: { className?: string }) {
  const t = useTranslations('header');
  const locale = useLocale();
  return (
    <form
      role="search"
      action={localePath('/shop', locale)}
      method="get"
      data-track-search="header"
      className={`relative ${className}`}
    >
      <label htmlFor="site-search" className="sr-only">
        {t('searchLabel')}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-muted"
      />
      <input
        id="site-search"
        name="q"
        type="search"
        maxLength={120}
        autoComplete="off"
        enterKeyHint="search"
        placeholder={t('searchPlaceholder')}
        className="shop-search min-h-12 w-full rounded-pill border border-line-card bg-pill pr-28 pl-11 text-[15px] text-ink transition-[border-color,background-color] duration-[var(--duration-fast)] placeholder:text-muted hover:border-input-border focus:border-input-border focus:bg-surface"
      />
      <button
        type="submit"
        className="press absolute top-1/2 right-1.5 inline-flex min-h-9 -translate-y-1/2 items-center rounded-pill bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
      >
        {t('searchSubmit')}
      </button>
    </form>
  );
}
