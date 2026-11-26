import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { AreaZones } from '@/components/ustaad/local/area-zones';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Area map (spec 23 § 5 `/ustaad/area`): zone bands for verified members, a stylised map plus the same list. */
export default function UstaadAreaPage() {
  return (
    <ClientMessages namespaces={['ustaad.local', 'ustaad.labels', 'segments']}>
      <AreaZones />
    </ClientMessages>
  );
}
