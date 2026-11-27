import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { JobPostForm } from '@/components/ustaad/jobs/job-post-form';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Post a job (spec 23 § 4 flow 11): verified employers only; the API decides. */
export default function UstaadJobNewPage() {
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.jobs',
        'ustaad.media',
        'ustaad.labels',
        'segments',
      ]}
    >
      <MemberGate>
        <JobPostForm />
      </MemberGate>
    </ClientMessages>
  );
}
