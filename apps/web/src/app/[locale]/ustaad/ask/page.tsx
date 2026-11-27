import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { AskList } from '@/components/ustaad/qa/ask-list';
import { parseQuestionFilter } from '@/lib/ustaad/qa-view';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ filter?: string }>;
}

/** Q&A list (spec 23 § 5): the filter lives in the address so Back and shared links keep it. */
export default async function UstaadAskPage({ searchParams }: Props) {
  await guardUstaadPage();
  const filter = parseQuestionFilter((await searchParams)?.filter);
  return (
    <ClientMessages
      namespaces={['ustaad.shell', 'ustaad.standing', 'ustaad.qa', 'ustaad.labels', 'segments']}
    >
      <MemberGate>
        <AskList filter={filter} />
      </MemberGate>
    </ClientMessages>
  );
}
