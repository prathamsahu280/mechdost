import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { SavedScreen } from '@/components/ustaad/feed/feed-screens';
import type { Locale } from '@/i18n/routing';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** `/ustaad/saved` (spec 23 § 5): saved posts, only for me. */
export default async function UstaadSavedPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.feed' });
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
          {t('savedTitle')}
        </h1>
        <p className="text-[15px] text-muted">{t('savedHint')}</p>
      </header>
      <ClientMessages
        namespaces={[
          'ustaad.shell',
          'ustaad.standing',
          'ustaad.feed',
          'ustaad.labels',
          'ustaad.media',
          'ustaad.correction',
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
