import { Package, Search, ShoppingCart, UserRound, Wrench } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS } from '@/demo/categories';
import { LocalLink } from '../ui/local-link';
import { AccountMenu, type AccountMenuCopy } from '../auth/account-menu';
import { Bell } from '../notices/bell';
import type { BellCopy } from '../notices/bell-copy';
import { CartPill } from '../commerce/cart-pill';
import { NavLinks, type NavItem } from './nav-links';
import type { SearchData } from './search-data';
import { SearchTrigger } from './search-trigger';
import { SiteText } from './site-overrides';
import { DATA_MODE } from '@/lib/data-mode';
import { localePath } from '@/lib/locale-path';

/** Brand SVGs (traced from the supplied logo, Q172): navy + orange for light, white + orange for dark. */
export const BRAND_LOGO = {
  light: '/brand/mechdost-logo.svg',
  dark: '/brand/mechdost-logo-dark.svg',
} as const;
/** The logo's intrinsic ratio (viewBox 1087.2 x 196.7); width and height reserve the space, so CLS stays 0. */
export const BRAND_LOGO_SIZE = { width: 160, height: 29 } as const;

/**
 * Brand logo (light and dark artwork swapped by CSS, no JS). The hidden image is `display:none`, so the browser never
 * fetches it. `header` is 26 px tall on phones and 30 px from 640 px (v4, decision 2026-11-23); `footer` is 26 px.
 * `max-w-full` + a shrinkable link: when the buttons next to it need the room, the logo gives way instead of the page
 * scrolling sideways (audit 2026-11-16). Plain <img>: a vector logo gains nothing from next/image (unoptimized) and
 * next/image would add ~6 KB of client JS to every page without another image (budget incident 2026-11-16).
 */
export function BrandMark({ variant = 'header' }: { variant?: 'header' | 'footer' }) {
  const t = useTranslations('common');
  const size = variant === 'header' ? 'h-[26px] sm:h-[30px]' : 'h-[26px]';
  return (
    <LocalLink
      href="/"
      className="group inline-flex min-h-11 min-w-0 shrink items-center"
      data-track="brand_home"
    >
      <img
        src={BRAND_LOGO.light}
        alt={t('brand')}
        {...BRAND_LOGO_SIZE}
        decoding="async"
        loading="lazy"
        className={`brand-logo-light ${size} w-auto max-w-full`}
      />
      <img
        src={BRAND_LOGO.dark}
        alt={t('brand')}
        {...BRAND_LOGO_SIZE}
        decoding="async"
        loading="lazy"
        className={`brand-logo-dark ${size} w-auto max-w-full`}
      />
    </LocalLink>
  );
}

export function AnnouncementBar({ region }: { region: string }) {
  const t = useTranslations('announcement');
  const locale = useLocale();
  return (
    // A labelled landmark, so every piece of page content sits in one (axe `region`).
    <aside aria-label={t('label')} data-site-chrome className="bg-navy px-[5%] py-2.5 text-center text-white">
      <p className="eyebrow flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[8px] tracking-[1px] tab:text-[10px] tab:tracking-[1.8px]">
        <span className="font-extrabold">{t('brand')}</span>
        <span className="inline-flex items-center gap-1.5">
          <Package aria-hidden="true" className="size-3.5 tracking-normal" />
          <SiteText k="announcement.orders" locale={locale} fallback={t('orders')} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Wrench aria-hidden="true" className="size-3.5 tracking-normal" />
          <SiteText k="announcement.workshops" locale={locale} fallback={t('workshops', { region })} />
        </span>
      </p>
    </aside>
  );
}

/** Search palette strings and links (the lazy chunk gets them as props: no i18n runtime in the browser). */
function useSearchData(locale: string, roadside: boolean): SearchData {
  const c = useTranslations('chrome');
  const rsa = useTranslations('roadside');
  const cg = useTranslations('catalogue');
  const cat = useTranslations('categories');
  return {
    locale,
    prefix: locale === 'hi' ? '/hi' : '',
    api: DATA_MODE === 'api',
    copy: {
      title: c('searchTitle'),
      placeholder: c('searchPlaceholder'),
      close: c('searchClose'),
      clear: c('searchClear'),
      popular: c('searchPopular'),
      categories: c('searchCategories'),
      suggestions: c('searchSuggestions'),
      count: c('searchCount', { count: '{count}' }),
      seeAll: c('searchSeeAll', { query: '{query}' }),
      sizeAvailable: c('searchSizeAvailable', { size: '{size}' }),
      esc: c('searchEsc'),
      hint: c('searchHint'),
      kind: {
        brand: cg('suggestKind_brand'),
        range: cg('suggestKind_range'),
        category: cg('suggestKind_category'),
        product: cg('suggestKind_product'),
      },
    },
    roadside: roadside
      ? {
          title: rsa('searchTitle'),
          body: rsa('searchBody'),
          kind: rsa('searchKind'),
          href: localePath('/roadside', locale),
        }
      : null,
    popular: [c('popular1'), c('popular2'), c('popular3'), c('popular4'), c('popular5')],
    categories: (['tyres', 'batteries', 'lubricants', 'filters'] as const).map((key) => ({
      label: cat(key),
      href: localePath(`/shop?category=${CATEGORY_SLUGS[key]}`, locale),
    })),
    categoryLabels: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, cat(key)])),
  };
}

