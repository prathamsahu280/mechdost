/**
 * Free delivery per order group (spec 03): the first threshold that is set wins — the PIN code's, then the shop's,
 * then the city setting `checkout.free_delivery_min_paise`. 0 = always free; null everywhere = never free.
 */
import { describe, expect, it } from 'vitest';
import { freeDeliveryMinPaise, groupShippingPaise } from '../src/free-delivery';

describe('free-delivery threshold chain', () => {
  it('takes the PIN override, then the shop override, then the city setting', () => {
    expect(freeDeliveryMinPaise({ pin: 50_000, shop: 20_000, city: 99_900 })).toBe(50_000);
    expect(freeDeliveryMinPaise({ pin: null, shop: 20_000, city: 99_900 })).toBe(20_000);
    expect(freeDeliveryMinPaise({ pin: undefined, shop: null, city: 99_900 })).toBe(99_900);
    expect(freeDeliveryMinPaise({ pin: null, shop: null, city: null })).toBeNull();
  });

  it('treats 0 as "always free", not as unset', () => {
    expect(freeDeliveryMinPaise({ pin: null, shop: 0, city: 99_900 })).toBe(0);
    expect(groupShippingPaise({ subtotalPaise: 1, shippingPaise: 4_000, freeMinPaise: 0 })).toBe(0);
  });

  it('charges the PIN delivery charge below the threshold and nothing from it up', () => {
    expect(groupShippingPaise({ subtotalPaise: 49_999, shippingPaise: 4_000, freeMinPaise: 50_000 })).toBe(
      4_000,
    );
    expect(groupShippingPaise({ subtotalPaise: 50_000, shippingPaise: 4_000, freeMinPaise: 50_000 })).toBe(0);
    expect(groupShippingPaise({ subtotalPaise: 9_99_999, shippingPaise: 4_000, freeMinPaise: null })).toBe(
      4_000,
    );
  });
});
