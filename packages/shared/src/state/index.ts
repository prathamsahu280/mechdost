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

export const orderMachine = defineMachine(
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

/** An offer of an order or service request to one partner (one active per order — partial unique index). */
export const ASSIGNMENT_STATES = ['offered', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATES)[number];

export const assignmentMachine = defineMachine(
  'assignment',
  ASSIGNMENT_STATES,
  ['accepted', 'declined', 'expired', 'withdrawn'],
  [
    { from: 'offered', to: 'accepted', by: ['shop', 'workshop'] },
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

export const serviceRequestMachine = defineMachine(
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
    { from: 'confirmed', to: 'vehicle_received', by: ['workshop'] },
    { from: 'confirmed', to: 'cancelled', by: ['customer', 'admin', 'workshop'] },
    { from: 'vehicle_received', to: 'estimate_sent', by: ['workshop'] },
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

export const paymentMachine = defineMachine(
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

export const ticketMachine = defineMachine(
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

export const productMachine = defineMachine(
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

export const applicationMachine = defineMachine(
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

export const inviteMachine = defineMachine(
  'partner_invite',
  INVITE_STATES,
  ['used', 'expired', 'revoked'],
  [
    { from: 'sent', to: 'used', by: ['system'] },
    { from: 'sent', to: 'expired', by: ['system'] },
    { from: 'sent', to: 'revoked', by: ['admin'] },
  ],
);

/** A seller's price for one product, approved or rejected by staff line by line (user 2026-11-13). */
export const PRICE_REQUEST_STATES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type PriceRequestStatus = (typeof PRICE_REQUEST_STATES)[number];

export const priceRequestMachine = defineMachine(
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
