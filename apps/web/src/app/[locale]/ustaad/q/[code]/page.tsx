import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { USTAAD_QUESTION_CODE_RE } from '@mechdost/shared/ustaad/dto/qa';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { QuestionThread } from '@/components/ustaad/qa/question-thread';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ code: string }>;
}

/** Question thread (spec 23 § 5 `/ustaad/q/[code]`); a malformed code is a plain 404 before any request. */
export default async function UstaadQuestionPage({ params }: Props) {
  const { code } = await params;
  if (!USTAAD_QUESTION_CODE_RE.test(code)) notFound();
  return (
    <ClientMessages
      namespaces={[
        'ustaad.shell',
        'ustaad.standing',
        'ustaad.qa',
        'ustaad.media',
        'ustaad.labels',
        'ustaad.correction',
        'segments',
        'ustaad.saveControl',
      ]}
    >
      <MemberGate>
        <QuestionThread code={code} />
      </MemberGate>
    </ClientMessages>
  );
}
