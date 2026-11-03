import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeLevels,
  blockCustomer,
  customerAllowed,
  liftCustomerBlock,
  CUSTOMER_BLOCKS_KEY,
} from '../src/demo/customer-blocks';

/** Minimal browser stand-in: the store needs localStorage and storage-event listeners only. */
function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return data;
}

const customer = { id: 'demo-customer', role: 'customer' };
const block = (
  level: 'cod_only' | 'orders' | 'full',
  extra: Partial<Parameters<typeof blockCustomer>[0]> = {},
) =>
  blockCustomer({
    account: customer,
    level,
    reasonCode: 'cod_refused',
    note: '',
    endsAt: null,
    by: 'Admin',
    ...extra,
  });

describe('demo customer blocks (same rules as the API)', () => {
  beforeEach(() => {
    fakeWindow();
  });

  it('applies levels: cod_only stops COD, orders stops ordering, full stops sign-in', () => {
    expect(customerAllowed(customer.id)).toEqual({ signIn: true, order: true, cod: true });
    expect(block('cod_only')).toEqual({ ok: true });
    expect(customerAllowed(customer.id)).toEqual({ signIn: true, order: true, cod: false });
    expect(block('full')).toEqual({ ok: true });
    expect(customerAllowed(customer.id)).toEqual({ signIn: false, order: false, cod: false });
  });

  it('one active block per level; lifting needs a reason; staff and partners are never blocked', () => {
    expect(block('orders')).toEqual({ ok: true });
    expect(block('orders')).toEqual({ ok: false, reason: 'already' });
    for (const role of ['admin', 'shop', 'workshop']) {
      expect(block('orders', { account: { id: `x-${role}`, role } })).toEqual({
        ok: false,
        reason: 'not_customer',
      });
    }
    const [stored] = JSON.parse(
      (globalThis as unknown as { window: Window }).window.localStorage.getItem(CUSTOMER_BLOCKS_KEY) ?? '[]',
    ) as { id: string }[];
    expect(liftCustomerBlock(stored!.id, 'ok', 'Admin')).toEqual({ ok: false, reason: 'reason' });
    expect(liftCustomerBlock(stored!.id, 'Spoke to the customer', 'Admin')).toEqual({ ok: true });
    expect(activeLevels(customer.id)).toEqual([]);
    expect(block('orders')).toEqual({ ok: true }); // a new block after lifting
  });

  it('end dates must be in the future and stop the block when reached', () => {
    expect(block('orders', { endsAt: new Date(Date.now() - 1000).toISOString() })).toEqual({
      ok: false,
      reason: 'ends_at',
    });
    expect(block('orders', { endsAt: new Date(Date.now() + 60_000).toISOString() })).toEqual({ ok: true });
    expect(activeLevels(customer.id)).toEqual(['orders']);
  });
});
