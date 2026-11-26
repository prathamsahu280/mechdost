import { AgentJob } from '@/components/delivery/agent-job';

interface Props {
  params: Promise<{ jobId: string }>;
}

/** One delivery job in steps (spec 24). Ids that are not uuids never reach the API. */
export default async function DeliveryJobPage({ params }: Props) {
  const { jobId } = await params;
  const safe = /^[0-9a-f-]{36}$/i.test(jobId) ? jobId : '00000000-0000-0000-0000-000000000000';
  return <AgentJob jobId={safe} />;
}
