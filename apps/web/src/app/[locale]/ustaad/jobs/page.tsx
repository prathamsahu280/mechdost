import type { Metadata } from 'next';
import { JOB_ROLES } from '@mechdost/shared/ustaad/codes';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { JobsList } from '@/components/ustaad/jobs/jobs-view';
import type { JobRole } from '@/lib/ustaad/client';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ role?: string }>;
}

/** Jobs near you (spec 23 § 5 `/ustaad/jobs`); `?role=` keeps the filter in the address. */
export default async function UstaadJobsPage({ searchParams }: Props) {
  const raw = (await searchParams)?.role ?? '';
  const role = (JOB_ROLES as readonly string[]).includes(raw) ? (raw as JobRole) : null;
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.jobs',
        'ustaad.media',
        'ustaad.labels',
        'ustaad.card',
        'ustaad.saveControl',
        'segments',
      ]}
    >
      <MemberGate>
        <JobsList role={role} />
      </MemberGate>
    </ClientMessages>
  );
}
