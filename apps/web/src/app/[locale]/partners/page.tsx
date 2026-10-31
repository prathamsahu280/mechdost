import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ExternalButtonLink } from '@/components/ui/button-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { whatsappLink } from '@/lib/site';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'footer' });
  return { title: t('partners'), alternates: alternatesFor('/partners', locale) };
}

const KINDS = ['seller', 'garage', 'mechanic'] as const;

/** Partner programme (spec 07). Application forms (partner_applications) replace the WhatsApp drafts in Phase 2. */
export default async function PartnersPage() {
  const t = await getTranslations('pages.partners');
  const footer = await getTranslations('footer');
  const wa = await getTranslations('whatsapp');

  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('titleLine1')} line2={t('titleLine2')} lead={t('lead')} />
      <ul className="mt-10 grid gap-4 tab:grid-cols-3">
        {KINDS.map((kind) => (
          <li
            key={kind}
            className="flex flex-col rounded-card border border-line-card bg-surface p-7 shadow-card"
          >
            <h2 className="font-heading text-xl font-extrabold text-ink">{t(`${kind}Title`)}</h2>
            <p className="mt-2 flex-1 text-sm text-muted">{t(`${kind}Body`)}</p>
            <ExternalButtonLink
              href={whatsappLink(wa(kind))}
              target="_blank"
              rel="noopener noreferrer"
              note={footer('whatsappNote')}
              data-track={`partners_apply_${kind}`}
              className="mt-6 self-start"
            >
              {t(`${kind}Action`)}
            </ExternalButtonLink>
          </li>
        ))}
      </ul>
    </Container>
  );
}
