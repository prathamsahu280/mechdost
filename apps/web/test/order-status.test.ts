import { describe, expect, it } from 'vitest';
import { ORDER_STATES } from '@mechdost/shared/state';
import { ORDER_STEPS, isClosedStatus, orderStatusKey, orderStepIndex } from '../src/lib/order-status';

describe('order status for customers', () => {
  it('maps every API order state to a step or a closed label', () => {
    for (const s of ORDER_STATES) {
      const key = orderStatusKey(s);
      if (isClosedStatus(s)) expect(['cancelledTitle', 'rejectedTitle']).toContain(key);
      else expect(key).toMatch(/^stage_/);
    }
  });

  it('shows routing while the shop decides or the order is being rerouted', () => {
    expect(orderStatusKey('awaiting_shop')).toBe('stage_routing');
    expect(orderStatusKey('needs_rerouting')).toBe('stage_routing');
  });

  it('marks every step done once delivered', () => {
    expect(orderStepIndex('delivered')).toBe(ORDER_STEPS.length);
    expect(orderStatusKey('delivered')).toBe('stage_delivered');
  });

  it('treats out for delivery as shipped and unknown states as placed', () => {
    expect(orderStatusKey('out_for_delivery')).toBe('stage_shipped');
    expect(orderStepIndex('something_new')).toBe(0);
  });
});
