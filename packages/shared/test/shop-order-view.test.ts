import { describe, expect, it } from 'vitest';
import { ShopOrder } from '../src/order-views';

// A shop's history lists orders it gave up; their lines may since carry another shop's price, so the API sends no
// prices for them (security review 2026-11-15). The web must still parse the row, or the whole list fails.
describe('ShopOrder view', () => {
  it('parses a given-up history row without prices', () => {
    const row = {
      code: 'MD-RPR-2026-ABC123-1',
      status: 'given_up',
      version: 3,
      totalPaise: 44_000,
      payoutPaise: null,
      collectPaise: null,
      coinDiscountPaise: 0,
      pincode: '492001',
      items: [{ title: 'Oil', titleHi: null, sku: 'OIL-1', qty: 1, unitPaise: null }],
      assignmentId: null,
      expiresAt: null,
      address: null,
      givenUpReason: 'out_of_stock',
    };
    expect(ShopOrder.safeParse(row).success).toBe(true);
  });
});
