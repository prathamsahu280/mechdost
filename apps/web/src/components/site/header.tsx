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

/** Brand SVGs (traced from the supplied logo, Q172): navy + orange for light, white + orange for dark. */
export const BRAND_LOGO = {
  light: '/brand/mechdost-logo.svg',
  dark: '/brand/mechdost-logo-dark.svg',
} as const;
/** The logo's intrinsic ratio (viewBox 1087.2 x 196.7); width and height reserve the space, so CLS stays 0. */
export const BRAND_LOGO_SIZE = { width: 160, height: 29 } as const;

/**
 * Brand lock-up: the MechDost logo (light and dark artwork swapped by CSS, no JS) with the tracked tagline under it.
 * The hidden image is `display:none`, so the browser never fetches it.
 */
export function BrandMark() {
  const t = useTranslations('common');
  // A little narrower under 460 px so logo, language, account and cart fit a 360 px phone (QA 2026-11-14).
  // `max-w-full` + a shrinkable link: when the buttons next to it need the room (signed in with the bell, a long
  // language name), the logo gives way instead of the page scrolling sideways (audit 2026-11-16, 4-31 px at 390/480/1024).
  // Plain <img>: a vector logo gains nothing from next/image (unoptimized) and next/image would add ~6 KB of client JS
  // to every page without another image (budget incident 2026-11-16; decisions same date).
  const size = 'h-auto w-[132px] max-w-full min-[460px]:w-[152px] tab:w-[176px]';
  return (
    <LocalLink
      href="/"
      className="group inline-flex min-h-6 min-w-0 shrink flex-col items-start justify-center"
      data-track="brand_home"
    >
      <img
        src={BRAND_LOGO.light}
        alt={t('brand')}
        {...BRAND_LOGO_SIZE}
        decoding="async"
        loading="lazy"
        className={`brand-logo-light ${size}`}
      />
      <img
        src={BRAND_LOGO.dark}
        alt={t('brand')}
        {...BRAND_LOGO_SIZE}
        decoding="async"
        loading="lazy"
        className={`brand-logo-dark ${size}`}
      />
      <span className="eyebrow mt-1.5 hidden text-[7px] whitespace-nowrap text-ink tab:block nav:hidden xl:block tab:text-[8px]">
        {t('tagline')}
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
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center justify-between gap-1 px-[5%] py-3 nav:px-6 xl:px-[5%] sm:gap-2 nav:min-h-[84px]">
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
