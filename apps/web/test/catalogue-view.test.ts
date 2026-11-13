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

  it('demoCard maps price, MRP, vehicle types and rating', () => {
    if (!castrol) throw new Error('fixture missing');
    const card = demoCard(castrol, 'en');
    expect(card.price).toEqual({ pricePaise: 44_000, mrpPaise: 47_500 });
    expect(card.vehicleTypes).toEqual(['2W']);
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

  it('carries the pack size and typed attributes for comparison (design 2026-11-13)', () => {
    if (!castrol) throw new Error('fixture missing');
    expect(demoCard(castrol, 'en').pack).toEqual({ qty: 900, unit: 'ml' });
    const p = demoProduct(castrol, 'en');
    expect(p.attributeSet).toBe('lubricants');
    expect(p.attributes).toMatchObject({ saeGrade: '20W40', apiClass: 'SL', jasoClass: 'MA2' });
    const tyre = findProduct('car-tyre-185-65-r15');
    if (!tyre) throw new Error('fixture missing');
    expect(demoProduct(tyre, 'en').attributes).toEqual({
      size: '185/65 R15',
      loadIndex: 88,
      speedSymbol: 'H',
      tubeless: true,
    });
  });

  it('has three more two-wheeler engine oils to compare', () => {
    for (const slug of ['motul-3100-4t-10w30-1l', 'shell-advance-ax7-10w30-1l', 'hp-racer4-20w40-900ml']) {
      const p = findProduct(slug);
      expect(p?.category).toBe('lubricants');
      expect(p?.fits).toBe('2W');
      expect(PRODUCT_HI[slug]).toBeDefined();
    }
    const hp = findProduct('hp-racer4-20w40-900ml');
    expect(hp && demoCard(hp, 'en').pack).toEqual({ qty: 900, unit: 'ml' });
  });

  it('DATA_MODE is demo unless the env says api', async () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'API');
    expect((await import('../src/lib/data-mode')).DATA_MODE).toBe('demo');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', 'api');
    expect((await import('../src/lib/data-mode')).DATA_MODE).toBe('api');
  });
});
