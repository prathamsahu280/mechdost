import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { WorkshopFinder } from '@/components/workshops/workshop-finder';
import type { Locale } from '@/i18n/routing';
import { DATA_MODE } from '@/lib/data-mode';
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
  const title = t('workshopsTitle', { city });
  const description = t('workshopsDescription', { city });
  return {
    title,
    description,
    alternates: alternatesFor('/workshops', locale),
    openGraph: openGraphFor({ href: '/workshops', locale, title, description }),
  };
}

const PROMISES = [
  { n: 1, emoji: '🔍' },
  { n: 2, emoji: '👍' },
  { n: 3, emoji: '📒' },
] as const;

/** Workshop finder (spec 06): location first, then nearby verified workshops. Demo data until the API ships. */
export default async function WorkshopsPage() {
  const t = await getTranslations('pages.workshops');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <div className="mt-8">
        {/* Real data mode also books from here ("Let MechDost choose") and explains API errors. */}
        <ClientMessages
          namespaces={
            DATA_MODE === 'api'
              ? ['finder', 'map', 'workshop', 'request', 'homeService', 'accountApi']
              : ['finder', 'map']
          }
        >
          <WorkshopFinder />
        </ClientMessages>
      </div>
      <ul className="mt-12 grid gap-4 tab:grid-cols-3">
        {PROMISES.map(({ n, emoji }) => (
          <li key={n} className="reveal flex gap-4 rounded-tile border border-line-card bg-surface p-6">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-[22px]"
            >
              {emoji}
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold text-ink">{t(`promise${n}Title`)}</h2>
              <p className="mt-1 text-sm text-muted">{t(`promise${n}Body`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Container>
  );
}
