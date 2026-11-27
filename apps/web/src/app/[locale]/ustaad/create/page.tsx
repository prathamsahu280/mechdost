import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { Composer } from '@/components/ustaad/feed/composer';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ story?: string }>;
}

/** `/ustaad/create` (spec 23 § 5): the composer; `?story=1` adds a story instead (Home's "Add story"). */
export default async function UstaadCreatePage({ searchParams }: Props) {
  const story = (await searchParams)?.story === '1';
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.feed',
        'ustaad.videoLink',
        'ustaad.labels',
        'ustaad.media',
        'ustaad.correction',
        'segments',
      ]}
    >
      <MemberGate>
        <Composer story={story} />
      </MemberGate>
    </ClientMessages>
  );
}
