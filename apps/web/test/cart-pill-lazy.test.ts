/**
 * JS budget (spec 16, incident 2026-11-15: /shop 180.4 and /cart 182.6 KB gz after the storefront merges). The cart
 * pill is in the header of every page, so the signed-in cart sync must not ride in its first load: the pill imports no
 * session store and no sync module; a component chosen at build time (`AUTH_MODE`) fetches `cart-sync-mount` with
 * `import()` after the page loads, and the demo build drops it whole. The cart-slug cookie (cart suggestions) is only
 * written when real data feeds the suggestions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('cart pill keeps the header light', () => {
  it('imports no session store or sync module statically', () => {
    const pill = src('components/commerce/cart-pill.tsx');
    expect(pill).not.toMatch(/from '@\/demo\/session-state'/);
    expect(pill).not.toMatch(/from '@\/lib\/(cart-sync|storefront-sync)'/);
    expect(pill).toMatch(/import\('\.\/cart-sync-mount'\)/);
    expect(pill).not.toMatch(/from 'next\/dynamic'/);
    expect(pill).toMatch(/AUTH_MODE === 'firebase' \?/);
  });

  it('the mount holds the signed-in sync effects', () => {
    const mount = src('components/commerce/cart-sync-mount.tsx');
    expect(mount).toMatch(/useSession/);
    expect(mount).toMatch(/import\('@\/lib\/cart-sync'\)/);
    expect(mount).toMatch(/import\('@\/lib\/storefront-sync'\)/);
  });

  it('writes the cart-slug cookie only when real data feeds the suggestions', () => {
    expect(src('demo/store.ts')).toMatch(/DATA_MODE === 'api' && key === KEYS\.cart/);
  });
});

describe('cart page suggestions stay client-free', () => {
  it('the cart page and its suggestions never import the full product card', () => {
    const cartPage = readFileSync(
      join(__dirname, '..', 'src', 'app', '[locale]', 'cart', 'page.tsx'),
      'utf8',
    );
    expect(cartPage).not.toMatch(/recommendations-section'/);
    expect(cartPage).toMatch(/recommendations-cart'/);
    const cart = src('components/catalogue/recommendations-cart.tsx');
    const core = src('components/catalogue/recommendations-core.tsx');
    for (const s of [cart, core]) expect(s).not.toMatch(/product-card'/);
  });
});
