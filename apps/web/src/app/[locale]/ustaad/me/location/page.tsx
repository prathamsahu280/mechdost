import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { PinGarage } from '@/components/ustaad/local/pin-garage';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Pin my garage (spec 23 § 5; the API is `/v1/ustaad/me/location`). `/ustaad/pin` redirects here. */
export default async function UstaadPinPage() {
  await guardUstaadPage();
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.local',
        'ustaad.media',
        'ustaad.labels',
        'segments',
      ]}
    >
      <MemberGate>
        <PinGarage />
      </MemberGate>
    </ClientMessages>
  );
}
