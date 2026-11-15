import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { GuestSupport } from '@/components/support/guest-support';
import { ClientMessages } from '@/components/ui/client-messages';
import { LocalLink } from '@/components/ui/local-link';
import { Container, PageIntro } from '@/components/ui/page-intro';
import { routing, type Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

interface Props {
  params: Promise<{ locale: Locale }>;
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'supportGuest' });
  return { title: t('title'), alternates: alternatesFor('/support/guest', locale) };
}

/** Support without an account (spec 09): write to MechDost with a reference and a private key, or check a request. */
export default async function GuestSupportPage() {
  const t = await getTranslations('supportGuest');
  return (
    <Container className="py-10 tab:py-14">
      <LocalLink href="/account/support" className="text-sm font-bold text-ink hover:underline">
        ← {t('signInInstead')}
      </LocalLink>
      <div className="mt-5 grid gap-8 nav:grid-cols-[1fr_minmax(0,640px)] nav:items-start">
        <PageIntro eyebrow={t('eyebrow')} line1={t('title')} lead={t('intro')} />
        <ClientMessages namespaces={['supportGuest', 'support']}>
          <GuestSupport />
        </ClientMessages>
      </div>
    </Container>
  );
}
