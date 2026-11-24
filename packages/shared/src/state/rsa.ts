import { defineMachine } from './machine';

/**
 * Roadside assistance request status (docs/specs/22-roadside-assistance.md). Own machine, not a service-request mode.
 * `awaiting_payment` exists because the row must exist before the Razorpay order for the advance does; it is in no
 * queue. `requested` = the advance is paid. Later phases add `towing`, `no_responder` (spec 22 "Not built").
 */
export const RSA_STATES = [
  'awaiting_payment',
  'requested',
  'offered',
  'accepted',
  'en_route',
  'arrived',
  'in_progress',
  'billed',
  'completed',
  'cancelled',
] as const;
export type RsaStatus = (typeof RSA_STATES)[number];

export const rsaMachine = /* @__PURE__ */ defineMachine(
  'rsa_request',
  RSA_STATES,
  ['completed', 'cancelled'],
  [
    // The advance was captured (webhook or verified checkout), or never paid within the window.
    { from: 'awaiting_payment', to: 'requested', by: ['system'] },
    { from: 'awaiting_payment', to: 'cancelled', by: ['customer', 'system'] },
    // Dispatch: admin sends an offer; a decline, a timeout or a withdrawn offer puts it back in the queue.
    { from: 'requested', to: 'offered', by: ['admin', 'system'] },
    { from: 'offered', to: 'requested', by: ['admin', 'workshop', 'system'] },
    { from: 'offered', to: 'accepted', by: ['workshop'] },
    // Admin cancels only while nobody has accepted; the advance is refunded (refund request, finance approves).
    { from: 'requested', to: 'cancelled', by: ['admin'] },
    { from: 'offered', to: 'cancelled', by: ['admin'] },
    // The responder gives the job up or admin takes it back before the vehicle is reached: back to the queue.
    { from: 'accepted', to: 'requested', by: ['workshop', 'admin'] },
    { from: 'en_route', to: 'requested', by: ['workshop', 'admin'] },
    { from: 'accepted', to: 'en_route', by: ['workshop'] },
    // 'admin' only through the audited arrival-code override.
    { from: 'accepted', to: 'arrived', by: ['workshop', 'admin'] },
    { from: 'en_route', to: 'arrived', by: ['workshop', 'admin'] },
    { from: 'arrived', to: 'in_progress', by: ['workshop'] },
    { from: 'in_progress', to: 'billed', by: ['workshop'] },
    // Balance paid online (system) or taken in cash (workshop); a zero balance completes at once (system).
    { from: 'billed', to: 'completed', by: ['system', 'workshop'] },
  ],
);

/** The responder is attached from `offered` on; these are the states in which an active offer exists. */
export const RSA_OFFER_STATES = ['offered', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type RsaOfferStatus = (typeof RSA_OFFER_STATES)[number];

export const rsaOfferMachine = /* @__PURE__ */ defineMachine(
  'rsa_offer',
  RSA_OFFER_STATES,
  ['declined', 'expired', 'withdrawn'],
  [
    { from: 'offered', to: 'accepted', by: ['workshop'] },
    { from: 'offered', to: 'declined', by: ['workshop'] },
    { from: 'offered', to: 'expired', by: ['system'] },
    { from: 'offered', to: 'withdrawn', by: ['admin', 'system'] },
    // An accepted responder gives the job up, or admin takes it back (the request returns to the queue).
    { from: 'accepted', to: 'withdrawn', by: ['admin', 'workshop'] },
  ],
);
