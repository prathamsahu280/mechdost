import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AgentInvite } from '@/components/delivery/agent-invite';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'deliveryInvite' });
  // A personal one-time link: never indexed, never followed.
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Delivery-agent invite (spec 24): sign in with the invited mobile number, accept, then upload documents. */
export default async function DeliveryInvitePage({ params }: Props) {
  const { token } = await params;
  const [t, a] = await Promise.all([getTranslations('deliveryInvite'), getTranslations('deliveryAgent')]);
  return (
    <Container className="py-10 tab:py-14">
      <div className="grid gap-8 nav:grid-cols-[1fr_minmax(0,560px)] nav:items-start">
        <PageIntro eyebrow={a('eyebrow')} line1={t('title')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages
            namespaces={[
              'deliveryInvite',
              'deliveryApply',
              'deliveryAgent',
              'delivery.vehicle',
              'delivery.errors',
            ]}
          >
            <AgentInvite token={token.slice(0, 64)} />
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
