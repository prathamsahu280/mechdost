import { AgentHistory } from '@/components/delivery/agent-portal';

/** Agent portal → History (spec 24): finished jobs; no customer details are kept. */
export default function DeliveryHistoryPage() {
  return <AgentHistory />;
}
