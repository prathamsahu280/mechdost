import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JobCodeParam } from '@mechdost/shared/ustaad/dto/local';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { JobDetail } from '@/components/ustaad/jobs/jobs-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ code: string }>;
}

/** A job (spec 23 § 5 `/ustaad/jobs/[code]`): detail, the anti-scam banner and the apply sheet. */
export default async function UstaadJobPage({ params }: Props) {
  const { code } = await params;
  if (!JobCodeParam.safeParse({ code }).success) notFound();
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.jobs',
        'ustaad.media',
        'ustaad.labels',
        'ustaad.card',
        'segments',
        'ustaad.saveControl',
      ]}
    >
      <MemberGate>
        <JobDetail code={code} />
      </MemberGate>
    </ClientMessages>
  );
}
