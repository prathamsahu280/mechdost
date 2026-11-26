/**
 * Server analytics events of delivery agents (spec 12, spec 24; hard rules 9 and 16): ids, codes, enums, seconds and
 * grams only — never names, phones, addresses or document numbers. Merged into `ServerEventProps` (`../analytics.ts`).
 * KPIs (time to assign, acceptance rate, pickup and delivery time, failure rate by reason, utilisation) are computed
 * from these and from `delivery_job_events`.
 */
type Via = 'code' | 'override';

export interface DeliveryServerEventProps {
  delivery_agent_applied: { applicationCode: string; vehicleType: string };
  delivery_agent_invited: {
    inviteId: string;
    vehicleType: string;
    fromApplication: boolean;
    withEmail: boolean;
  };
  delivery_agent_joined: { agentId: string; inviteId: string };
  delivery_agent_document_submitted: { agentId: string; kind: string; resubmitted: boolean };
  delivery_agent_document_decided: {
    agentId: string;
    kind: string;
    decision: 'verified' | 'rejected';
    reasonCode: string | null;
  };
  delivery_agent_status_changed: { agentId: string; from: string; to: string; reasonCode: string | null };
  delivery_agent_online: { agentId: string; online: boolean };
  delivery_job_created: {
    jobId: string;
    orderCode: string;
    seq: number;
    loadClass: string;
    loadWeightG: number;
  };
  delivery_job_offered: {
    jobId: string;
    orderCode: string;
    agentId: string;
    offerId: string;
    attempt: number;
    distanceM: number | null;
  };
  delivery_offer_accepted: { jobId: string; offerId: string; agentId: string; secondsToAccept: number };
  delivery_offer_declined: { jobId: string; offerId: string; agentId: string; reasonCode: string };
  delivery_offer_expired: { jobId: string; offerId: string; agentId: string };
  delivery_offer_withdrawn: { jobId: string; offerId: string; agentId: string; reasonCode: string | null };
  delivery_job_given_up: { jobId: string; agentId: string; reasonCode: string };
  delivery_contact_revealed: { jobId: string; agentId: string; stage: string };
  delivery_picked_up: {
    jobId: string;
    orderCode: string;
    agentId: string;
    via: Via;
    secondsSinceAccept: number;
  };
  delivery_delivered: {
    jobId: string;
    orderCode: string;
    agentId: string;
    via: Via;
    secondsSincePickup: number;
    attempt: number;
  };
  delivery_failed: { jobId: string; orderCode: string; agentId: string; reasonCode: string; attempt: number };
  delivery_failure_decided: {
    jobId: string;
    orderCode: string;
    decision: 'retry' | 'return_to_shop';
    agent: 'same' | 'other' | null;
  };
  delivery_returned: {
    jobId: string;
    orderCode: string;
    outcome: 'retry' | 'close';
    via: Via;
    refundKind: string | null;
  };
  delivery_code_wrong: { jobId: string; purpose: 'pickup' | 'delivery' | 'return'; locked: boolean };
  /** Customer rated the agent (founder 2026-11-26); `edited` = a change within the 24 h window. */
  delivery_rated: { jobId: string; agentId: string; stars: number; reasons: string[]; edited: boolean };
  delivery_low_rating_alert: { agentId: string; avgX10: number; ratingCount: number };
  delivery_switch_requested: { orderCode: string; reasonCode: string };
  delivery_switch_decided: {
    orderCode: string;
    decision: 'confirmed' | 'declined';
    reasonCode: string | null;
  };
  shop_delivery_mode_requested: { shopId: string; requestedMode: string; reasonCode: string };
  shop_delivery_mode_decided: {
    shopId: string;
    mode: string;
    decision: 'approved' | 'rejected' | 'set';
    reasonCode: string | null;
  };
}
