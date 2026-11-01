import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryTiles } from '@/components/home/category-tiles';
import { Faq } from '@/components/home/faq';
import { Hero } from '@/components/home/hero';
import { OrderRoute } from '@/components/home/order-route';
import { ProductRange } from '@/components/home/product-range';
import { PartnerTeaser } from '@/components/home/partner-teaser';
import { ServiceSection } from '@/components/home/service-section';
import { TopWorkshops } from '@/components/home/top-workshops';
import { TrustStrip } from '@/components/home/trust-strip';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { site } from '@/lib/site';
import { HOME_SECTIONS, type HomeSection } from '@/lib/site-layout';
import type { ReactNode } from 'react';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor('/', locale) };
}

/**
 * Home: the hero always comes first; the sections below can be reordered or hidden by the admin (demo:
 * /admin/layout → `data-home-section` order/display set by the pre-paint layout script in the root layout). The
 * page stays a static Server Component.
 */
export default async function HomePage() {
  const city = (await getTranslations('cities'))(site.defaultCity);
  const sections: Record<HomeSection, ReactNode> = {
    trust: <TrustStrip />,
    categories: <CategoryTiles />,
    products: <ProductRange />,
    route: <OrderRoute />,
    service: <ServiceSection city={city} />,
    workshops: <TopWorkshops city={city} />,
    faq: <Faq />,
    partners: <PartnerTeaser />,
  };
  return (
    <>
      <Hero city={city} />
      <div className="flex flex-col">
        {HOME_SECTIONS.map((key) => (
          <div key={key} data-home-section={key}>
            {sections[key]}
          </div>
        ))}
      </div>
    </>
  );
}
