import { useLocale, useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { UI_EMOJI } from '@/lib/emoji';
import { AccountLink } from '../auth/account-link';
import { CartPill } from '../commerce/cart-pill';
import { LanguageSwitcher } from './language-switcher';
import { ThemeToggle } from './theme-toggle';
import { NavLinks, type NavItem } from './nav-links';
import { SiteText } from './site-overrides';
import { localePath } from '@/lib/locale-path';

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
        <span className="eyebrow mt-1.5 hidden text-[7px] whitespace-nowrap text-ink sm:block tab:text-[8px]">
          {t('tagline')}
        </span>
      </span>
    </LocalLink>
  );
}

export function AnnouncementBar({ city }: { city: string }) {
  const t = useTranslations('announcement');
  const locale = useLocale();
  return (
    // A labelled landmark, so every piece of page content sits in one (axe `region`).
    <aside aria-label={t('label')} className="bg-navy px-[5%] py-2.5 text-center text-white">
      <p className="eyebrow flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[8px] tracking-[1px] tab:text-[10px] tab:tracking-[1.8px]">
        <span className="font-extrabold">{t('brand')}</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="text-[12px] tracking-normal">
            {UI_EMOJI.orders}
          </span>
          <SiteText k="announcement.orders" locale={locale} fallback={t('orders')} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="text-[12px] tracking-normal">
            {UI_EMOJI.workshops}
          </span>
          <SiteText k="announcement.workshops" locale={locale} fallback={t('workshops', { city })} />
        </span>
      </p>
    </aside>
  );
}

/** Sticky header: brand, primary nav (≥1024px), language, theme, account and the live cart pill. */
export function Header({ navItems }: { navItems: readonly NavItem[] }) {
  const t = useTranslations('nav');
  const language = useTranslations('language');
  const theme = useTranslations('theme');
  const auth = useTranslations('auth');
  const locale = useLocale();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 shadow-header backdrop-blur">
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center justify-between gap-1 px-[5%] py-3 sm:gap-2 nav:min-h-[84px]">
        <BrandMark />
        <div className="flex shrink-0 items-center gap-0.5 min-[440px]:gap-1 sm:gap-2">
          <NavLinks label={t('label')} items={navItems} />
          <LanguageSwitcher target={locale === 'hi' ? 'en' : 'hi'} text={language('other')} />
          {/* Visibility on a wrapper: the toggle's own inline-flex would override a `hidden` class. */}
          <span className="hidden sm:contents">
            <ThemeToggle label={theme('toggle')} />
          </span>
          <AccountLink prefix={locale === 'hi' ? '/hi' : ''} signIn={auth('signIn')} account={t('account')} />
          <CartPill
            href={localePath('/cart', locale)}
            label={t('cart')}
            countText={{ zero: t('cartCountZero'), one: t('cartCountOne'), other: t('cartCountOther') }}
          />
        </div>
      </div>
    </header>
  );
}
