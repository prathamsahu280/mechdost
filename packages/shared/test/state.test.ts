import { describe, expect, it } from 'vitest';
import { assignmentMachine, orderMachine, paymentMachine, serviceRequestMachine } from '../src/state';

describe('order state machine', () => {
  it('follows the admin-routing happy path', () => {
    const path = ['placed', 'awaiting_shop', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'] as const;
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
    expect(() => orderMachine.assert('placed', 'delivered', 'admin')).toThrowError(/illegal transition/i);
    expect(() => orderMachine.assert('awaiting_shop', 'confirmed', 'customer')).toThrowError(/not allowed/i);
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
    for (let i = 0; i < path.length - 1; i++) expect(serviceRequestMachine.can(path[i]!, path[i + 1]!)).toBe(true);
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
