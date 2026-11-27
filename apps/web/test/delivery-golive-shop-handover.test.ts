/**
 * DC-P9 (QA 2026-11-27): a packed sub-order of an agents-mode shop comes from the API with `deliveryMode: 'agent'`
 * and `delivery: null` (no job yet). The card offered the shop's own "Mark out for delivery"; it must show the agent
 * hand-over ("Mark ready for pickup").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shopAgentHandover } from '../src/lib/delivery/view';

describe('shop card picks the step by the order delivery mode (DC-P9)', () => {
  it('packed agent order without a job yet → hand-over panel with "Mark ready for pickup"', () => {
    const view = shopAgentHandover({ status: 'packed', deliveryMode: 'agent', delivery: null });
    expect(view).not.toBeNull();
    expect(view?.mode).toBe('agent');
    expect(view?.jobStatus).toBeNull();
  });

  it('keeps the job view when the API sends one', () => {
    const delivery = {
      mode: 'agent' as const,
      pickupCode: '1234',
      pickupLocked: false,
      jobStatus: 'needs_agent' as const,
      agentFirstName: null,
      vehicleType: null,
      returning: false,
      switchRequest: null,
    };
    expect(shopAgentHandover({ status: 'ready_for_pickup', deliveryMode: 'agent', delivery })).toBe(delivery);
  });

  it('self-delivery orders and orders before packing keep the shop steps', () => {
    expect(shopAgentHandover({ status: 'packed', deliveryMode: 'shop', delivery: null })).toBeNull();
    expect(shopAgentHandover({ status: 'packed', deliveryMode: null, delivery: null })).toBeNull();
    expect(shopAgentHandover({ status: 'confirmed', deliveryMode: 'agent', delivery: null })).toBeNull();
  });

  it('the shop card uses the helper', () => {
    const src = readFileSync(
      new URL('../src/components/portal/shop-portal-api.tsx', import.meta.url),
      'utf8',
    );
    expect(src).toContain('shopAgentHandover(');
    expect(src).not.toMatch(/delivery !== null &&\s*\(order\.deliveryMode/);
  });
});
