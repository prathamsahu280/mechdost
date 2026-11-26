/**
 * Shopping personalisation phases 2 and 3 on the web (design 2026-11-25, founder approval 2026-11-26).
 * - The browser copy of "Recently viewed" survives blocked or broken storage and honours the off switch.
 * - Back to a product list: the saved place is per list URL, only restored on a Back/Forward visit.
 * - JS budget (spec 16): storefront pages import only the tiny lazy wrappers; the real list, the store and the
 *   tracker arrive in a chunk after the page is up. "Similar options" and "Goes well with" are Server Components.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isRecentOff,
  loadRecent,
  RECENT_KEY,
  RECENT_OFF_KEY,
  saveRecent,
  setRecentOff,
  type StorageLike,
} from '@/lib/recently-viewed-store';
import { listPlaceKey, readListPlace, saveListPlace } from '@/lib/list-place';
import { demoSimilar, similarKey } from '@/lib/catalogue/demo-similar';
import { impressionGroups } from '@/lib/reco-impressions';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}
const broken: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceeded');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('recently viewed in the browser', () => {
  it('saves and loads the list', () => {
    const s = memory();
    saveRecent(s, [{ slug: 'a', at: 2 }]);
    expect(loadRecent(s)).toEqual([{ slug: 'a', at: 2 }]);
    expect(s.data.has(RECENT_KEY)).toBe(true);
  });

  it('works with storage blocked: empty list, no throw', () => {
    expect(loadRecent(broken)).toEqual([]);
    expect(() => {
      saveRecent(broken, [{ slug: 'a', at: 1 }]);
    }).not.toThrow();
    expect(isRecentOff(broken)).toBe(false);
    expect(() => {
      setRecentOff(broken, true);
    }).not.toThrow();
    expect(loadRecent(null)).toEqual([]);
  });

  it('the off switch clears the list and keeps it off', () => {
    const s = memory();
    saveRecent(s, [{ slug: 'a', at: 2 }]);
    setRecentOff(s, true);
    expect(isRecentOff(s)).toBe(true);
    expect(s.data.get(RECENT_OFF_KEY)).toBe('1');
    expect(loadRecent(s)).toEqual([]);
    setRecentOff(s, false);
    expect(isRecentOff(s)).toBe(false);
  });
});

describe('suggestion impressions per algorithm', () => {
  it('a section with its own algorithm counts its distinct products once', () => {
    expect(
      impressionGroups('similar', [
        { slug: 'a', algo: undefined },
        { slug: 'a', algo: undefined },
        { slug: 'b', algo: undefined },
      ]),
    ).toEqual([{ algo: 'similar', count: 2 }]);
  });

  it('"Goes well with" (no section algorithm) counts each item under its own: rule, bought together, fitting', () => {
    expect(
      impressionGroups(undefined, [
        { slug: 'a', algo: 'rule' },
        { slug: 'b', algo: 'rule' },
        { slug: 'c', algo: 'copurchase' },
        { slug: '', algo: 'fitting' },
        { slug: 'x', algo: 'magic' },
      ]),
    ).toEqual([
      { algo: 'rule', count: 2 },
      { algo: 'copurchase', count: 1 },
      { algo: 'fitting', count: 1 },
    ]);
  });
});

describe('shared devices', () => {
  it('sign-out forgets the recently viewed list and the merge mark (the next person never gets or sends it)', () => {
    const out = src('lib/auth/sign-out.ts');
    expect(out).toContain(`'${RECENT_KEY}'`);
    expect(out).toContain(`'mechdost-recent-merged'`);
    expect(src('lib/recently-viewed-sync.ts')).toContain(`'mechdost-recent-merged'`);
  });
});

describe('Back keeps your place on product lists', () => {
  it('keys the place by the list address (path and query), not by the hash', () => {
    expect(listPlaceKey('/shop?category=tyres&pages=2#x')).toBe(listPlaceKey('/shop?category=tyres&pages=2'));
    expect(listPlaceKey('/shop?category=tyres')).not.toBe(listPlaceKey('/shop?category=batteries'));
  });

  it('saves the scroll position and gives it back once, only for that list', () => {
    const s = memory();
    saveListPlace(s, '/shop?q=oil', 1234);
    expect(readListPlace(s, '/shop?q=tyre')).toBeNull();
    expect(readListPlace(s, '/shop?q=oil')).toBe(1234);
    expect(readListPlace(s, '/shop?q=oil')).toBeNull();
    expect(readListPlace(broken, '/shop')).toBeNull();
  });
});

describe('Similar options in the demo store', () => {
  it('matches the same grade and pack, size or capacity, and nothing without one', () => {
    expect(similarKey('Engine oil for 2W · 20W40 · 900 ml')).toEqual({ key: '20W40|900ML', size: '900 ml' });
    expect(similarKey('Tubeless scooter tyre · 90/90-12 54J')?.key).toBe('909012');
    expect(similarKey('12 V · 45 Ah · maintenance free')?.key).toBe('45AH');
    expect(similarKey('Front brake pads, ceramic')).toBeNull();
  });

  it('suggests the other 20W40 900 ml oil for Castrol, never itself, with the shared size', () => {
    const items = demoSimilar('castrol-activ-4t-20w40-900ml', 'en');
    expect(items.map((i) => i.card.slug)).toEqual(['hp-racer4-20w40-900ml']);
    expect(items[0]?.size).toBe('900 ml');
    expect(demoSimilar('brake-pad-set-front', 'en')).toEqual([]);
  });
});

describe('JS budget: personal code stays out of the first load', () => {
  it('pages import only the lazy wrapper; the wrapper loads the list with import()', () => {
    const wrapper = src('components/personalisation/recently-viewed-lazy.tsx');
    expect(wrapper).toMatch(/lazy\(\(\) => import\('\.\/recently-viewed'\)\)/);
    expect(wrapper).not.toMatch(/from '@\/lib\/recently-viewed-store'/);
    expect(wrapper).not.toMatch(/from '@\/lib\/analytics'/);
    for (const page of [
      'app/[locale]/shop/[slug]/page.tsx',
      'app/[locale]/cart/page.tsx',
      'app/[locale]/page.tsx',
      'app/[locale]/shop/page.tsx',
    ]) {
      const s = src(page);
      expect([page, s.includes("recently-viewed-lazy'")]).toEqual([page, true]);
      expect([page, s.includes("personalisation/recently-viewed'")]).toEqual([page, false]);
    }
  });

  it('the store and the list never pull Zod or the shared API schemas into the browser', () => {
    for (const f of ['lib/recently-viewed-store.ts', 'components/personalisation/recently-viewed.tsx'])
      expect([f, /from 'zod'|recently-viewed-api'/.test(src(f))]).toEqual([f, false]);
  });

  it('suggestion sections are Server Components and mark their surface and algorithm for the tracker', () => {
    const similar = src('components/catalogue/similar-section.tsx');
    expect(similar).not.toMatch(/'use client'/);
    expect(similar).toMatch(/data-reco-surface/);
    expect(similar).toMatch(/data-reco-algo/);
    const core = src('components/catalogue/recommendations-core.tsx');
    expect(core).toMatch(/data-reco-surface/);
  });

  it('the shop list restores its place through a module loaded on Back only', () => {
    const shop = src('components/catalogue/shop-browser.tsx');
    expect(shop).toMatch(/import\('@\/lib\/list-place-runtime'\)/);
  });
});
