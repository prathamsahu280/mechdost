import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RoadsideTracker } from '@/components/roadside/roadside-tracker';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import { withCode } from '@/components/ui/code-text';
import type { Locale } from '@/i18n/routing';

interface Props {
  params: Promise<{ locale: Locale; code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: 'roadside' });
  return { title: t('trackTitle', { code }), robots: { index: false } };
}

/** Roadside request tracking (spec 22). Codes are RSA-{CITY}-{YYYY}-{6 base32}; private to the customer. */
export default async function RoadsideTrackPage({ params }: Props) {
  const { code } = await params;
  const safe = /^RSA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/.test(code) ? code : '';
  const t = await getTranslations('roadside');
  return (
    <Container className="py-10 tab:py-14">
      <h1 className="font-heading text-[clamp(22px,3vw,40px)] font-extrabold tracking-[-0.02em] break-words text-ink">
        {withCode(t('trackTitle', { code: safe || code.slice(0, 40) }), safe || code.slice(0, 40))}
      </h1>
      <div className="mt-8">
        <ClientMessages namespaces={['roadside']}>
          <RoadsideTracker code={safe} />
        </ClientMessages>
      </div>
    </Container>
  );
}
