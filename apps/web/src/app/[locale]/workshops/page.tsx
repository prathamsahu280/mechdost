import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { WorkshopFinder } from '@/components/workshops/workshop-finder';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('workshops'), alternates: alternatesFor('/workshops', locale) };
}

const PROMISES = [1, 2, 3] as const;

/** Workshop finder (spec 06): location first, then nearby verified workshops. Demo data until the API ships. */
export default async function WorkshopsPage() {
  const t = await getTranslations('pages.workshops');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <div className="mt-8">
        <ClientMessages namespaces={['finder', 'map']}>
          <WorkshopFinder />
        </ClientMessages>
      </div>
      <ul className="mt-12 grid gap-4 tab:grid-cols-3">
        {PROMISES.map((n) => (
          <li key={n} className="reveal rounded-tile border border-line-card bg-surface p-6">
            <h2 className="font-heading text-lg font-bold text-ink">{t(`promise${n}Title`)}</h2>
            <p className="mt-2 text-sm text-muted">{t(`promise${n}Body`)}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
