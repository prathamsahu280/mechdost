import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApplicationForm } from '@/components/partners/application-form';
import { SellerApplicationForm } from '@/components/partners/seller-application-form';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { PartnerKind } from '@/demo/store';
import { routing, type Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

const KINDS: PartnerKind[] = ['seller', 'garage', 'mechanic'];

interface Props {
  params: Promise<{ locale: Locale; kind: string }>;
}

const isKind = (k: string): k is PartnerKind => (KINDS as string[]).includes(k);

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => KINDS.map((kind) => ({ locale, kind })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, kind } = await params;
  if (!isKind(kind)) return {};
  const t = await getTranslations({ locale, namespace: 'apply' });
  return { title: t(`title_${kind}`), alternates: alternatesFor(`/partners/apply/${kind}`, locale) };
}

/** Partner application form (spec 07) — replaces the concept's WhatsApp hand-off. */
export default async function ApplyPage({ params }: Props) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  const t = await getTranslations('apply');
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink href="/partners" className="text-sm font-bold text-ink hover:underline">
        ← {t('back')}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        <PageIntro eyebrow={t('eyebrow')} line1={t(`title_${kind}`)} lead={t('intro')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['apply', 'categories', 'map']}>
            {kind === 'seller' ? <SellerApplicationForm /> : <ApplicationForm kind={kind} />}
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
