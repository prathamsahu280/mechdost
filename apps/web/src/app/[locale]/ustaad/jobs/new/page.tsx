import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { JobPostForm } from '@/components/ustaad/jobs/job-post-form';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Post a job (spec 23 § 4 flow 11): verified employers only; the API decides. */
export default async function UstaadJobNewPage() {
  await guardUstaadPage();
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
        <JobPostForm />
      </MemberGate>
    </ClientMessages>
  );
}
