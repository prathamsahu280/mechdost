import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { PostDetail } from '@/components/ustaad/feed/feed-screens';
import type { Locale } from '@/i18n/routing';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: Locale; id: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/ustaad/p/[id]` (spec 23 § 5): one post with its comments. A malformed id is a 404 before any request. */
export default async function UstaadPostPage({ params }: Props) {
  const { locale, id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations({ locale, namespace: 'ustaad.feed' });
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <h1 className="sr-only">{t('postTitle')}</h1>
      <ClientMessages
        namespaces={[
          'ustaad.shell',
          'ustaad.standing',
          'ustaad.feed',
          'ustaad.videoLink',
          'ustaad.home',
          'ustaad.labels',
          'ustaad.media',
          'ustaad.correction',
          'segments',
        ]}
      >
        <MemberGate>
          <PostDetail id={id} />
        </MemberGate>
      </ClientMessages>
    </div>
  );
}
