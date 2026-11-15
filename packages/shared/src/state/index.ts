import { defineMachine } from './machine';

export * from './machine';

/** Sub-order status (docs/specs/04-orders-routing-fulfilment.md). Parent order status is derived. */
export const ORDER_STATES = [
  'placed',
  'awaiting_shop',
  'needs_rerouting',
  'confirmed',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'rejected',
] as const;
export type OrderStatus = (typeof ORDER_STATES)[number];

export const orderMachine = /* @__PURE__ */ defineMachine(
  'order',
  ORDER_STATES,
  ['delivered', 'cancelled', 'rejected'],
  [
    { from: 'placed', to: 'awaiting_shop', by: ['admin', 'system'] },
    // system: an online order whose payment never completed (the worker, after the payment window).
    { from: 'placed', to: 'cancelled', by: ['customer', 'admin', 'system'] },
    { from: 'placed', to: 'rejected', by: ['admin'] },
    { from: 'awaiting_shop', to: 'confirmed', by: ['shop'] },
    { from: 'awaiting_shop', to: 'needs_rerouting', by: ['shop', 'system'] },
    { from: 'awaiting_shop', to: 'cancelled', by: ['customer', 'admin'] },
    { from: 'needs_rerouting', to: 'awaiting_shop', by: ['admin', 'system'] },
    { from: 'needs_rerouting', to: 'rejected', by: ['admin'] },
    { from: 'needs_rerouting', to: 'cancelled', by: ['customer', 'admin'] },
    { from: 'confirmed', to: 'packed', by: ['shop'] },
    // The shop gives the order up before packing: back to admin to reroute (user ruling 2026-11-15).
    { from: 'confirmed', to: 'needs_rerouting', by: ['shop'] },
    { from: 'confirmed', to: 'cancelled', by: ['customer', 'admin', 'shop'] },
    { from: 'packed', to: 'shipped', by: ['shop'] },
    { from: 'packed', to: 'cancelled', by: ['admin'] },
    { from: 'shipped', to: 'out_for_delivery', by: ['shop', 'system'] },
    { from: 'shipped', to: 'delivered', by: ['shop', 'system'] },
    // Staff confirm without the customer's code only through the audited override (spec 04, review B2).
    { from: 'out_for_delivery', to: 'delivered', by: ['shop', 'system', 'admin'] },
  ],
);

/**
 * Why staff rejected an order (spec 04; ML-ready codes, hard rule 16). The customer also gets a message.
 */
export const ORDER_REJECT_REASONS = [
  'no_stock_nearby',
  'all_shops_declined',
  'unserviceable_address',
  'suspected_fraud',
  'pricing_error',
  'other',
] as const;
export type OrderRejectReason = (typeof ORDER_REJECT_REASONS)[number];

/** Why an order was cancelled before delivery (customer or staff; ML-ready codes, spec 05). */
export const ORDER_CANCEL_REASONS = [
  'changed_mind',
  'ordered_by_mistake',
  'found_cheaper',
  'delivery_too_slow',
  'customer_unreachable',
  /** System: an online order whose payment did not complete within the payment window. */
  'payment_not_completed',
  'other',
] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];
/** Reasons a customer or staff member may pick; `payment_not_completed` is set by the system only. */
export const PERSON_CANCEL_REASONS = ORDER_CANCEL_REASONS.filter(
  (r): r is Exclude<OrderCancelReason, 'payment_not_completed'> => r !== 'payment_not_completed',
);

/** Why a customer cancelled a workshop booking (spec 06: allowed until the vehicle is received). */
export const SERVICE_CANCEL_REASONS = [
  'changed_mind',
  'booked_by_mistake',
  'found_another_workshop',
  'slot_not_suitable',
  'problem_solved',
  'other',
] as const;
export type ServiceCancelReason = (typeof SERVICE_CANCEL_REASONS)[number];

/** Where a service happens: the vehicle goes to the workshop, or a workshop mechanic comes to the customer's home. */
export const SERVICE_MODES = ['workshop', 'home'] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

