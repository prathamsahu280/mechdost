import Image from 'next/image';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { PHOTO_CREDITS } from '@/lib/media';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'credits' });
  return { title: t('title'), alternates: alternatesFor('/credits', locale) };
}

/**
 * Photo credits (decision 2026-11-01 "Real photos"): CC BY / CC BY-SA require naming the author, the licence and
 * the source. Linked from the footer on every page. Titles, authors and licence names are data, not copy.
 */
export default async function CreditsPage() {
  const t = await getTranslations('credits');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <ul className="mt-10 grid gap-3 tab:grid-cols-2 nav:grid-cols-3">
        {PHOTO_CREDITS.map((c) => (
          <li
            key={c.path}
            className="grid grid-cols-[80px_1fr] gap-4 rounded-tile border border-line-card bg-surface p-3 shadow-card"
          >
            <div className="relative aspect-square overflow-hidden rounded-[10px] bg-pill">
              <Image src={c.path} alt="" fill sizes="80px" className="object-cover" />
            </div>
            <dl className="min-w-0 text-xs leading-relaxed">
              <dt className="sr-only">{t('photo')}</dt>
              <dd className="truncate font-bold text-ink">{c.title}</dd>
              <dt className="sr-only">{t('author')}</dt>
              <dd className="truncate text-muted">{c.author}</dd>
              <dt className="sr-only">{t('license')}</dt>
              <dd className="text-muted">{c.license}</dd>
              <dt className="sr-only">{t('source')}</dt>
              <dd>
                <a
                  href={c.source}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex min-h-7 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
                >
                  {t('view')}
                </a>
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </Container>
  );
}
