import { useLocale, useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { getPathname } from '@/i18n/navigation';
import { AccountLink } from '../auth/account-link';
import { CartPill } from '../commerce/cart-pill';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { CategoryBar } from './category-bar';
import { HeaderSearch } from './header-search';
import type { NavItem } from './nav-links';

/** Concept brand lock-up: orange "m↗" mark, MechDost wordmark, tracked tagline. */
export function BrandMark() {
  const t = useTranslations('common');
  return (
    <LocalLink href="/" className="group inline-flex items-center gap-2" data-track="brand_home">
      <span
        aria-hidden="true"
        className="font-heading text-[34px] leading-none font-extrabold text-accent tab:text-[40px]"
      >
        m<span className="align-top text-[22px] tab:text-[26px]">↗</span>
      </span>
      <span className="flex flex-col">
        <span className="font-heading text-[21px] leading-none font-extrabold tracking-[-0.04em] text-ink tab:text-[24px]">
          {t('brand')}
        </span>
        <span className="eyebrow mt-1.5 hidden text-[7px] whitespace-nowrap text-ink min-[400px]:block tab:text-[8px]">
          {t('tagline')}
        </span>
      </span>
    </LocalLink>
  );
}

/**
 * Header (redesign 2026-11-02, SpareVillage-style): a slim sticky row — brand, a prominent site search, language,
 * theme, account, cart — then the non-sticky category bar with the primary links. On phones the search drops to
 * its own full-width line inside the sticky row; primary navigation lives in the bottom tab bar there.
 */
export function Header({ navItems }: { navItems: readonly NavItem[] }) {
  const t = useTranslations('nav');
  const language = useTranslations('language');
  const theme = useTranslations('theme');
  const auth = useTranslations('auth');
  const locale = useLocale();
  return (
    <>
      <header className="site-header sticky top-0 z-30 border-b border-line bg-surface/95 shadow-header backdrop-blur">
        <div className="mx-auto grid max-w-[1600px] grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 px-[5%] py-2.5 [grid-template-areas:'brand_actions'_'search_search'] tab:grid-cols-[auto_minmax(0,1fr)_auto] tab:gap-x-6 tab:py-3 tab:[grid-template-areas:'brand_search_actions']">
          <div className="[grid-area:brand]">
            <BrandMark />
          </div>
          <HeaderSearch className="w-full [grid-area:search] tab:mx-auto tab:max-w-[640px]" />
          <div className="flex shrink-0 items-center justify-end gap-0.5 [grid-area:actions] min-[400px]:gap-1 sm:gap-2">
            <LanguageSwitcher target={locale === 'hi' ? 'en' : 'hi'} text={language('other')} />
            {/* Visibility on a wrapper: the toggle's own inline-flex would override a `hidden` class. */}
            <span className="hidden min-[400px]:contents">
              <ThemeToggle label={theme('toggle')} />
            </span>
            <AccountLink
              prefix={locale === 'hi' ? '/hi' : ''}
              signIn={auth('signIn')}
              account={t('account')}
            />
            <CartPill
              href={getPathname({ href: '/cart', locale })}
              label={t('cart')}
              countText={{ zero: t('cartCountZero'), one: t('cartCountOne'), other: t('cartCountOther') }}
            />
          </div>
        </div>
      </header>
      <CategoryBar navItems={navItems} navLabel={t('label')} />
    </>
  );
}
