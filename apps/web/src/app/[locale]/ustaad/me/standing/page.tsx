import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { StandingPanel } from '@/components/ustaad/standing/standing-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My account standing (QA 2026-11-27, SIM-P19 / SIM-P24): where strike, removal, restriction, ban and appeal notices
 * lead. The reason in plain words, what is limited and until when, and one Appeal action per decision.
 */
export default function UstaadStandingPage() {
  return (
    <ClientMessages namespaces={['ustaad.shell', 'ustaad.standing', 'ustaad.labels', 'segments']}>
      <MemberGate>
        <div className="mx-auto grid max-w-2xl gap-5">
          <StandingPanel heading="title" />
        </div>
      </MemberGate>
    </ClientMessages>
  );
}
