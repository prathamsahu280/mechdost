import { useLocale, useTranslations } from 'next-intl';
import { LocalLink } from '../ui/local-link';
import { UI_EMOJI } from '@/lib/emoji';
import { AccountLink } from '../auth/account-link';
import { Bell } from '../notices/bell';
import type { BellCopy } from '../notices/bell-copy';
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
    <LocalLink
      href="/"
      className="group inline-flex items-center gap-1.5 min-[380px]:gap-2"
      data-track="brand_home"
    >
      <span
        aria-hidden="true"
        className="font-heading text-[30px] leading-none font-extrabold text-accent min-[380px]:text-[34px] tab:text-[40px]"
      >
        m<span className="align-top text-[22px] tab:text-[26px]">↗</span>
      </span>
      <span className="flex flex-col">
        {/* A little smaller under 380 px so logo, language, account and cart fit a 360 px phone (QA 2026-11-14). */}
        <span className="font-heading text-[19px] leading-none font-extrabold tracking-[-0.04em] text-ink min-[380px]:text-[21px] tab:text-[24px]">
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
  const bell = useTranslations('bell');
  const locale = useLocale();
  // The bell's strings travel as props (no i18n runtime in the browser); `{count}` is filled in there.
  const bellCopy: BellCopy = {
    label: bell('label'),
    labelUnread: bell('labelUnread', { count: '{count}' }),
    liveOne: bell('liveOne'),
    liveOther: bell('liveOther', { count: '{count}' }),
    more: bell('more'),
    seeAll: bell('seeAll'),
    markAllRead: bell('markAllRead'),
    loading: bell('loading'),
    loadError: bell('loadError'),
    retry: bell('retry'),
    unread: bell('unread'),
    emptyTitle: bell('emptyTitle'),
    emptyBody: bell('emptyBody'),
    emptyActionShop: bell('emptyActionShop'),
    emptyActionPortal: bell('emptyActionPortal'),
    close: bell('close'),
  };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 shadow-header backdrop-blur">
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center justify-between gap-1 px-[5%] py-3 sm:gap-2 nav:min-h-[84px]">
        <BrandMark />
        <div className="flex shrink-0 items-center gap-0.5 min-[440px]:gap-1 sm:gap-2">
          <NavLinks label={t('label')} items={navItems} />
          <LanguageSwitcher target={locale === 'hi' ? 'en' : 'hi'} text={language('other')} />
          {/* Visibility on a wrapper: the toggle's own inline-flex would override a `hidden` class. */}
          <span className="hidden min-[400px]:contents">
            <ThemeToggle label={theme('toggle')} />
          </span>
          <Bell copy={bellCopy} locale={locale} />
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
