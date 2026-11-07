import { NotebookPen, Search, ThumbsUp } from 'lucide-react';
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

const PROMISES = [
  { n: 1, icon: Search },
  { n: 2, icon: ThumbsUp },
  { n: 3, icon: NotebookPen },
] as const;

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
        {PROMISES.map(({ n, icon: Icon }) => (
          <li key={n} className="flex gap-4 rounded-tile border border-line-card bg-surface p-6">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-text"
            >
              <Icon className="size-5" strokeWidth={2} />
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
