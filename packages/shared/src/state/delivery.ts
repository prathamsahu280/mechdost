import { defineMachine } from './machine';

/**
 * Delivery agents (spec 24; design 2026-11-26). A delivery job carries one agent-mode sub-order from its shop to the
 * customer; one active job per sub-order (partial unique index). Every move is a conditional UPDATE on `version`.
 *
 * - `needs_agent`: in the admin queue ("Needs an agent").
 * - `offered`: offered to one agent with a timer (`delivery_job_offers`, one open offer per job).
 * - `accepted` → `picked_up` with the shop's pickup code + photo → `delivered` with the customer's code + photo.
 * - `failed`: the agent could not deliver (reason + photo); admin retries with the same agent (`picked_up` again) or
 *   sends the parcel back (`returning`), confirmed by the shop with the agent's return code (`returned`).
 * - `cancelled`: before pickup only (order cancelled, or switched to the shop's own delivery).
 */
export const DELIVERY_JOB_STATES = [
  'needs_agent',
  'offered',
  'accepted',
  'picked_up',
  'delivered',
  'failed',
  'returning',
  'returned',
  'cancelled',
] as const;
export type DeliveryJobStatus = (typeof DELIVERY_JOB_STATES)[number];

/** The states the "one active job per sub-order" index covers (everything not terminal). */
export const DELIVERY_ACTIVE_JOB_STATES = [
  'needs_agent',
  'offered',
  'accepted',
  'picked_up',
  'failed',
  'returning',
] as const satisfies readonly DeliveryJobStatus[];

export const deliveryJobMachine = /* @__PURE__ */ defineMachine(
  'delivery_job',
  DELIVERY_JOB_STATES,
  ['delivered', 'returned', 'cancelled'],
  [
    { from: 'needs_agent', to: 'offered', by: ['admin'] },
    // A decline (agent), a timeout (system) or a withdrawn offer (admin) puts the job back in the queue.
    { from: 'offered', to: 'needs_agent', by: ['delivery_agent', 'system', 'admin'] },
    { from: 'offered', to: 'accepted', by: ['delivery_agent'] },
    // The agent gives the job up, or staff take it back, before pickup.
    { from: 'accepted', to: 'needs_agent', by: ['delivery_agent', 'admin'] },
    // 'admin' only through the audited override when the pickup code is locked.
    { from: 'accepted', to: 'picked_up', by: ['delivery_agent', 'admin'] },
    // 'admin' only through the audited delivery override (spec 04).
    { from: 'picked_up', to: 'delivered', by: ['delivery_agent', 'admin'] },
    { from: 'picked_up', to: 'failed', by: ['delivery_agent'] },
    // Retry with the same agent: the parcel never left them.
    { from: 'failed', to: 'picked_up', by: ['admin'] },
    // Retry with another agent, or close: the agent carries the parcel back to the shop.
    { from: 'failed', to: 'returning', by: ['admin'] },
    { from: 'returning', to: 'returned', by: ['shop', 'admin'] },
    { from: 'needs_agent', to: 'cancelled', by: ['admin', 'system'] },
    { from: 'offered', to: 'cancelled', by: ['admin', 'system'] },
    { from: 'accepted', to: 'cancelled', by: ['admin', 'system'] },
  ],
);

/** One offer of a job to one agent (like `order_assignments`). */
export const DELIVERY_OFFER_STATES = [
  'offered',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
  'given_up',
] as const;
export type DeliveryOfferStatus = (typeof DELIVERY_OFFER_STATES)[number];

export const deliveryOfferMachine = /* @__PURE__ */ defineMachine(
  'delivery_offer',
  DELIVERY_OFFER_STATES,
  ['declined', 'expired', 'withdrawn', 'given_up'],
  [
    { from: 'offered', to: 'accepted', by: ['delivery_agent'] },
    { from: 'offered', to: 'declined', by: ['delivery_agent'] },
    { from: 'offered', to: 'expired', by: ['system'] },
    { from: 'offered', to: 'withdrawn', by: ['admin', 'system'] },
    { from: 'accepted', to: 'given_up', by: ['delivery_agent'] },
    { from: 'accepted', to: 'withdrawn', by: ['admin', 'system'] },
  ],
);

/**
 * A delivery agent's standing (staff-set, with a reason code and history; decision 2026-11-01 partner standing).
 * `onboarding`: invited and signed in, documents being uploaded or checked; offers start at `active`.
 */
export const AGENT_STATUSES = ['onboarding', 'active', 'paused', 'suspended', 'offboarded'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const agentStatusMachine = /* @__PURE__ */ defineMachine(
  'delivery_agent',
  AGENT_STATUSES,
  ['offboarded'],
  [
    { from: 'onboarding', to: 'active', by: ['admin'] },
    { from: 'onboarding', to: 'offboarded', by: ['admin'] },
    { from: 'active', to: 'paused', by: ['admin'] },
    // A pause with an end date resumes by itself (the worker); staff can resume earlier.
    { from: 'paused', to: 'active', by: ['admin', 'system'] },
    { from: 'active', to: 'suspended', by: ['admin'] },
    { from: 'paused', to: 'suspended', by: ['admin'] },
    { from: 'suspended', to: 'active', by: ['admin'] },
    { from: 'active', to: 'offboarded', by: ['admin'] },
    { from: 'paused', to: 'offboarded', by: ['admin'] },
    { from: 'suspended', to: 'offboarded', by: ['admin'] },
  ],
);
