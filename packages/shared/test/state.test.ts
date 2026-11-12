import { describe, expect, it } from 'vitest';
import {
  TICKET_STATES,
  assignmentMachine,
  orderMachine,
  paymentMachine,
  serviceRequestMachine,
  ticketMachine,
  applicationMachine,
  inviteMachine,
  priceRequestMachine,
} from '../src/state';

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
  it('blocks cancellation once work starts', () => {
    expect(serviceRequestMachine.canActor('confirmed', 'cancelled', 'customer')).toBe(true);
    expect(serviceRequestMachine.can('in_progress', 'cancelled')).toBe(false);
  });
});

describe('payment state machine', () => {
  it('is monotonic: a late failure after paid is illegal', () => {
    expect(paymentMachine.can('created', 'attempted')).toBe(true);
    expect(paymentMachine.can('attempted', 'paid')).toBe(true);
    expect(paymentMachine.can('failed', 'attempted')).toBe(true);
    expect(paymentMachine.can('failed', 'paid')).toBe(true);
    expect(paymentMachine.can('paid', 'failed')).toBe(false);
    expect(paymentMachine.can('paid', 'partially_refunded')).toBe(true);
    expect(paymentMachine.can('partially_refunded', 'refunded')).toBe(true);
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

  it('price requests: only an admin decides; the shop may withdraw its own; a newer one supersedes', () => {
    expect(priceRequestMachine.canActor('pending', 'approved', 'admin')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'rejected', 'admin')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'approved', 'shop')).toBe(false);
    expect(priceRequestMachine.canActor('pending', 'withdrawn', 'shop')).toBe(true);
    expect(priceRequestMachine.canActor('pending', 'superseded', 'system')).toBe(true);
    expect(priceRequestMachine.can('approved', 'pending')).toBe(false);
  });
});
