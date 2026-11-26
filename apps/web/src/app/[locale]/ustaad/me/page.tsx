import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { MyCardScreen } from '@/components/ustaad/card/my-card';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** `/ustaad/me` (spec 23 § 5): my card, stats, level ladder, badges, verification and the guide replay. */
export default async function UstaadMePage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.card' });
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
        {t('title')}
      </h1>
      <ClientMessages namespaces={['ustaad.card', 'ustaad.join']}>
        <MyCardScreen />
      </ClientMessages>
    </div>
  );
}
