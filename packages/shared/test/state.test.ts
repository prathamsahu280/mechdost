import { describe, expect, it } from 'vitest';
import {
  REFUND_HOLDING_STATES,
  REFUND_STATES,
  TICKET_STATES,
  refundMachine,
  assignmentMachine,
  orderMachine,
  paymentMachine,
  serviceRequestMachine,
  ticketMachine,
  applicationMachine,
  inviteMachine,
  shopStaffInviteMachine,
  priceRequestMachine,
} from '../src/state';
import { customerRefundStatus, myRefundStage, myRefundSteps, MY_REFUND_STAGES } from '../src/refunds-api';

describe('order state machine', () => {
  it('follows the admin-routing happy path', () => {
    const path = [
      'placed',
      'awaiting_shop',
      'confirmed',
      'packed',
      'shipped',
      'out_for_delivery',
      'delivered',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) expect(orderMachine.can(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('sends declined or expired orders back to admin, who can reroute or reject', () => {
    expect(orderMachine.can('awaiting_shop', 'needs_rerouting')).toBe(true);
    expect(orderMachine.can('needs_rerouting', 'awaiting_shop')).toBe(true);
    expect(orderMachine.can('needs_rerouting', 'rejected')).toBe(true);
  });
  it('forbids skipping steps and leaving terminal states', () => {
    expect(orderMachine.can('placed', 'confirmed')).toBe(false);
    expect(orderMachine.can('delivered', 'cancelled')).toBe(false);
    expect(orderMachine.can('cancelled', 'awaiting_shop')).toBe(false);
    expect(orderMachine.isTerminal('delivered')).toBe(true);
  });
  it('enforces which actor may perform a transition', () => {
    expect(orderMachine.canActor('awaiting_shop', 'confirmed', 'shop')).toBe(true);
    expect(orderMachine.canActor('awaiting_shop', 'confirmed', 'customer')).toBe(false);
    expect(orderMachine.canActor('placed', 'awaiting_shop', 'admin')).toBe(true);
    expect(orderMachine.canActor('placed', 'awaiting_shop', 'shop')).toBe(false);
    expect(orderMachine.canActor('awaiting_shop', 'needs_rerouting', 'system')).toBe(true);
    expect(orderMachine.canActor('confirmed', 'cancelled', 'customer')).toBe(true);
    expect(orderMachine.canActor('packed', 'cancelled', 'customer')).toBe(false);
  });
  it('assert throws a typed error on illegal transitions', () => {
    expect(() => {
      orderMachine.assert('placed', 'delivered', 'admin');
    }).toThrow(/illegal transition/i);
    expect(() => {
      orderMachine.assert('awaiting_shop', 'confirmed', 'customer');
    }).toThrow(/not allowed/i);
  });
});

describe('assignment state machine', () => {
  it('allows exactly one outcome from offered', () => {
    for (const to of ['accepted', 'declined', 'expired', 'withdrawn'] as const) {
      expect(assignmentMachine.can('offered', to)).toBe(true);
    }
    expect(assignmentMachine.can('accepted', 'declined')).toBe(false);
    expect(assignmentMachine.can('expired', 'accepted')).toBe(false);
  });

  it('a shop may give up an accepted order, nobody else, and only once', () => {
    expect(assignmentMachine.canActor('accepted', 'given_up', 'shop')).toBe(true);
    expect(assignmentMachine.canActor('accepted', 'given_up', 'customer')).toBe(false);
    expect(assignmentMachine.canActor('accepted', 'given_up', 'admin')).toBe(false);
    expect(assignmentMachine.can('given_up', 'accepted')).toBe(false);
    expect(assignmentMachine.isTerminal('given_up')).toBe(true);
  });

  it('a confirmed order goes back to admin (needs_rerouting) only by the shop, never once packed', () => {
    expect(orderMachine.canActor('confirmed', 'needs_rerouting', 'shop')).toBe(true);
    expect(orderMachine.canActor('confirmed', 'needs_rerouting', 'customer')).toBe(false);
    expect(orderMachine.can('packed', 'needs_rerouting')).toBe(false);
  });
});

describe('partner warning codes', () => {
  it('give-up and warning reasons are codes', async () => {
    const { ASSIGNMENT_GIVE_UP_REASONS } = await import('../src/state');
    const { PARTNER_WARNING_REASONS, IssueWarningSchema } = await import('../src/partner-warnings');
    expect(ASSIGNMENT_GIVE_UP_REASONS).toContain('other');
    expect(PARTNER_WARNING_REASONS).toContain('gave_up_orders');
    expect(IssueWarningSchema.safeParse({ reasonCode: 'other' }).success).toBe(false); // "other" needs a note
    expect(IssueWarningSchema.safeParse({ reasonCode: 'missed_offers' }).success).toBe(true);
    expect(IssueWarningSchema.safeParse({ reasonCode: 'made_up' }).success).toBe(false);
  });
});

describe('service request state machine', () => {
  it('follows proposal → estimate → work → bill', () => {
    const path = [
      'requested',
      'awaiting_workshop',
      'proposed',
      'confirmed',
      'vehicle_received',
      'estimate_sent',
      'approved',
      'in_progress',
      'ready',
      'billed',
      'paid',
      'completed',
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(serviceRequestMachine.can(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('supports admin routing and revised estimates', () => {
    expect(serviceRequestMachine.can('requested', 'needs_routing')).toBe(true);
    expect(serviceRequestMachine.can('needs_routing', 'awaiting_workshop')).toBe(true);
    expect(serviceRequestMachine.can('approved', 'estimate_sent')).toBe(true);
    expect(serviceRequestMachine.can('estimate_sent', 'no_work_approved')).toBe(true);
  });
  it('blocks customer and workshop cancellation once work starts; only staff may cancel a live job', () => {
    expect(serviceRequestMachine.canActor('confirmed', 'cancelled', 'customer')).toBe(true);
    for (const from of [
      'vehicle_received',
      'estimate_sent',
      'approved',
      'in_progress',
      'ready',
      'billed',
      'paid',
    ] as const) {
      expect(serviceRequestMachine.canActor(from, 'cancelled', 'customer')).toBe(false);
      expect(serviceRequestMachine.canActor(from, 'cancelled', 'workshop')).toBe(false);
      expect(serviceRequestMachine.canActor(from, 'cancelled', 'system')).toBe(false);
      expect(serviceRequestMachine.canActor(from, 'cancelled', 'admin')).toBe(true);
    }
    expect(serviceRequestMachine.can('completed', 'cancelled')).toBe(false);
  });
});

describe('payment state machine', () => {
  it('is monotonic: a late failure after paid is illegal', () => {
    expect(paymentMachine.can('created', 'attempted')).toBe(true);
    expect(paymentMachine.can('attempted', 'paid')).toBe(true);
    expect(paymentMachine.can('failed', 'attempted')).toBe(true);
    expect(paymentMachine.can('failed', 'paid')).toBe(true);
    expect(paymentMachine.can('paid', 'failed')).toBe(false);
    // A capture after the window closed is real money: recorded as paid so it can be refunded (spec 05).
    expect(paymentMachine.canActor('expired', 'paid', 'system')).toBe(true);
    expect(paymentMachine.canActor('expired', 'paid', 'admin')).toBe(false);
    expect(paymentMachine.can('expired', 'attempted')).toBe(false);
    expect(paymentMachine.can('paid', 'partially_refunded')).toBe(true);
    expect(paymentMachine.can('partially_refunded', 'refunded')).toBe(true);
  });
});

describe('refund state machine (decision 2026-11-15: all refunds need approval)', () => {
  it('never reaches Razorpay without an admin approval', () => {
    expect(refundMachine.canActor('requested', 'approved', 'admin')).toBe(true);
    expect(refundMachine.canActor('requested', 'approved', 'system')).toBe(false);
    expect(refundMachine.can('requested', 'initiated')).toBe(false);
    expect(refundMachine.can('requested', 'processed')).toBe(false);
    expect(refundMachine.canActor('requested', 'rejected', 'admin')).toBe(true);
  });
  it('only the system moves an approved refund on, and finished refunds stay finished', () => {
    expect(refundMachine.canActor('approved', 'initiated', 'system')).toBe(true);
    expect(refundMachine.canActor('approved', 'initiated', 'admin')).toBe(false);
    expect(refundMachine.can('approved', 'processed')).toBe(true);
    expect(refundMachine.can('initiated', 'processed')).toBe(true);
    expect(refundMachine.can('initiated', 'failed')).toBe(true);
    for (const done of ['rejected', 'processed'] as const) {
      expect(refundMachine.isTerminal(done)).toBe(true);
      expect(refundMachine.next(done)).toEqual([]);
    }
  });
  it('an unsure refund holds its amount and is settled only by a lookup, a webhook or a confirmed absence', () => {
    // Never failed straight from a timeout or an amount that differs: that would free money Razorpay may have sent.
    expect(refundMachine.canActor('approved', 'needs_reconciliation', 'system')).toBe(true);
    expect(refundMachine.canActor('initiated', 'needs_reconciliation', 'system')).toBe(true);
    expect(refundMachine.canActor('needs_reconciliation', 'processed', 'system')).toBe(true);
    expect(refundMachine.canActor('needs_reconciliation', 'failed', 'system')).toBe(true);
    // Finance settles it by hand after checking the dashboard (spec 05 "Settling by hand").
    expect(refundMachine.canActor('needs_reconciliation', 'processed', 'admin')).toBe(true);
    expect(refundMachine.canActor('needs_reconciliation', 'failed', 'admin')).toBe(true);
    expect(refundMachine.canActor('needs_reconciliation', 'initiated', 'admin')).toBe(false);
    expect(REFUND_HOLDING_STATES).toContain('needs_reconciliation');
    expect(customerRefundStatus('needs_reconciliation')).toBe('processing');
    // A refund we called failed can still be processed if Razorpay says so (a webhook is the truth).
    expect(refundMachine.canActor('failed', 'processed', 'system')).toBe(true);
    expect(refundMachine.canActor('failed', 'approved', 'system')).toBe(false);
  });
  it('never shows "refunded" to the customer before Razorpay confirms', () => {
    const shown = REFUND_STATES.filter((s) => customerRefundStatus(s) === 'refunded');
    expect(shown).toEqual(['processed']);
  });
});

describe('the customer refund page stages (2026-11-23)', () => {
  it('maps every refund status to one plain stage', () => {
    expect(Object.fromEntries(REFUND_STATES.map((st) => [st, myRefundStage(st)]))).toEqual({
      requested: 'requested',
      approved: 'approved',
      rejected: 'declined',
      initiated: 'sent',
      processed: 'completed',
      failed: 'failed',
      needs_reconciliation: 'checking',
    });
    expect(new Set(REFUND_STATES.map(myRefundStage))).toEqual(new Set(MY_REFUND_STAGES));
  });
  it('says "completed" only for a processed refund, like the order page', () => {
    expect(REFUND_STATES.filter((st) => myRefundStage(st) === 'completed')).toEqual(['processed']);
    expect(REFUND_STATES.filter((st) => customerRefundStatus(st) === 'refunded')).toEqual(['processed']);
  });
  it('draws four steps for a Razorpay refund and three for a payout by hand', () => {
    expect(myRefundSteps('original')).toEqual(['requested', 'approved', 'sent', 'completed']);
    expect(myRefundSteps('manual')).toEqual(['requested', 'approved', 'completed']);
  });
});

describe('ticket state machine', () => {
  it('a customer reply brings a waiting or resolved ticket back to review', () => {
    expect(ticketMachine.canActor('awaiting_customer', 'in_review', 'customer')).toBe(true);
    expect(ticketMachine.canActor('resolved', 'in_review', 'customer')).toBe(true);
  });
  it('customers cannot resolve or close; closed is final', () => {
    expect(ticketMachine.canActor('in_review', 'resolved', 'customer')).toBe(false);
    expect(ticketMachine.canActor('resolved', 'closed', 'customer')).toBe(false);
    for (const to of TICKET_STATES) expect(ticketMachine.canActor('closed', to, 'admin')).toBe(false);
  });
});

describe('seller onboarding machines (design 2026-11-13)', () => {
  it('applications: admin reviews; an invited one is approved by the system on submit', () => {
    expect(applicationMachine.canActor('new', 'in_review', 'admin')).toBe(true);
    expect(applicationMachine.canActor('in_review', 'approved', 'admin')).toBe(true);
    expect(applicationMachine.canActor('new', 'rejected', 'admin')).toBe(true);
    expect(applicationMachine.canActor('new', 'approved', 'system')).toBe(true);
    expect(applicationMachine.canActor('new', 'approved', 'shop')).toBe(false);
    expect(applicationMachine.can('approved', 'new')).toBe(false);
    expect(applicationMachine.isTerminal('rejected')).toBe(true);
  });

  it('invites: used or expired by the system, revoked by an admin, never reopened', () => {
    expect(inviteMachine.canActor('sent', 'used', 'system')).toBe(true);
    expect(inviteMachine.canActor('sent', 'expired', 'system')).toBe(true);
    expect(inviteMachine.canActor('sent', 'revoked', 'admin')).toBe(true);
    expect(inviteMachine.canActor('sent', 'revoked', 'shop')).toBe(false);
    expect(inviteMachine.can('used', 'sent')).toBe(false);
  });

  it('shop staff invites: used or expired by the system, cancelled by the shop or declined by the invitee, never reopened', () => {
    expect(shopStaffInviteMachine.canActor('sent', 'used', 'system')).toBe(true);
    expect(shopStaffInviteMachine.canActor('sent', 'expired', 'system')).toBe(true);
    expect(shopStaffInviteMachine.canActor('sent', 'revoked', 'shop')).toBe(true);
    expect(shopStaffInviteMachine.canActor('sent', 'used', 'shop')).toBe(false);
    expect(shopStaffInviteMachine.can('revoked', 'sent')).toBe(false);
  });

  it('price requests: only an admin decides; the shop may withdraw its own; a newer one supersedes', () => {
    expect(priceRequestMachine.canActor('pending', 'approved', 'admin')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'rejected', 'admin')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'approved', 'shop')).toBe(false);
    expect(priceRequestMachine.canActor('pending', 'withdrawn', 'shop')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'superseded', 'system')).toBe(true);
    expect(priceRequestMachine.can('approved', 'pending')).toBe(false);
  });
});
