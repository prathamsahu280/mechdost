import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ApplyPanel, Benefit } from '@/components/business/business-parts';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor, openGraphFor } from '@/lib/seo';
import { site } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

const FLEET_BENEFITS = [1, 2, 3, 4, 5] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const [t, regions] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'regions' }),
  ]);
  const region = regions(site.defaultRegion);
  const title = t('businessFleetsTitle', { region });
  const description = t('businessFleetsDescription', { region });
  return {
    title,
    description,
    alternates: alternatesFor('/business/fleets', locale),
    openGraph: openGraphFor({ href: '/business/fleets', locale, title, description }),
  };
}

/**
 * Fleets, "MechDost Uptime" (design 2026-11-22): a programme we onboard fleets into, so the page promises nothing that
 * does not exist: it states that each point is planned with the fleet, and has one action, an enquiry. The brand
 * name stays in Latin script and carries `lang="en"` on /hi. Server-only; copy in the locale files.
 */
export default async function FleetsPage() {
  const t = await getTranslations('pages.businessFleets');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro
        eyebrow={
          <>
            <span lang="en">MechDost Uptime</span> · {t('eyebrowNote')}
          </>
        }
        line1={t('titleLine1')}
        line2={t('titleLine2')}
        lead={t('lead')}
      />
      <p className="mt-6 max-w-2xl rounded-card bg-pill p-4 text-sm font-bold text-ink">{t('note')}</p>
      <ul aria-label={t('benefitsTitle')} className="mt-6 grid gap-4 tab:grid-cols-2 nav:grid-cols-3">
        {FLEET_BENEFITS.map((n) => (
          <Benefit key={n} title={t(`f${n}Title`)} body={t(`f${n}Body`)} />
        ))}
      </ul>
      <ApplyPanel
        title={t('applyTitle')}
        body={t('applyBody')}
        action={t('action')}
        href="/business/apply?kind=fleet"
        track="business_fleets_apply"
      />
    </Container>
  );
}
