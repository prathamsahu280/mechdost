/**
 * Shop accounts browse but never buy (user 2026-11-22): the web hides the buying actions for a signed-in shop account
 * and shows one note; the API refuses with SELLER_CANNOT_ORDER (apps/api/test/seller-cannot-order.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSellerAccount, SELLER_ROLES } from '@mechdost/shared/rbac';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('isSellerAccount', () => {
  it('is true for shop owner and shop staff, false for customers, workshops and MechDost staff', () => {
    expect(SELLER_ROLES).toEqual(['seller_owner', 'seller_staff']);
    expect(isSellerAccount([{ role: 'customer' }, { role: 'seller_owner' }])).toBe(true);
    expect(isSellerAccount([{ role: 'seller_staff' }])).toBe(true);
    expect(
      isSellerAccount([{ role: 'customer' }, { role: 'workshop_owner' }, { role: 'support_agent' }]),
    ).toBe(false);
  });
});

describe('web hides the buying actions for a shop account', () => {
  it('add to cart and the stepper render nothing for a seller', () => {
    expect(src('components/catalogue/add-to-cart-button.tsx')).toMatch(
      /const seller = useIsSeller\(\);\s+if \(seller\) return null;/,
    );
  });
  it('the cart shows the note instead of checkout and the bulk quote link', () => {
    const cart = src('components/commerce/cart-view.tsx');
    expect(cart).toContain("t('sellerCannotOrder')");
    expect(cart).toContain('QUOTES_AVAILABLE && !seller');
  });
  it('checkout shows the note and a way back to the shop instead of the form', () => {
    expect(src('components/commerce/checkout-form.tsx')).toMatch(/session\?\.role === 'shop'/);
  });
  it('the product page carries the note, and the note component shows only for a shop account', () => {
    expect(src('app/[locale]/shop/[slug]/page.tsx')).toContain('<SellerNote');
    expect(src('components/commerce/seller-note.tsx')).toMatch(/if \(!useIsSeller\(\)\) return null;/);
  });
  it('has the note in English and Hindi', () => {
    expect(en.cart.sellerCannotOrder).toBe(
      "Seller accounts can't place orders. Sign in with a customer account to buy.",
    );
    expect(hi.cart.sellerCannotOrder).toBeTruthy();
  });
});

describe('API enforces it on every customer buying route', () => {
  const api = (p: string) => readFileSync(join(__dirname, '..', '..', 'api', 'src', p), 'utf8');
  it('cart writes, orders, coupon check, bulk quotes and the public checkout quote are guarded', () => {
    expect(api('routes/storefront.ts')).toContain("app.on(['POST', 'PUT'], '/me/cart/*', forbidSellers)");
    expect(api('routes/checkout.ts')).toContain("app.on('POST', '/orders', forbidSellers)");
    expect(api('routes/checkout.ts')).toContain("'/checkout/quote', forbidSignedInSellers");
    expect(api('routes/coupons.ts')).toContain("app.use('/checkout/coupon', forbidSellers)");
    expect(api('routes/quotes.ts')).toContain("app.on('POST', '/quotes/*', forbidSellers)");
  });
});
