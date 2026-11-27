import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { SavedScreen } from '@/components/ustaad/saved/saved-screen';
import type { Locale } from '@/i18n/routing';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** `/ustaad/saved` (spec 23 § 5, § 21i): everything I saved, with kind and collection filters, only for me. */
export default async function UstaadSavedPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.saved' });
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('title')}
        </h1>
        <p className="text-[15px] text-muted">{t('hint')}</p>
      </header>
      <ClientMessages
        namespaces={[
          'ustaad.shell',
          'ustaad.standing',
          'ustaad.labels',
          'ustaad.saved',
          'ustaad.saveControl',
          'segments',
        ]}
      >
        <MemberGate>
          <SavedScreen />
        </MemberGate>
      </ClientMessages>
    </div>
  );
}
