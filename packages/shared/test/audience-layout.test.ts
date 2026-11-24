import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_LAYOUT,
  HOME_SECTIONS,
  cleanHomeLayout,
  completeOrder,
  readHomeLayout,
  visibleSections,
} from '../src/site-layout';

describe('home audience band section (design 2026-11-22)', () => {
  it('is right after the hero by default (the roadside band comes before it, spec 22)', () => {
    expect(HOME_SECTIONS[1]).toBe('audiences');
    expect(DEFAULT_HOME_LAYOUT.order[1]).toBe('audiences');
    expect(visibleSections(DEFAULT_HOME_LAYOUT)[1]).toBe('audiences');
  });

  it('can be hidden and reordered like the other sections', () => {
    const order = [...HOME_SECTIONS].filter((s) => s !== 'audiences');
    const r = cleanHomeLayout({
      ...DEFAULT_HOME_LAYOUT,
      order: [...order, 'audiences'],
      hidden: ['audiences'],
    });
    expect(r.ok && r.layout.order.at(-1)).toBe('audiences');
    expect(r.ok && visibleSections(r.layout)).not.toContain('audiences');
  });

  it('a layout saved before the band existed still reads, with the band at its default place', () => {
    const old = { ...DEFAULT_HOME_LAYOUT, order: HOME_SECTIONS.filter((s) => s !== 'audiences') };
    const layout = readHomeLayout(old);
    expect(layout.order).toContain('audiences');
    expect(new Set(layout.order).size).toBe(HOME_SECTIONS.length);
  });
});

describe('home roadside section (spec 22, user 2026-11-24)', () => {
  it('is the first section by default and can be hidden or moved', () => {
    expect(HOME_SECTIONS[0]).toBe('roadside');
    const moved = cleanHomeLayout({
      ...DEFAULT_HOME_LAYOUT,
      order: [...HOME_SECTIONS.filter((s) => s !== 'roadside'), 'roadside'],
      hidden: ['roadside'],
    });
    expect(moved.ok && moved.layout.order.at(-1)).toBe('roadside');
    expect(moved.ok && visibleSections(moved.layout)).not.toContain('roadside');
  });

  it('a layout saved before roadside existed gets it first, not at the end', () => {
    const old = HOME_SECTIONS.filter((s) => s !== 'roadside');
    expect(readHomeLayout({ ...DEFAULT_HOME_LAYOUT, order: old }).order[0]).toBe('roadside');
    expect(completeOrder(['faq', 'trust', 'audiences'])[0]).toBe('roadside');
  });

  it('a missing section goes after the one that precedes it by default', () => {
    // A custom order without "products": it returns right after "categories" (its default predecessor).
    const out = completeOrder([
      'roadside',
      'trust',
      'categories',
      'route',
      'service',
      'workshops',
      'faq',
      'partners',
      'audiences',
    ]);
    expect(out.indexOf('products')).toBe(out.indexOf('categories') + 1);
    expect(new Set(out).size).toBe(HOME_SECTIONS.length);
  });
});
