import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import { AttestForm } from '@/components/ustaad/attest/attest-form';
import type { Locale } from '@/i18n/routing';
import { publishedUstaadAccess } from '@/lib/site-config-content';

interface Props {
  params: Promise<{ locale: Locale; token: string }>;
}

/** Never indexed, never followed, and the link never leaks to another site through the Referer header. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'ustaad.attest' });
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * `/ustaad-attest/[token]` (spec 23 § 4 flow 2, § 8, SR-6): a garage owner who is not on MechDost confirms (or
 * declines) that a member works at their garage. Public, no sign-in. It sits outside `/ustaad/*` because the network
 * shell shows "page not found" to anyone who is not a member. The page data is fetched from the owner's browser (per-IP
 * limit); the server renders only the frame.
 */
export default async function AttestPage({ params }: Props) {
  const { token } = await params;
  if ((await publishedUstaadAccess()) === 'off') notFound();
  return (
    <Container className="py-8 tab:py-12">
      <div className="mx-auto max-w-lg">
        <ClientMessages namespaces={['ustaad.attest']}>
          <AttestForm token={token} />
        </ClientMessages>
      </div>
    </Container>
  );
}
