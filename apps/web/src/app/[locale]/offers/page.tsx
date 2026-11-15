import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { ButtonLink } from '@/components/ui/button-link';
import { Container, EmptyState, PageIntro } from '@/components/ui/page-intro';
import { OfferCard } from '@/components/offers/offer-card';
import { OffersViewedPing } from '@/components/offers/offer-actions';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';
import { fetchOffers } from '@/lib/offers-source';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'offers' });
  return {
    title: t('eyebrow'),
    description: t('metaDescription'),
    alternates: alternatesFor('/offers', locale),
  };
}

/**
 * Public offers (spec 03 "Public offers", 2026-11-16): the offers the admin made public for the customer's city, live
 * right now, in the page language, with the end time in IST and a copy-code button. Server-rendered and cached for a
 * minute (tag `offers`): the only client code is the copy button, so no page's first load grows. Empty and failed
 * states each have one next action (calm UI). The demo build has no API, so it shows the empty state.
 */
export default async function OffersPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations('offers');
  const offers = DATA_MODE === 'api' ? await fetchOffers(locale) : [];

  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <div className="mt-8">
        {offers === null ? (
          <EmptyState
            title={t('errorTitle')}
            body={t('error')}
            action={
              <ButtonLink href="/offers" arrow={false} prefetch={false}>
                {t('retry')}
              </ButtonLink>
            }
          />
        ) : offers.length === 0 ? (
          <EmptyState
            title={t('emptyTitle')}
            body={t('empty')}
            action={<ButtonLink href="/shop">{t('emptyAction')}</ButtonLink>}
          />
        ) : (
          <ClientMessages namespaces={['offers']}>
            <OffersViewedPing count={offers.length} />
            <ul aria-label={t('listLabel')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {offers.map((o) => (
                <OfferCard key={o.id} offer={o} />
              ))}
            </ul>
          </ClientMessages>
        )}
      </div>
    </Container>
  );
}
