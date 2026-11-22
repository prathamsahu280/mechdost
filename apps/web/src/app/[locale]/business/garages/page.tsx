import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ApplyPanel, Benefit, StatusLabel } from '@/components/business/business-parts';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { QUOTES_AVAILABLE } from '@/lib/data-mode';
import { alternatesFor, openGraphFor } from '@/lib/seo';
import { site } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, cities] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'cities' }),
  ]);
  const city = cities(site.defaultCity);
  const title = t('businessGaragesTitle', { city });
  const description = t('businessGaragesDescription', { city });
  return {
    title,
    description,
    alternates: alternatesFor('/business/garages', locale),
    openGraph: openGraphFor({ href: '/business/garages', locale, title, description }),
  };
}

/**
 * Mechanics and garages (design 2026-11-22): four benefits with an honest status, then one primary action. Bulk
 * orders, GST details and Order again are live (the wording is "GST details on your bill" (Q97),
 * not the tax-invoice wording); trade prices are not switched on yet and say so. Server-only; copy in the locale files.
 */
export default async function GaragesPage() {
  const t = await getTranslations('pages.businessGarages');
  const live = <StatusLabel tone="live">{t('statusLive')}</StatusLabel>;
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <ul aria-label={t('benefitsTitle')} className="mt-10 grid gap-4 tab:grid-cols-2">
        <Benefit
          title={t('b1Title')}
          body={t('b1Body')}
          status={live}
          link={
            QUOTES_AVAILABLE
              ? { href: '/quotes/new', label: t('b1Action'), track: 'business_garages_bulk' }
              : undefined
          }
        />
        <Benefit title={t('b2Title')} body={t('b2Body')} status={live} />
        <Benefit
          title={t('b3Title')}
          body={t('b3Body')}
          status={live}
          link={{ href: '/account/orders', label: t('b3Action'), track: 'business_garages_reorder' }}
        />
        <Benefit
          title={t('b4Title')}
          body={t('b4Body')}
          status={<StatusLabel tone="soon">{t('statusSoon')}</StatusLabel>}
        />
      </ul>
      <ApplyPanel
        title={t('applyTitle')}
        body={t('applyBody')}
        action={t('action')}
        href="/business/apply?kind=trade"
        track="business_garages_apply"
      />
    </Container>
  );
}
