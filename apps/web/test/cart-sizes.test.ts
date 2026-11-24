import { describe, expect, it } from 'vitest';
import { addToCart, removeFromCart, setQuantity, upgradeLegacyLines } from '../src/demo/store';

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

const stored = (data: Map<string, string>) => JSON.parse(data.get('mechdost-cart') ?? '[]') as unknown[];

describe('cart lines are keyed by size (user 2026-11-24)', () => {
  it('two sizes of one product are two lines; the same size adds up', () => {
    const data = fakeWindow();
    expect(addToCart('milaze-x3', 1, 'T-14')).toBe('added');
    expect(addToCart('milaze-x3', 2, 'T-15')).toBe('added');
    expect(addToCart('milaze-x3', 1, 'T-14')).toBe('added');
    expect(stored(data)).toEqual([
      { slug: 'milaze-x3', qty: 2, sku: 'T-14' },
      { slug: 'milaze-x3', qty: 2, sku: 'T-15' },
    ]);
  });

  it('setQuantity and removeFromCart act on one size only', () => {
    const data = fakeWindow();
    addToCart('milaze-x3', 1, 'T-14');
    addToCart('milaze-x3', 1, 'T-15');
    setQuantity('T-15', 5);
    removeFromCart('T-14');
    expect(stored(data)).toEqual([{ slug: 'milaze-x3', qty: 5, sku: 'T-15' }]);
  });

  it('an old line saved by slug only becomes the first size when it is added to or upgraded', () => {
    const data = fakeWindow();
    data.set('mechdost-cart', JSON.stringify([{ slug: 'milaze-x3', qty: 2 }]));
    // Adding the default size merges into the old line instead of making a second one.
    expect(addToCart('milaze-x3', 1, 'T-15', 'T-15')).toBe('added');
    expect(stored(data)).toEqual([{ slug: 'milaze-x3', qty: 3, sku: 'T-15' }]);
    // Adding another size keeps the old line (now with the default size) and adds a second line.
    data.set('mechdost-cart', JSON.stringify([{ slug: 'milaze-x3', qty: 2 }]));
    expect(addToCart('milaze-x3', 1, 'T-14', 'T-15')).toBe('added');
    expect(stored(data)).toEqual([
      { slug: 'milaze-x3', qty: 2, sku: 'T-15' },
      { slug: 'milaze-x3', qty: 1, sku: 'T-14' },
    ]);
  });

  it('upgradeLegacyLines gives every slug-only line its product first size and leaves the rest', () => {
    const lines = [
      { slug: 'a', qty: 1 },
      { slug: 'b', qty: 2, sku: 'B-1' },
      { slug: 'gone', qty: 1 },
    ];
    expect(upgradeLegacyLines(lines, (slug) => (slug === 'a' ? 'A-1' : undefined))).toEqual([
      { slug: 'a', qty: 1, sku: 'A-1' },
      { slug: 'b', qty: 2, sku: 'B-1' },
      { slug: 'gone', qty: 1 },
    ]);
  });
});
