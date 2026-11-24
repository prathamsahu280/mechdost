import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoadsideRequest } from '@/components/roadside/roadside-request';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'roadside' });
  return { title: t('title'), description: t('lead') };
}

/** Roadside help (spec 22): location, vehicle, optional problem, then the advance. Sign-in is required. */
export default async function RoadsidePage() {
  const t = await getTranslations('roadside');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('lead')} />
      <div className="mt-8">
        <ClientMessages namespaces={['roadside', 'finder']}>
          <RoadsideRequest />
        </ClientMessages>
      </div>
    </Container>
  );
}
