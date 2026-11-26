import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { PinGarage } from '@/components/ustaad/local/pin-garage';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Pin my garage (spec 23 § 5; the API is `/v1/ustaad/me/location`). `/ustaad/pin` redirects here. */
export default function UstaadPinPage() {
  return (
    <ClientMessages namespaces={['ustaad.local', 'ustaad.media', 'ustaad.labels']}>
      <PinGarage />
    </ClientMessages>
  );
}
