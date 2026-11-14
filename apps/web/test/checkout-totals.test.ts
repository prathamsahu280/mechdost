import { describe, expect, it } from 'vitest';
import { checkoutTotals } from '../src/lib/checkout-totals';

const quote = { totalPaise: 105_000, codFeePaise: 5_000, onlineTotalPaise: 100_000 };

describe('checkout totals (dark-pattern audit F1: no unlisted charge)', () => {
  it('cash on delivery shows the fee as its own line and pays the total that includes it', () => {
    expect(checkoutTotals({ ...quote, method: 'cod', coinDiscountPaise: 0 })).toEqual({
      feePaise: 5_000,
      payablePaise: 105_000,
    });
  });

  it('paying online carries no cash-on-delivery fee', () => {
    expect(checkoutTotals({ ...quote, method: 'online', coinDiscountPaise: 0 })).toEqual({
      feePaise: 0,
      payablePaise: 100_000,
    });
  });

  it('coins reduce what is paid, never the fee line', () => {
    expect(checkoutTotals({ ...quote, method: 'cod', coinDiscountPaise: 3_000 })).toEqual({
      feePaise: 5_000,
      payablePaise: 102_000,
    });
  });

  it('with no fee set (the default) the rows add up exactly as before', () => {
    const none = { totalPaise: 100_000, codFeePaise: 0, onlineTotalPaise: 100_000 };
    expect(checkoutTotals({ ...none, method: 'cod', coinDiscountPaise: 0 })).toEqual({
      feePaise: 0,
      payablePaise: 100_000,
    });
  });
});
