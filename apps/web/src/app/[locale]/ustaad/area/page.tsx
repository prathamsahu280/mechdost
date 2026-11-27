import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { AreaZones } from '@/components/ustaad/local/area-zones';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Area map (spec 23 § 5 `/ustaad/area`): zone bands for verified members, a stylised map plus the same list. */
export default async function UstaadAreaPage() {
  await guardUstaadPage();
  return (
    <ClientMessages
      namespaces={['ustaad.shell', 'ustaad.standing', 'ustaad.local', 'ustaad.labels', 'segments']}
    >
      <MemberGate>
        <AreaZones />
      </MemberGate>
    </ClientMessages>
  );
}
