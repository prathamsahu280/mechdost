import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { AskComposer } from '@/components/ustaad/qa/ask-composer';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The ask composer sheet (spec 23 § 5 `/ustaad/ask/new`; Home's mic opens it). Close returns to the list. */
export default function UstaadAskNewPage() {
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.qa',
        'ustaad.media',
        'ustaad.labels',
        'ustaad.correction',
        'segments',
      ]}
    >
      <MemberGate>
        <AskComposer />
      </MemberGate>
    </ClientMessages>
  );
}
