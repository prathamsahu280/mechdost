import { describe, expect, it } from 'vitest';
import { isActive } from '../src/lib/nav';
import { canonicalPath, stripLocale, switchLocalePath } from '../src/lib/locale-path';

describe('locale paths', () => {
  it.each([
    ['/', '/'],
    ['/shop', '/shop'],
    ['/hi', '/'],
    ['/hi/shop', '/shop'],
    ['/hiking', '/hiking'],
  ])('strips the locale from %s', (input, expected) => {
    expect(stripLocale(input)).toBe(expected);
  });

  it.each([
    ['/', 'hi', '/hi'],
    ['/workshops', 'hi', '/hi/workshops'],
    ['/hi/workshops', 'en', '/en/workshops'],
    ['/hi', 'en', '/en'],
    ['/hi/account/vehicles', 'hi', '/hi/account/vehicles'],
  ] as const)('switches %s to %s → %s', (path, target, expected) => {
    expect(switchLocalePath(path, target)).toBe(expected);
  });
});

describe('canonical paths (static pre-render uses an internal /en segment)', () => {
  it.each([
    ['/en', '/'],
    ['/en/workshops/x', '/workshops/x'],
    ['/hi/shop', '/hi/shop'],
    ['/engine', '/engine'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalPath(input)).toBe(expected);
  });

  it('never builds /hi/en/… when switching from a pre-rendered English page', () => {
    expect(switchLocalePath('/en/workshops/x', 'hi')).toBe('/hi/workshops/x');
  });
});

describe('active nav item', () => {
  it('matches home exactly and sections by prefix', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/shop', '/')).toBe(false);
    expect(isActive('/hi/shop', '/hi/shop')).toBe(true);
    expect(isActive('/hi/account/vehicles', '/hi/account/vehicles')).toBe(true);
    expect(isActive('/shopping', '/shop')).toBe(false);
    // Localised home must not match every Hindi page (regression: two nav items highlighted).
    expect(isActive('/hi/shop', '/hi', true)).toBe(false);
    expect(isActive('/hi', '/hi', true)).toBe(true);
  });
});