/** Why a workshop offers to move a home job to the workshop (spec 06 home servicing). */
export const MOVE_REASONS = ['needs_lift', 'needs_tools', 'parts_unavailable', 'other'] as const;
export type MoveReason = (typeof MOVE_REASONS)[number];

/** How the vehicle gets to the workshop if the customer accepts the move. */
export const MOVE_TRANSPORTS = ['customer_drops', 'workshop_picks_up'] as const;
export type MoveTransport = (typeof MOVE_TRANSPORTS)[number];

/** Why a workshop waives the home visit fee (the bill line stays, at 0). */
export const VISIT_FEE_WAIVE_REASONS = ['goodwill', 'small_job', 'regular_customer', 'other'] as const;
export type VisitFeeWaiveReason = (typeof VISIT_FEE_WAIVE_REASONS)[number];

/** Why a workshop declined a service request (ML-ready codes; the request goes back to MechDost for routing). */
export const SERVICE_DECLINE_REASONS = [
  'fully_booked',
  'vehicle_not_supported',
  'service_not_offered',
  'too_far',
  'workshop_closed',
  'other',
] as const;
export type ServiceDeclineReason = (typeof SERVICE_DECLINE_REASONS)[number];

/** Why staff rejected a service request they could not route (spec 06; the customer also gets a message). */
export const SERVICE_REJECT_REASONS = [
  'no_workshop_nearby',
  'all_workshops_declined',
  'unserviceable_address',
  'suspected_fraud',
  'other',
] as const;
export type ServiceRejectReason = (typeof SERVICE_REJECT_REASONS)[number];

/** Why a shop declined an offered order (ML-ready codes; spec 04, partner scorecards). */
export const ASSIGNMENT_DECLINE_REASONS = [
  'out_of_stock',
  'too_far',
  'shop_closed',
  'too_busy',
  'price_mismatch',
  'other',
] as const;
export type AssignmentDeclineReason = (typeof ASSIGNMENT_DECLINE_REASONS)[number];

/** Why a shop gave up an accepted order before packing (ML-ready codes; counts against the shop's score, spec 04). */
export const ASSIGNMENT_GIVE_UP_REASONS = [
  'out_of_stock',
  'stock_damaged',
  'cannot_deliver',
  'shop_closed',
  'price_issue',
  'other',
] as const;
export type AssignmentGiveUpReason = (typeof ASSIGNMENT_GIVE_UP_REASONS)[number];

/** An offer of an order or service request to one partner (one active per order — partial unique index). */
export const ASSIGNMENT_STATES = [
  'offered',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
  'given_up',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATES)[number];

export const assignmentMachine = /* @__PURE__ */ defineMachine(
  'assignment',
  ASSIGNMENT_STATES,
  ['declined', 'expired', 'withdrawn', 'given_up'],
  [
    { from: 'offered', to: 'accepted', by: ['shop', 'workshop'] },
    { from: 'accepted', to: 'given_up', by: ['shop'] },
    { from: 'offered', to: 'declined', by: ['shop', 'workshop'] },
    { from: 'offered', to: 'expired', by: ['system'] },
    { from: 'offered', to: 'withdrawn', by: ['admin', 'system'] },
  ],
);

/** Service request status (docs/specs/06-workshops-service-requests.md). */
export const SERVICE_REQUEST_STATES = [
  'requested',
  'needs_routing',
  'awaiting_workshop',
  'proposed',
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
  'billed',
  'paid',
  'completed',
  'cancelled',
  'rejected',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATES)[number];

