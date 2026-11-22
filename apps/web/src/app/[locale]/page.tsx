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
import { AudienceBand } from '@/components/home/audience-band';
import type { Locale } from '@/i18n/routing';
import { JsonLd } from '@/components/site/json-ld';
import { homeRangeCards } from '@/lib/catalogue/home-range';
import { DATA_MODE } from '@/lib/data-mode';
import { alternatesFor } from '@/lib/seo';
import { organizationLd, websiteLd } from '@/lib/structured-data';
import { site } from '@/lib/site';
import { featuredCategories, visibleSections, type HomeSection } from '@mechdost/shared/site-layout';
import { publishedLayout } from '@/lib/site-config-content';
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
export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const region = (await getTranslations('regions'))(site.defaultRegion);
  // The admin's saved layout (real mode), applied here on the server: no client code, refreshed by tag on publish.
  // The demo build shows the default order and the browser-stored choices are applied by the pre-paint script.
  const layout = await publishedLayout();
  const range = DATA_MODE === 'api' ? await homeRangeCards(locale) : undefined;
  const sections: Record<HomeSection, ReactNode> = {
    audiences: <AudienceBand />,
    trust: <TrustStrip />,
    categories: <CategoryTiles featured={featuredCategories(layout)} emoji={layout.emoji} />,
    products: <ProductRange cards={range} />,
    route: <OrderRoute />,
    service: <ServiceSection region={region} />,
    workshops: <TopWorkshops region={region} />,
    faq: <Faq />,
    partners: <PartnerTeaser />,
  };
  return (
    <>
      <JsonLd data={[organizationLd(), websiteLd(locale)]} />
      <Hero region={region} />
      <div className="flex flex-col">
        {visibleSections(layout).map((key) => (
          <div key={key} data-home-section={key}>
            {sections[key]}
          </div>
        ))}
      </div>
    </>
  );
}
