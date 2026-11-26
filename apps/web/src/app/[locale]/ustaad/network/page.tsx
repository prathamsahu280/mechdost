import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { parseNetworkTab } from '@/components/ustaad/messages/view';
import { NetworkView } from '@/components/ustaad/network/network-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ tab?: string }>;
}

/** My network (spec 23 § 5 `/ustaad/network`): the tab lives in the address so Back and shared links keep it. */
export default async function UstaadNetworkPage({ searchParams }: Props) {
  const tab = parseNetworkTab((await searchParams)?.tab);
  return (
    <ClientMessages namespaces={['ustaad.shell', 'ustaad.network', 'ustaad.messages', 'ustaad.labels']}>
      <MemberGate>
        <NetworkView tab={tab} />
      </MemberGate>
    </ClientMessages>
  );
}