export const serviceRequestMachine = /* @__PURE__ */ defineMachine(
  'service_request',
  SERVICE_REQUEST_STATES,
  ['completed', 'cancelled', 'rejected'],
  [
    { from: 'requested', to: 'awaiting_workshop', by: ['system'] },
    { from: 'requested', to: 'needs_routing', by: ['system'] },
    { from: 'requested', to: 'cancelled', by: ['customer', 'admin'] },
    { from: 'needs_routing', to: 'awaiting_workshop', by: ['admin', 'system'] },
    { from: 'needs_routing', to: 'rejected', by: ['admin'] },
    { from: 'needs_routing', to: 'cancelled', by: ['customer', 'admin'] },
    { from: 'awaiting_workshop', to: 'proposed', by: ['workshop'] },
    { from: 'awaiting_workshop', to: 'needs_routing', by: ['workshop', 'system'] },
    { from: 'awaiting_workshop', to: 'cancelled', by: ['customer', 'admin'] },
    { from: 'proposed', to: 'confirmed', by: ['customer'] },
    { from: 'proposed', to: 'awaiting_workshop', by: ['customer'] },
    { from: 'proposed', to: 'needs_routing', by: ['admin'] },
    { from: 'proposed', to: 'cancelled', by: ['customer', 'admin'] },
    // 'admin' only through the audited arrival-code override (home servicing).
    { from: 'confirmed', to: 'vehicle_received', by: ['workshop', 'admin'] },
    // Customer reschedule (spec 06): the confirmed slot is released and the workshop answers the new time.
    { from: 'confirmed', to: 'awaiting_workshop', by: ['customer'] },
    { from: 'confirmed', to: 'cancelled', by: ['customer', 'admin', 'workshop'] },
    { from: 'vehicle_received', to: 'estimate_sent', by: ['workshop'] },
    // Home servicing: the customer declined the offer to move the job to the workshop (spec 06); only that path uses it.
    { from: 'vehicle_received', to: 'no_work_approved', by: ['customer'] },
    { from: 'estimate_sent', to: 'approved', by: ['customer'] },
    { from: 'estimate_sent', to: 'no_work_approved', by: ['customer'] },
    { from: 'approved', to: 'estimate_sent', by: ['workshop'] },
    { from: 'approved', to: 'in_progress', by: ['workshop'] },
    { from: 'no_work_approved', to: 'estimate_sent', by: ['workshop'] },
    { from: 'no_work_approved', to: 'billed', by: ['workshop'] },
    { from: 'no_work_approved', to: 'completed', by: ['workshop', 'admin'] },
    { from: 'in_progress', to: 'estimate_sent', by: ['workshop'] },
    { from: 'in_progress', to: 'ready', by: ['workshop'] },
    { from: 'ready', to: 'billed', by: ['workshop'] },
    { from: 'billed', to: 'paid', by: ['system', 'workshop'] },
    { from: 'paid', to: 'completed', by: ['system', 'customer'] },
  ],
);

/** Requests a customer may still cancel (before the vehicle reaches the workshop; spec 06). */
export const SERVICE_CUSTOMER_CANCELLABLE = [
  'requested',
  'needs_routing',
  'awaiting_workshop',
  'proposed',
  'confirmed',
] as const satisfies readonly ServiceRequestStatus[];

/** States from which a workshop may send a (new) estimate: never while the customer is deciding one. */
export const ESTIMATE_SENDABLE_FROM = [
  'vehicle_received',
  'approved',
  'in_progress',
  'no_work_approved',
] as const satisfies readonly ServiceRequestStatus[];

/** Online payment status — monotonic so late/out-of-order webhooks can never regress it. */
export const PAYMENT_STATES = [
  'created',
  'attempted',
  'failed',
  'paid',
  'partially_refunded',
  'refunded',
  'expired',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATES)[number];

export const paymentMachine = /* @__PURE__ */ defineMachine(
  'payment',
  PAYMENT_STATES,
  ['refunded', 'expired'],
  [
    { from: 'created', to: 'attempted', by: ['system'] },
    { from: 'created', to: 'paid', by: ['system'] },
    { from: 'created', to: 'failed', by: ['system'] },
    { from: 'created', to: 'expired', by: ['system'] },
    { from: 'attempted', to: 'paid', by: ['system'] },
    { from: 'attempted', to: 'failed', by: ['system'] },
    { from: 'attempted', to: 'expired', by: ['system'] },
    { from: 'failed', to: 'attempted', by: ['system'] },
    { from: 'failed', to: 'paid', by: ['system'] },
    { from: 'failed', to: 'expired', by: ['system'] },
    { from: 'paid', to: 'partially_refunded', by: ['system', 'admin'] },
    { from: 'paid', to: 'refunded', by: ['system', 'admin'] },
    { from: 'partially_refunded', to: 'refunded', by: ['system', 'admin'] },
  ],
);

