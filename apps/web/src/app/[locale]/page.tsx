import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CategoryTiles } from '@/components/home/category-tiles';
import { Hero } from '@/components/home/hero';
import { ProductRange } from '@/components/home/product-range';
import { PartnerTeaser } from '@/components/home/partner-teaser';
import { ServiceSection } from '@/components/home/service-section';
import { TrustStrip } from '@/components/home/trust-strip';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { site } from '@/lib/site';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor('/', locale) };
}

export default async function HomePage() {
  const city = (await getTranslations('cities'))(site.defaultCity);
  return (
    <>
      <Hero city={city} />
      <TrustStrip />
      <CategoryTiles />
      <ProductRange />
      <ServiceSection city={city} />
      <PartnerTeaser />
    </>
  );
}
