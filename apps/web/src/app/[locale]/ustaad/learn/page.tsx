import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { LearnView } from '@/components/ustaad/learn/learn-view';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Learn (Seekho, spec 23 § 5 `/ustaad/learn`): courses, short videos, MechDost training. */
export default async function UstaadLearnPage() {
  await guardUstaadPage();
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.learn',
        'ustaad.labels',
        'ustaad.saveControl',
        'segments',
      ]}
    >
      <MemberGate>
        <LearnView />
      </MemberGate>
    </ClientMessages>
  );
}
