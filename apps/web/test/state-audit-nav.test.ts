import { describe, expect, it } from 'vitest';
import { currentHref, navFindings, type NavFacts } from '../e2e/state-audit/nav.ts';

describe('currentHref (which nav item must carry aria-current)', () => {
  const primary = ['/', '/shop', '/workshops', '/account/vehicles'];
  it('matches home exactly and the others by prefix, in both locales', () => {
    expect(currentHref('/', primary)).toBe('/');
    expect(currentHref('/hi', primary)).toBe('/');
    expect(currentHref('/shop', primary)).toBe('/shop');
    expect(currentHref('/hi/shop/castrol', primary)).toBe('/shop');
    expect(currentHref('/cart', primary)).toBeNull();
    expect(currentHref('/account', primary)).toBeNull();
  });
  it('prefers the longest match', () => {
    expect(currentHref('/admin/orders', ['/admin', '/admin/orders'])).toBe('/admin/orders');
    expect(currentHref('/admin', ['/admin', '/admin/orders'])).toBe('/admin');
  });
});

const facts = (over: Partial<NavFacts> = {}): NavFacts => ({
  items: [
    { href: '/', text: 'Home', current: true, w: 80, h: 44, visible: true },
    { href: '/shop', text: 'Shop', current: false, w: 80, h: 44, visible: true },
  ],
  overflowing: false,
  scrollable: false,
  ...over,
});

describe('navFindings', () => {
  it('passes a healthy bar', () => {
    expect(navFindings(facts(), '/')).toEqual([]);
  });
  it('flags a missing or doubled current marker', () => {
    expect(
      navFindings(facts({ items: facts().items.map((i) => ({ ...i, current: false })) }), '/'),
    ).toHaveLength(1);
    expect(
      navFindings(facts({ items: facts().items.map((i) => ({ ...i, current: true })) }), '/'),
    ).toHaveLength(1);
  });
  it('expects no marker on a route that is not a nav target', () => {
    expect(
      navFindings(facts({ items: facts().items.map((i) => ({ ...i, current: false })) }), '/cart'),
    ).toEqual([]);
  });
  it('flags a small target, an overflow nobody can scroll, and a current item out of sight', () => {
    const small = facts({ items: [{ href: '/', text: 'Home', current: true, w: 20, h: 20, visible: true }] });
    expect(navFindings(small, '/').map((f) => f.rule)).toEqual(['nav-target']);
    expect(navFindings(facts({ overflowing: true, scrollable: false }), '/').map((f) => f.rule)).toEqual([
      'nav-overflow',
    ]);
    const hidden = facts({
      overflowing: true,
      scrollable: true,
      items: facts().items.map((i) => (i.current ? { ...i, visible: false } : i)),
    });
    expect(navFindings(hidden, '/').map((f) => f.rule)).toEqual(['nav-current-hidden']);
  });
});