/**
 * Support ticket status (docs/specs/09-support.md). A customer reply (web, app or WhatsApp) moves a ticket that is
 * waiting on them back to review; a reply to a resolved ticket reopens it; closing is final.
 */
export const TICKET_STATES = ['open', 'in_review', 'awaiting_customer', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATES)[number];

export const ticketMachine = /* @__PURE__ */ defineMachine(
  'ticket',
  TICKET_STATES,
  ['closed'],
  [
    { from: 'open', to: 'in_review', by: ['admin'] },
    { from: 'open', to: 'awaiting_customer', by: ['admin'] },
    { from: 'open', to: 'resolved', by: ['admin'] },
    { from: 'in_review', to: 'awaiting_customer', by: ['admin'] },
    { from: 'in_review', to: 'resolved', by: ['admin'] },
    { from: 'awaiting_customer', to: 'in_review', by: ['customer', 'admin'] },
    { from: 'awaiting_customer', to: 'resolved', by: ['admin'] },
    { from: 'awaiting_customer', to: 'closed', by: ['system'] },
    { from: 'resolved', to: 'in_review', by: ['customer', 'admin'] },
    { from: 'resolved', to: 'closed', by: ['system', 'admin'] },
  ],
);

/**
 * Catalogue product status (spec 02; matches the `products_status_valid` CHECK). Shops submit, MechDost's
 * catalogue team (`admin` actor) publishes, rejects or archives. Archived products can be revived as drafts.
 */
export const PRODUCT_STATES = ['draft', 'submitted', 'live', 'rejected', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATES)[number];

export const productMachine = /* @__PURE__ */ defineMachine(
  'product',
  PRODUCT_STATES,
  [],
  [
    { from: 'draft', to: 'submitted', by: ['shop', 'admin'] },
    { from: 'draft', to: 'live', by: ['admin'] },
    { from: 'submitted', to: 'live', by: ['admin'] },
    { from: 'submitted', to: 'rejected', by: ['admin'] },
    { from: 'rejected', to: 'draft', by: ['shop', 'admin'] },
    { from: 'live', to: 'archived', by: ['admin'] },
    { from: 'archived', to: 'draft', by: ['admin'] },
  ],
);

/** Seller applications (design 2026-11-13): staff review; an invited application is approved on submit. */
export const APPLICATION_STATES = ['new', 'in_review', 'approved', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATES)[number];

export const applicationMachine = /* @__PURE__ */ defineMachine(
  'partner_application',
  APPLICATION_STATES,
  ['approved', 'rejected'],
  [
    { from: 'new', to: 'in_review', by: ['admin'] },
    { from: 'new', to: 'approved', by: ['admin', 'system'] },
    { from: 'new', to: 'rejected', by: ['admin'] },
    { from: 'in_review', to: 'approved', by: ['admin'] },
    { from: 'in_review', to: 'rejected', by: ['admin'] },
  ],
);

/** Admin invites to sellers: one-time links. */
export const INVITE_STATES = ['sent', 'used', 'expired', 'revoked'] as const;
export type InviteStatus = (typeof INVITE_STATES)[number];

export const inviteMachine = /* @__PURE__ */ defineMachine(
  'partner_invite',
  INVITE_STATES,
  ['used', 'expired', 'revoked'],
  [
    { from: 'sent', to: 'used', by: ['system'] },
    { from: 'sent', to: 'expired', by: ['system'] },
    { from: 'sent', to: 'revoked', by: ['admin'] },
  ],
);