/**
 * Floating glass header (v4, user-approved design 2026-11-23, `docs/design-system.md` "Site chrome"): the logo, a
 * segmented nav (≥1024px) with a white chip and a small orange "tread" under the current page, the search pill, the
 * bell, the account avatar (menu) and the navy cart button. Under 1024px it is a compact bar (logo, search icon, bell,
 * cart, avatar); the search icon opens the field inline over the bar (founder 2026-11-27 night), and the bottom dock
 * carries the tabs. The bar shrinks a little while the page
 * scrolls (CSS scroll-driven animation, none under reduced motion). The outer box keeps a fixed height, so the page
 * never reflows when the bar shrinks.
 */
export function Header({
  navItems,
  roadside = false,
}: {
  navItems: readonly NavItem[];
  /** Roadside help is on in this city: the search palette may suggest it (spec 22). */
  roadside?: boolean;
}) {
  const t = useTranslations('nav');
  const auth = useTranslations('auth');
  const bell = useTranslations('bell');
  const c = useTranslations('chrome');
  const lang = useTranslations('language');
  const theme = useTranslations('theme');
  const locale = useLocale();
  const prefix = locale === 'hi' ? '/hi' : '';
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
    done: bell('done'),
    emptyTitle: bell('emptyTitle'),
    emptyBody: bell('emptyBody'),
    emptyActionShop: bell('emptyActionShop'),
    emptyActionPortal: bell('emptyActionPortal'),
    close: bell('close'),
    priorityUrgent: bell('priorityUrgent'),
    priorityAction: bell('priorityAction'),
    priorityInfo: bell('priorityInfo'),
    prioritySuccess: bell('prioritySuccess'),
    removeNamed: bell('removeNamed', { title: '{title}' }),
    clearRead: bell('clearRead'),
    clearedToast: bell('clearedToast', { count: '{count}' }),
    removedToast: bell('removedToast'),
    undo: bell('undo'),
    undoFailed: bell('undoFailed'),
    removeFailed: bell('removeFailed'),
    dismissToast: bell('dismissToast'),
  };
  const accountCopy: AccountMenuCopy = {
    signIn: auth('signIn'),
    account: c('accountMenu'),
    profile: c('menuProfile'),
    orders: c('menuOrders'),
    refunds: c('menuRefunds'),
    vehicles: c('menuVehicles'),
    saved: c('menuSaved'),
    portal: c('menuPortal'),
    dark: theme('toggle'),
    language: lang('switch'),
    signOut: auth('signOut'),
    signedOut: auth('signedOutStatus'),
  };
  const searchIcon = <Search aria-hidden="true" size={18} strokeWidth={1.9} />;
  return (
    <>
      <header
        data-site-chrome
        className="sticky top-0 z-30 h-[66px] px-2.5 pt-2.5 tab:px-5 nav:h-[78px] nav:pt-3.5"
      >
        <div className="header-bar relative mx-auto flex h-14 max-w-[1320px] items-center gap-2 rounded-[18px] bg-surface/80 pr-1.5 pl-3 shadow-float backdrop-blur-[14px] backdrop-saturate-150 nav:h-16 nav:gap-3.5 nav:rounded-[20px] nav:pr-2.5 nav:pl-4">
          <BrandMark />
          <NavLinks label={t('label')} items={navItems} />
          <div className="ml-auto flex items-center gap-1 nav:ml-0">
            <SearchTrigger
              variant="bar"
              data={useSearchData(locale, roadside)}
              label={c('searchOpenLabel')}
              text={c('searchTrigger')}
              hint="/"
              icon={searchIcon}
            />
            <SearchTrigger
              variant="phone"
              label={c('searchOpenLabel')}
              text={c('searchPhone')}
              icon={searchIcon}
            />
            <Bell copy={bellCopy} locale={locale} />
            <div className="order-2 empty:hidden nav:order-none">
              <AccountMenu
                prefix={prefix}
                copy={accountCopy}
                signInIcon={<UserRound aria-hidden="true" size={18} strokeWidth={1.9} />}
              />
            </div>
            <div className="order-1 empty:hidden nav:order-none">
              <CartPill
                href={localePath('/cart', locale)}
                label={t('cart')}
                icon={<ShoppingCart aria-hidden="true" size={18} strokeWidth={1.9} />}
                countText={{ zero: t('cartCountZero'), one: t('cartCountOne'), other: t('cartCountOther') }}
              />
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
