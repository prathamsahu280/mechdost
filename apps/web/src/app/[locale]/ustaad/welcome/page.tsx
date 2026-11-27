import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { TutorialCards } from '@/components/ustaad/tutorial/tutorial-cards';
import type { Locale } from '@/i18n/routing';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** `/ustaad/welcome` (spec 23 § 5, flow 15): the first-time guide, also replayed from Me › Kaise use karein. */
export default async function UstaadWelcomePage({ params }: Props) {
  await guardUstaadPage();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.tutorial' });
  return (
    <div className="mx-auto grid max-w-md gap-4">
      <h1 className="font-heading text-[clamp(22px,5vw,30px)] font-extrabold tracking-[-0.02em] text-ink">
        {t('title')}
      </h1>
      <ClientMessages namespaces={['ustaad.tutorial']}>
        <TutorialCards />
      </ClientMessages>
    </div>
  );
}
