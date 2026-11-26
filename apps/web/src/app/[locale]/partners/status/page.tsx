import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PartnerStatus } from '@/components/partners/partner-status';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import { UstaadVerificationProgress } from '@/components/ustaad/card/verification-progress';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'shopTier2' });
  return { title: t('statusTitle'), robots: { index: false } };
}

/** Public application status lookup (spec 07): reference + a one-time code to the applicant's phone; stage only. */
export default async function PartnerStatusPage() {
  const t = await getTranslations('shopTier2');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(22px,3vw,40px)] font-extrabold tracking-[-0.02em] text-ink">
        {t('statusTitle')}
      </h1>
      <div className="mt-8">
        {/* Spec 23 § 4a: a signed-in Ustaad member sees their verification progress first (nothing for others). */}
        <ClientMessages namespaces={['ustaad.card']}>
          <UstaadVerificationProgress />
        </ClientMessages>
        <ClientMessages namespaces={['shopTier2']}>
          <PartnerStatus />
        </ClientMessages>
      </div>
    </Container>
  );
}
