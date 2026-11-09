import { afterEach, describe, expect, it, vi } from 'vitest';
import { findProduct } from '../src/demo/catalogue';
import { PRODUCT_HI } from '../src/demo/i18n/hi';
import { productRating } from '../src/demo/reviews';
import { demoCard, demoProduct } from '../src/lib/catalogue/demo-source';

const castrol = findProduct('castrol-activ-4t-20w40-900ml');

describe('catalogue view model, demo source (plan 2026-11-10 task 2)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('demoCard maps price, MRP, fit and rating', () => {
    if (!castrol) throw new Error('fixture missing');
    const card = demoCard(castrol, 'en');
    expect(card.price).toEqual({ pricePaise: 44_000, mrpPaise: 47_500 });
    expect(card.fit).toBe('2W');
    expect(card.category).toEqual({ key: 'lubricants', slug: 'lubricants', name: null });
    expect(card.rating).toEqual({ avg: productRating(castrol).rating, count: productRating(castrol).count });
    expect(card.availability).toBe('in_stock');
  });

  it('demoCard in Hindi uses PRODUCT_HI', () => {
    if (!castrol) throw new Error('fixture missing');
    const hi = PRODUCT_HI[castrol.slug];
    expect(hi).toBeDefined();
    expect(demoCard(castrol, 'hi').name).toBe(hi?.name ?? castrol.name);
    expect(demoProduct(castrol, 'hi').compatibility).toBe(hi?.compatibility ?? '');
  });

  it('DATA_MODE is demo unless the env says api', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'API');
    expect((await import('../src/lib/data-mode')).DATA_MODE).toBe('demo');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'api');
    expect((await import('../src/lib/data-mode')).DATA_MODE).toBe('api');
  });
});
