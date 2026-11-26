import type { Metadata } from 'next';
import { ClientMessages } from '@/components/ui/client-messages';
import { AskList } from '@/components/ustaad/qa/ask-list';
import { parseQuestionFilter } from '@/lib/ustaad/qa-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  searchParams?: Promise<{ filter?: string }>;
}

/** Q&A list (spec 23 § 5): the filter lives in the address so Back and shared links keep it. */
export default async function UstaadAskPage({ searchParams }: Props) {
  const filter = parseQuestionFilter((await searchParams)?.filter);
  return (
    <ClientMessages namespaces={['ustaad.qa', 'ustaad.labels', 'segments']}>
      <AskList filter={filter} />
    </ClientMessages>
  );
}
