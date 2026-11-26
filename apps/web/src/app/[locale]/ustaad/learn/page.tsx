import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { LearnView } from '@/components/ustaad/learn/learn-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Learn (Seekho, spec 23 § 5 `/ustaad/learn`): courses, short videos, MechDost training. */
export default function UstaadLearnPage() {
  return (
    <ClientMessages namespaces={['ustaad.shell', 'ustaad.learn', 'ustaad.labels', 'segments']}>
      <MemberGate>
        <LearnView />
      </MemberGate>
    </ClientMessages>
  );
}
