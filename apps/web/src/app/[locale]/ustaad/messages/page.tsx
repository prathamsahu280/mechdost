import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { NewThread } from '@/components/ustaad/messages/new-thread';
import { ThreadList } from '@/components/ustaad/messages/thread-list';
import { normaliseHandle, parseThreadBox } from '@/components/ustaad/messages/view';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ box?: string; to?: string }>;
}

/**
 * Messages (spec 23 § 5 `/ustaad/messages`): Chats / Requests / Sent, or — with `?to=<handle>` — the request form to
 * start a conversation with that member (request-only, SR-33).
 */
export default async function UstaadMessagesPage({ searchParams }: Props) {
  await guardUstaadPage();
  const sp = (await searchParams) ?? {};
  const to = sp.to === undefined ? undefined : normaliseHandle(sp.to);
  return (
    <ClientMessages
      namespaces={['ustaad.shell', 'ustaad.standing', 'ustaad.messages', 'ustaad.labels', 'segments']}
    >
      <MemberGate>
        {to === undefined ? <ThreadList box={parseThreadBox(sp.box)} /> : <NewThread handle={to} />}
      </MemberGate>
    </ClientMessages>
  );
}