/**
 * An owner's invite for a helper to join the shop (design 2026-11-15): bound to the invitee's phone, claimed when
 * they sign in with it (system), cancelled by the shop, expired by the system. Same states as `inviteMachine`.
 */
export const shopStaffInviteMachine = defineMachine(
  'shop_staff_invite',
  INVITE_STATES,
  ['used', 'expired', 'revoked'],
  [
    { from: 'sent', to: 'used', by: ['system'] },
    { from: 'sent', to: 'expired', by: ['system'] },
    { from: 'sent', to: 'revoked', by: ['shop', 'customer'] },
  ],
);

/** A seller's price for one product, approved or rejected by staff line by line (user 2026-11-13). */
export const PRICE_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type PriceRequestStatus = (typeof PRICE_REQUEST_STATES)[number];

export const priceRequestMachine = /* @__PURE__ */ defineMachine(
  'price_request',
  PRICE_REQUEST_STATES,
  ['approved', 'rejected', 'withdrawn', 'superseded'],
  [
    { from: 'pending', to: 'approved', by: ['admin'] },
    { from: 'pending', to: 'rejected', by: ['admin'] },
    { from: 'pending', to: 'withdrawn', by: ['shop'] },
    { from: 'pending', to: 'superseded', by: ['system'] },
  ],
);

/**
 * Bulk quote status (spec 19). Staff talk and send versioned offers; a newer offer supersedes the active one while
 * the quote stays `offered`; a customer message on an offered quote reopens talks (`negotiating`, offer superseded). The customer accepts the active, unexpired offer (→ a normal order) or closes the
 * quote; staff may withdraw it with a reason; the worker expires quotes whose offer ran out or that went quiet.
 */
export const QUOTE_STATES = [
  'open',
  'negotiating',
  'offered',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
] as const;
export type QuoteStatus = (typeof QUOTE_STATES)[number];

export const quoteMachine = /* @__PURE__ */ defineMachine(
  'quote',
  QUOTE_STATES,
  ['accepted', 'declined', 'expired', 'withdrawn'],
  [
    { from: 'open', to: 'negotiating', by: ['admin'] },
    { from: 'open', to: 'offered', by: ['admin'] },
    { from: 'negotiating', to: 'offered', by: ['admin'] },
    { from: 'offered', to: 'accepted', by: ['customer'] },
    // Spec 19: a customer message on an offered quote reopens talks and supersedes the active offer; when the
    // offer runs out the worker reopens talks too (ruling 2026-11-14: the quote stays open for a new offer).
    { from: 'offered', to: 'negotiating', by: ['customer', 'system'] },
    { from: 'open', to: 'declined', by: ['customer'] },
    { from: 'negotiating', to: 'declined', by: ['customer'] },
    { from: 'offered', to: 'declined', by: ['customer'] },
    { from: 'open', to: 'withdrawn', by: ['admin'] },
    { from: 'negotiating', to: 'withdrawn', by: ['admin'] },
    { from: 'offered', to: 'withdrawn', by: ['admin'] },
    { from: 'open', to: 'expired', by: ['system'] },
    { from: 'negotiating', to: 'expired', by: ['system'] },
    { from: 'offered', to: 'expired', by: ['system'] },
  ],
);

/** Quotes still being negotiated (they count toward the customer's open-quote limit). */
export const QUOTE_OPEN_STATES = ['open', 'negotiating', 'offered'] as const satisfies readonly QuoteStatus[];

/** Why a customer closed their quote (ML-ready codes, hard rule 16). */
export const QUOTE_DECLINE_REASONS = [
  'price_too_high',
  'found_elsewhere',
  'no_longer_needed',
  'delivery_too_slow',
  'other',
] as const;
export type QuoteDeclineReason = (typeof QUOTE_DECLINE_REASONS)[number];

/** Why staff withdrew a quote (the customer also gets a message). */
export const QUOTE_WITHDRAW_REASONS = [
  'cannot_supply',
  'not_serviceable',
  'duplicate',
  'suspected_fraud',
  'customer_unreachable',
  'other',
] as const;
export type QuoteWithdrawReason = (typeof QUOTE_WITHDRAW_REASONS)[number];

