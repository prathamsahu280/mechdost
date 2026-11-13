import { describe, expect, it } from 'vitest';
import { DEMO_SHOPS, rankShops } from '../src/demo/shops';

/** Routing suggestions (QA 2026-11-14, U13): shops stocking more of the order's categories come first. */
describe('rankShops', () => {
  it('puts shops that stock none of the categories after the ones that do', () => {
    for (const category of [...new Set(DEMO_SHOPS.flatMap((s) => s.categories))]) {
      const ranked = rankShops([category]);
      const firstWithout = ranked.findIndex((s) => !s.categories.includes(category));
      if (firstWithout === -1) continue;
      for (const shop of ranked.slice(firstWithout)) expect(shop.categories).not.toContain(category);
    }
  });

  it('ranks the best coverage first when an order spans categories', () => {
    const [a, b] = [...new Set(DEMO_SHOPS.flatMap((s) => s.categories))];
    if (!a || !b) return;
    const ranked = rankShops([a, b]);
    const cover = (s: (typeof ranked)[number]) => [a, b].filter((c) => s.categories.includes(c)).length;
    for (let i = 1; i < ranked.length; i++)
      expect(cover(ranked[i - 1]!)).toBeGreaterThanOrEqual(cover(ranked[i]!));
  });
});
