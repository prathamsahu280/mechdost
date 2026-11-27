import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { DiscoverView } from '@/components/ustaad/discover/discover-view';
import { parseDiscoverFilters } from '@/components/ustaad/messages/view';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ q?: string; work?: string; level?: string }>;
}

/** Discover (spec 23 § 5 `/ustaad/discover`): search and filters live in the address (Back works, links share). */
export default async function UstaadDiscoverPage({ searchParams }: Props) {
  await guardUstaadPage();
  const filters = parseDiscoverFilters((await searchParams) ?? {});
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.discover',
        'ustaad.messages',
        'ustaad.labels',
        'segments',
      ]}
    >
      <MemberGate>
        <DiscoverView filters={filters} />
      </MemberGate>
    </ClientMessages>
  );
}