/** Why the system expired a quote: nobody wrote for the inactivity window (an expired offer only reopens talks). */
export const QUOTE_EXPIRE_REASONS = ['inactive'] as const;
export type QuoteExpireReason = (typeof QUOTE_EXPIRE_REASONS)[number];

/** A versioned offer: one `active` per quote (partial unique index); a newer one supersedes it; it may run out. */
export const QUOTE_OFFER_STATES = ['active', 'superseded', 'accepted', 'expired', 'closed'] as const;
export type QuoteOfferStatus = (typeof QUOTE_OFFER_STATES)[number];

/**
 * Refund request (spec 05, decision 2026-11-15 "All need approval"): every refund waits for a staff member with
 * `refunds:approve` before Razorpay is called. `approved → processed` exists because the `refund.processed` webhook
 * may arrive before we have stored the Razorpay refund id. `rejected`, `processed` and `failed` are final; money
 * still owed after a failure is a new request.
 */
export const REFUND_STATES = [
  'requested',
  'approved',
  'rejected',
  'initiated',
  'processed',
  'failed',
  'needs_reconciliation',
] as const;
export type RefundStatus = (typeof REFUND_STATES)[number];

export const refundMachine = /* @__PURE__ */ defineMachine(
  'refund',
  REFUND_STATES,
  ['rejected', 'processed'],
  [
    { from: 'requested', to: 'approved', by: ['admin'] },
    { from: 'requested', to: 'rejected', by: ['admin'] },
    { from: 'approved', to: 'initiated', by: ['system'] },
    // The Razorpay webhook (system) can beat our write of its refund id; finance (admin) marks a manual payout paid.
    { from: 'approved', to: 'processed', by: ['system', 'admin'] },
    { from: 'approved', to: 'failed', by: ['system'] },
    { from: 'initiated', to: 'processed', by: ['system'] },
    { from: 'initiated', to: 'failed', by: ['system'] },
    // We cannot tell whether Razorpay holds a refund for it (a timeout on create, an amount that differs from ours,
    // a refusal we could not double-check): the amount stays reserved and a lookup or a person settles it. Only a
    // confirmed "no such refund" fails it. A refund we called failed can still turn out to be processed (webhook).
    { from: 'approved', to: 'needs_reconciliation', by: ['system'] },
    { from: 'initiated', to: 'needs_reconciliation', by: ['system'] },
    { from: 'needs_reconciliation', to: 'initiated', by: ['system'] },
    { from: 'needs_reconciliation', to: 'processed', by: ['system'] },
    { from: 'needs_reconciliation', to: 'failed', by: ['system'] },
    { from: 'failed', to: 'processed', by: ['system'] },
  ],
);

/** Refunds that still count against what was captured (a rejected or failed one frees its amount; an unsure one holds it). */
export const REFUND_HOLDING_STATES = [
  'requested',
  'approved',
  'initiated',
  'processed',
  'needs_reconciliation',
] as const satisfies readonly RefundStatus[];

/** Where a refund request came from (ML-ready codes, hard rule 16). */
export const REFUND_SOURCES = [
  'order_rejected',
  'order_cancelled',
  'unfulfilled',
  'support_claim',
  'part_refund',
  'other',
] as const;
export type RefundSource = (typeof REFUND_SOURCES)[number];

/** Why money goes back. Staff pick one of these; the system sets the first two. */
export const REFUND_REASONS = [
  'order_rejected',
  'order_cancelled',
  'faulty',
  'damaged_in_transit',
  'wrong_item',
  'missing_item',
  'not_fulfilled',
  'goodwill',
  'other',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** Why finance declined a refund request. */
export const REFUND_REJECT_REASONS = [
  'not_eligible',
  'already_refunded',
  'wrong_amount',
  'suspected_fraud',
  'other',
] as const;
export type RefundRejectReason = (typeof REFUND_REJECT_REASONS)[number];
