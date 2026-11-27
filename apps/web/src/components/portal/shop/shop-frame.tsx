'use client';

import { MyShops, type MyShopDto } from '@mechdost/shared/shop-api';
import { Boxes, ChartColumn, ClipboardList, House, Store } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PartnerFrame, PartnerStrip, type PartnerTab } from '@/components/partner';
import { findShop } from '@/demo/shops';
import { localizeShop } from '@/demo/i18n/localize';
import { adminApi } from '@/lib/admin-api';
import { AUTH_MODE } from '@/lib/auth/mode';
import { localePath } from '@/lib/locale-path';
import { SHOP_TABS, legacyShopTarget, shopStripState, type ShopTab } from '@/lib/shop-portal-view';
import { PartnerGate } from '../partner-gate';
import { PortalGuard } from '../portal-guard';

interface ShopAccount {
  /** Demo builds: the signed-in shop's slug. */
  slug: string;
  /** Real sign-in: the tabs read and act through the API. */
  api: boolean;
}
const Account = createContext<ShopAccount | null>(null);
export const useShopAccount = (): ShopAccount | null => useContext(Account);

const ICON: Record<ShopTab, ReactNode> = {
  today: <House />,
  orders: <ClipboardList />,
  stock: <Boxes />,
  numbers: <ChartColumn />,
  profile: <Store />,
};
const LABEL = {
  today: 'tab_today',
  orders: 'tab_orders',
  stock: 'tab_stock',
  numbers: 'tab_numbers',
  profile: 'tab_shop',
} as const satisfies Record<ShopTab, string>;

/**
 * The shop portal frame (partner portals UI upgrade, batch A; design 2026-11-27 § 5): guard, navy strip, bottom tabs
 * under 1024 px and a side rail above, all mounted in the layout so a tab change never remounts them (no reload
 * feel). Old one-page anchors (`#warnings`, `#prices-title`, …) are sent on to the tab that holds the block now.
 */
export function ShopFrame({ children }: { children: ReactNode }) {
  const api = AUTH_MODE === 'firebase';
  return (
    <PortalGuard role="shop" path="/partner/shop" demoNote={!api}>
      {(account) => (
        <Account.Provider value={{ slug: account.partner ?? '', api }}>
          <Frame api={api} slug={account.partner ?? ''}>
            {children}
          </Frame>
        </Account.Provider>
      )}
    </PortalGuard>
  );
}

function Frame({ api, slug, children }: { api: boolean; slug: string; children: ReactNode }) {
  const t = useTranslations('partnerShop');
  const router = useRouter();
  const locale = useLocale();
  const tabs: PartnerTab[] = SHOP_TABS.map((tab) => ({
    id: tab.key,
    href: tab.path,
    label: t(LABEL[tab.key]),
    icon: ICON[tab.key],
    exact: tab.key === 'today',
  }));

  useEffect(() => {
    const target = legacyShopTarget(window.location.hash);
    if (target) router.replace(localePath(target, locale));
  }, [router, locale]);

  return (
    <PartnerFrame
      portal="shop"
      navLabel={t('tabs_label')}
      railTitle={t('rail_title')}
      tabs={tabs}
      strip={api ? <ApiStrip /> : <DemoStrip slug={slug} />}
    >
      {api ? (
        children
      ) : (
        <PartnerGate kind="shop" slug={slug}>
          {children}
        </PartnerGate>
      )}
    </PartnerFrame>
  );
}

function DemoStrip({ slug }: { slug: string }) {
  const locale = useLocale();
  const found = findShop(slug);
  const t = useTranslations('partnerShop');
  const shop = found ? localizeShop(found, locale) : undefined;
  return <PartnerStrip portal="shop" title={shop?.name ?? t('rail_title')} state={null} />;
}

/** The strip's one `GET /v1/shop/me` (ids come from the grants). Several shops: "{n} shops", never one shop's state. */
function ApiStrip() {
  const t = useTranslations('partnerShop');
  const locale = useLocale();
  const [shops, setShops] = useState<MyShopDto[] | null>(null);
  useEffect(() => {
    let alive = true;
    void adminApi(locale, '/shop/me', MyShops).then((res) => {
      if (alive && res.ok) setShops(res.data.shops);
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  const one = shops?.length === 1 ? shops[0] : undefined;
  const title = one
    ? locale === 'hi' && one.nameHi
      ? one.nameHi
      : one.name
    : shops && shops.length > 1
      ? t('strip_shops', { count: shops.length })
      : t('rail_title');
  const state = one ? shopStripState(one) : null;
  return (
    <PartnerStrip
      portal="shop"
      title={title}
      state={state ? { text: t(state.key), tone: state.tone } : null}
    />
  );
}
