import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS, DEMO_PRODUCTS } from '../src/demo/catalogue';
import { DEMO_WORKSHOPS } from '../src/demo/workshops';
import { CATEGORY_PHOTOS, PHOTO_CREDITS, PRODUCT_PHOTO_SLUGS, WORKSHOP_PHOTO_SLUGS } from '../src/lib/media';

const PUBLIC = join(import.meta.dirname, '..', 'public');
const onDisk = (path: string) => existsSync(join(PUBLIC, path));

/** Every photo shipped in public/images must be credited (CC BY / BY-SA licence condition) and vice versa. */
describe('photo library', () => {
  it('credits every photo file and every credit points at a real file', () => {
    const files = ['products', 'workshops', 'site'].flatMap((dir) =>
      readdirSync(join(PUBLIC, 'images', dir)).map((f) => `/images/${dir}/${f}`),
    );
    const credited = PHOTO_CREDITS.map((c) => c.path);
    expect(new Set(credited).size).toBe(credited.length);
    expect(credited.toSorted()).toEqual(files.toSorted());
    expect(readdirSync(join(PUBLIC, 'images')).toSorted()).toEqual(['products', 'site', 'workshops']);
  });

  it('records author, an open licence and a Commons source for each photo', () => {
    for (const c of PHOTO_CREDITS) {
      expect(c.author.length, c.path).toBeGreaterThan(0);
      expect(c.author, c.path).not.toMatch(/@/); // no e-mail addresses copied from file pages
      expect(c.license, c.path).toMatch(/^(CC0|Public domain|CC BY(-SA)? \d\.\d)$/i);
      expect(c.source, c.path).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  it('has a photo for every demo product, workshop and category', () => {
    expect(DEMO_PRODUCTS.map((p) => p.slug).toSorted()).toEqual([...PRODUCT_PHOTO_SLUGS].toSorted());
    expect(DEMO_WORKSHOPS.map((w) => w.slug).toSorted()).toEqual([...WORKSHOP_PHOTO_SLUGS].toSorted());
    for (const key of CATEGORY_KEYS) expect(onDisk(CATEGORY_PHOTOS[key]), key).toBe(true);
  });
});
