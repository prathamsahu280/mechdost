import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOME_LAYOUT,
  HOME_SECTIONS,
  cleanHomeLayout,
  readHomeLayout,
  visibleSections,
} from '../src/site-layout';

describe('home audience band section (design 2026-11-22)', () => {
  it('is the first section by default, right after the hero', () => {
    expect(HOME_SECTIONS[0]).toBe('audiences');
    expect(DEFAULT_HOME_LAYOUT.order[0]).toBe('audiences');
    expect(visibleSections(DEFAULT_HOME_LAYOUT)[0]).toBe('audiences');
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

  it('a layout saved before the band existed still reads, with the band added last', () => {
    const old = { ...DEFAULT_HOME_LAYOUT, order: HOME_SECTIONS.filter((s) => s !== 'audiences') };
    const layout = readHomeLayout(old);
    expect(layout.order).toContain('audiences');
    expect(new Set(layout.order).size).toBe(HOME_SECTIONS.length);
  });
});
