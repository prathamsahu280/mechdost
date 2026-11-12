import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { InviteApplication } from '@/components/partners/invite-application';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'apply' });
  // A personal one-time link: never indexed.
  return { title: t('inviteTitle'), robots: { index: false, follow: false } };
}

/** An admin's invite to a seller (design 2026-11-13): the seller form with the invited contacts locked. */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const t = await getTranslations('apply');
  return (
    <Container className="py-10 tab:py-14">
      <div className="grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        <PageIntro eyebrow={t('eyebrow')} line1={t('inviteTitle')} lead={t('intro')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['apply', 'categories']}>
            <InviteApplication token={token} />
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
