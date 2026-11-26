import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ThreadIdParamDto } from '@mechdost/shared/ustaad/dto/messages';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { ThreadScreen } from '@/components/ustaad/messages/thread-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ id: string }>;
}

/** One conversation (spec 23 § 5 `/ustaad/messages/[id]`); a malformed id is a 404 before any request. */
export default async function UstaadThreadPage({ params }: Props) {
  const { id } = await params;
  if (!ThreadIdParamDto.safeParse({ id }).success) notFound();
  return (
    <ClientMessages namespaces={['ustaad.shell', 'ustaad.messages', 'ustaad.media', 'ustaad.labels']}>
      <MemberGate>
        <ThreadScreen id={id} />
      </MemberGate>
    </ClientMessages>
  );
}
