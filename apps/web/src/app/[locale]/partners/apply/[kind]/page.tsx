import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApplicationForm } from '@/components/partners/application-form';
import { AgentApplyForm } from '@/components/delivery/agent-apply-form';
import { SellerApplicationForm } from '@/components/partners/seller-application-form';
import { UstaadJoinFlow } from '@/components/ustaad/join/join-flow';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import type { PartnerKind } from '@/demo/store';
import { routing, type Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';
import { publishedUstaadAccess } from '@/lib/site-config-content';
import { mechanicApplyView } from '@/lib/ustaad/join';

/** `delivery_agent` (spec 24) has its own short form; the others are partner applications (spec 07). */
type Kind = PartnerKind | 'delivery_agent';
const KINDS: Kind[] = ['seller', 'garage', 'mechanic', 'delivery_agent'];

interface Props {
  params: Promise<{ locale: Locale; kind: string }>;
}

const isKind = (k: string): k is Kind => (KINDS as string[]).includes(k);

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => KINDS.map((kind) => ({ locale, kind })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, kind } = await params;
  if (!isKind(kind)) return {};
  if (kind === 'delivery_agent') {
    const d = await getTranslations({ locale, namespace: 'deliveryApply' });
    return { title: d('title'), alternates: alternatesFor(`/partners/apply/${kind}`, locale) };
  }
  const t = await getTranslations({ locale, namespace: 'apply' });
  // Spec 23 § 4a: while the network is open, the mechanic page is the Ustaad join and says so.
  const title =
    kind === 'mechanic' && mechanicApplyView(await publishedUstaadAccess()) === 'ustaad_join'
      ? (await getTranslations({ locale, namespace: 'ustaad.join' }))('title')
      : t(`title_${kind}`);
  return { title, alternates: alternatesFor(`/partners/apply/${kind}`, locale) };
}

/** Partner application form (spec 07) — replaces the concept's WhatsApp hand-off. */
export default async function ApplyPage({ params }: Props) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  if (kind === 'delivery_agent') return <DeliveryAgentApply />;
  const t = await getTranslations('apply');
  const ustaadJoin =
    kind === 'mechanic' && mechanicApplyView(await publishedUstaadAccess()) === 'ustaad_join';
  const tj = await getTranslations('ustaad.join');
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink
        href="/partners"
        className="inline-flex min-h-6 items-center text-sm font-bold text-ink hover:underline"
      >
        ← {t('back')}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        {ustaadJoin ? (
          <PageIntro eyebrow={tj('eyebrow')} line1={tj('title')} lead={tj('lead')} />
        ) : (
          <PageIntro eyebrow={t('eyebrow')} line1={t(`title_${kind}`)} lead={t('intro')} />
        )}
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          {ustaadJoin ? (
            // Spec 23 § 4a: once the network is open, "Apply as a mechanic" is the Ustaad join (same as /ustaad/join).
            <ClientMessages namespaces={['ustaad.join']}>
              <UstaadJoinFlow via="partners_apply" />
            </ClientMessages>
          ) : (
            <ClientMessages namespaces={['apply', 'categories', 'map', 'trust']}>
              {kind === 'seller' ? <SellerApplicationForm /> : <ApplicationForm kind={kind} />}
            </ClientMessages>
          )}
        </div>
      </div>
    </Container>
  );
}

/** "Apply as a delivery agent" (spec 24, Lead's call 10): name, mobile, city, vehicle; documents after the invite. */
async function DeliveryAgentApply() {
  const [t, d] = await Promise.all([getTranslations('apply'), getTranslations('deliveryApply')]);
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink
        href="/partners"
        className="inline-flex min-h-6 items-center text-sm font-bold text-ink hover:underline"
      >
        ← {t('back')}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        <PageIntro eyebrow={t('eyebrow')} line1={d('title')} lead={d('lead')} />
        <div className="rounded-card border border-line-card bg-surface p-6 shadow-card tab:p-8">
          <ClientMessages namespaces={['deliveryApply', 'delivery.vehicle']}>
            <AgentApplyForm />
          </ClientMessages>
        </div>
      </div>
    </Container>
  );
}
