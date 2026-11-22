import { describe, expect, it } from 'vitest';
import type { CardView } from '../src/lib/catalogue/view';
import { pickHomeRange } from '../src/lib/catalogue/home-range';

const card = (slug: string, brand: string, photo: boolean): CardView =>
  ({
    slug,
    brand,
    photo: photo ? { path: slug, alt: slug, width: 400, height: 400, lqip: null } : null,
  }) as unknown as CardView;

describe('pickHomeRange ("Browse our product range" in API mode)', () => {
  it('shows only products with a photo, one per brand first, newest first', () => {
    const items = [
      card('a1', 'Kelvinn', true),
      card('a2', 'Kelvinn', true),
      card('n1', 'Gulf', false),
      card('b1', 'Gulf', true),
      card('c1', 'Exide', true),
      card('a3', 'Kelvinn', true),
      card('d1', 'Castrol', true),
    ];
    expect(pickHomeRange(items, 4).map((c) => c.slug)).toEqual(['a1', 'b1', 'c1', 'd1']);
  });

  it('fills up with more of the same brand when there are fewer brands than places', () => {
    const items = [card('a1', 'Kelvinn', true), card('a2', 'Kelvinn', true), card('b1', 'Gulf', true)];
    expect(pickHomeRange(items, 4).map((c) => c.slug)).toEqual(['a1', 'b1', 'a2']);
  });

  it('is empty when no product has a photo', () => {
    expect(pickHomeRange([card('x', 'Gulf', false)], 4)).toEqual([]);
  });
});
