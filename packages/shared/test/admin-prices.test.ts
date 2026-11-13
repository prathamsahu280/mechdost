import { describe, expect, it } from 'vitest';
import { checkAdminPrice, resolveCustomerPrice } from '../src/admin-prices';
import { ROLES } from '../src/rbac';

describe('admin price rules (design 2026-11-13: never above MRP, never below what a shop is paid)', () => {
  it('accepts a price between the lowest shop price and MRP, both ends included', () => {
    expect(checkAdminPrice({ pricePaise: 47_500, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBeNull();
    expect(checkAdminPrice({ pricePaise: 44_000, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBeNull();
  });

  it('refuses above MRP, below the lowest shop price, with no shop, and non-whole or non-positive prices', () => {
    expect(checkAdminPrice({ pricePaise: 47_501, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBe(
      'MRP_EXCEEDED',
    );
    expect(checkAdminPrice({ pricePaise: 43_999, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBe(
      'BELOW_SHOP_PRICE',
    );
    expect(checkAdminPrice({ pricePaise: 45_000, mrpPaise: 47_500, lowestShopPaise: null })).toBe('NO_SHOP');
    expect(checkAdminPrice({ pricePaise: 0, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBe('BAD_PRICE');
    expect(checkAdminPrice({ pricePaise: 45_000.5, mrpPaise: 47_500, lowestShopPaise: 44_000 })).toBe(
      'BAD_PRICE',
    );
  });

  it('resolves the customer price: PIN override, else city price, else the shop price (interim, Q83)', () => {
    expect(resolveCustomerPrice({ pinPaise: 46_000, cityPaise: 45_000, shopPaise: 44_000 })).toBe(46_000);
    expect(resolveCustomerPrice({ pinPaise: null, cityPaise: 45_000, shopPaise: 44_000 })).toBe(45_000);
    expect(resolveCustomerPrice({ pinPaise: null, cityPaise: null, shopPaise: 44_000 })).toBe(44_000);
    expect(resolveCustomerPrice({ pinPaise: null, cityPaise: null, shopPaise: null })).toBeNull();
  });

  it('prices:write belongs to super admins, operations managers and finance only', () => {
    const has = (role: keyof typeof ROLES) =>
      (ROLES[role].permissions as readonly string[]).includes('prices:write');
    expect(has('super_admin')).toBe(true);
    expect(has('ops_manager')).toBe(true);
    expect(has('finance')).toBe(true);
    expect(has('catalogue_manager')).toBe(false);
    expect(has('city_manager')).toBe(false);
    expect(has('marketing')).toBe(false);
  });
});
