import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container } from '@/components/ui/page-intro';
import { ShareTeaser } from '@/components/ustaad/feed/share-teaser';
import type { Locale } from '@/i18n/routing';
import { publishedUstaadAccess } from '@/lib/site-config-content';

interface Props {
  params: Promise<{ locale: Locale; token: string }>;
}

/** The token is `{22}.{22}` base64url (the API's `SHARE_TOKEN_RE`); anything else is a 404 before any request. */
const TOKEN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;

/** Never indexed or followed; the link never leaves through the Referer header (SR-44). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const hidden = { robots: { index: false, follow: false }, referrer: 'no-referrer' } as const;
  // During the staff preview the page must not name the network to anyone the gate turns away.
  if ((await publishedUstaadAccess()) !== 'open') return hidden;
  const t = await getTranslations({ locale, namespace: 'ustaad.feed' });
  return { title: t('teaserTitle'), ...hidden };
}

/**
 * `/ustaad/s/[token]` (spec 23 § 5, the path D1's share route returns): the WhatsApp teaser. The layout renders it
 * without the network's gate and shell (`UstaadPublicSwitch`); the card is fetched from the visitor's browser.
 */
export default async function UstaadShareTeaserPage({ params }: Props) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();
  return (
    <Container className="py-10 tab:py-16">
      <ClientMessages namespaces={['ustaad.feed']}>
        <ShareTeaser token={token} />
      </ClientMessages>
    </Container>
  );
}
