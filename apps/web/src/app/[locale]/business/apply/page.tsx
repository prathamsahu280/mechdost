import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BusinessApplyForm } from '@/components/business/business-apply-form';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

const KINDS = ['trade', 'fleet'] as const;
type Kind = (typeof KINDS)[number];

interface Props {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ kind?: string | string[] }>;
}

function kindOf(raw: string | string[] | undefined): Kind | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return KINDS.find((k) => k === v) ?? null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ locale }, { kind: raw }] = await Promise.all([params, searchParams]);
  const kind = kindOf(raw);
  if (!kind) return {};
  const t = await getTranslations({ locale, namespace: 'business' });
  return {
    title: t(`title_${kind}`),
    alternates: alternatesFor(`/business/apply?kind=${kind}`, locale),
    robots: { index: false },
  };
}

/**
 * Trade account application and fleet enquiry (audience entry design 2026-11-22, item 3). The page title and heading
 * name the purpose; the form is one client island. A trade account needs sign-in, a fleet enquiry does not.
 */
export default async function BusinessApplyPage({ searchParams }: Props) {
  const kind = kindOf((await searchParams).kind);
  if (!kind) notFound();
  const t = await getTranslations('business');
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink
        href={kind === 'trade' ? '/business/garages' : '/business/fleets'}
        className="text-sm font-bold text-ink hover:underline"
      >
        ← {t(`back_${kind}`)}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        <PageIntro eyebrow={t(`eyebrow_${kind}`)} line1={t(`title_${kind}`)} lead={t(`intro_${kind}`)} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['business']}>
            <BusinessApplyForm kind={kind} />
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
