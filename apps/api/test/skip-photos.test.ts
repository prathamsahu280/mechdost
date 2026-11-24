/**
 * `--skip-photos-for` of the battery importers (user ruling 2026-11-24: photos are never edited to remove watermarks;
 * a flagged photo is left out and its product imports without it, keeping its status).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BatteryPlan, PlannedProduct, ReportRow } from '@mechdost/db/battery-import';
import { addSkipFiles, isSkippedPhoto, withoutSkippedPhotos } from '../src/cli/skip-photos';

const photo = (file: string) => ({ file, sourceUrl: '', alt: 'a', altHi: 'अ' });
const product = (slug: string, files: string[], status: 'live' | 'draft' = 'live') =>
  ({
    slug,
    status,
    photos: files.map(photo),
    photo: files[0] ? photo(files[0]) : null,
  }) as unknown as PlannedProduct;
const row = (slug: string, photoFile: string) => ({ slug, photoFile }) as unknown as ReportRow;
const plan = {
  products: [
    product('a', ['pictures/PREMIO/Tata Green PREMIO 36B19L-AM.jpg']),
    product('b', ['pictures/UPS/Tata Green TGUPS1700.jpg', 'pictures/UPS/Tata Green TGUPS1700 - 2.jpg']),
    product('c', ['pictures/Other/c.jpg']),
  ],
  rows: [
    row('a', 'pictures/PREMIO/Tata Green PREMIO 36B19L-AM.jpg'),
    row('b', 'pictures/UPS/Tata Green TGUPS1700.jpg'),
    row('c', 'pictures/Other/c.jpg'),
  ],
} as unknown as BatteryPlan;

describe('--skip-photos-for', () => {
  it('reads comma separated names and a list file (names may hold commas, # comments)', () => {
    const set = new Set<string>();
    addSkipFiles(set, 'one.jpg, Two.JPG');
    const list = join(mkdtempSync(join(tmpdir(), 'skip-')), 'list.txt');
    writeFileSync(list, '# watermarked\nTata Green, odd name.jpg\n\n');
    addSkipFiles(set, `@${list}`);
    expect([...set].sort()).toEqual(['one.jpg', 'tata green, odd name.jpg', 'two.jpg']);
  });

  it('matches the full path, the file name, or the name without its extension, any case or slash style', () => {
    const skip = new Set(['pictures/ups/tata green tgups1700.jpg', 'tata green premio 36b19l-am', 'c.jpg']);
    expect(isSkippedPhoto(skip, 'pictures\\UPS\\Tata Green TGUPS1700.jpg')).toBe(true);
    expect(isSkippedPhoto(skip, 'pictures/PREMIO/Tata Green PREMIO 36B19L-AM.jpg')).toBe(true);
    expect(isSkippedPhoto(skip, 'pictures/Other/C.JPG')).toBe(true);
    expect(isSkippedPhoto(skip, 'pictures/UPS/Tata Green TGUPS1700 - 2.jpg')).toBe(false);
  });

  it('takes the photo out of the plan and keeps the product, its status and its other photos', () => {
    const out = withoutSkippedPhotos(
      plan,
      new Set(['tata green premio 36b19l-am.jpg', 'tata green tgups1700.jpg']),
    );
    const [a, b, c] = out.products;
    expect(a?.photos).toEqual([]);
    expect(a?.photo).toBeNull();
    expect(a?.status).toBe('live');
    expect(b?.photos.map((p) => p.file)).toEqual(['pictures/UPS/Tata Green TGUPS1700 - 2.jpg']);
    expect(b?.photo?.file).toBe('pictures/UPS/Tata Green TGUPS1700 - 2.jpg');
    expect(c?.photos).toHaveLength(1);
    expect(out.rows.map((r) => r.photoFile)).toEqual(['', '', 'pictures/Other/c.jpg']);
    // The input plan is not changed.
    expect(plan.products[0]?.photos).toHaveLength(1);
  });

  it('an empty list returns the same plan', () => {
    expect(withoutSkippedPhotos(plan, new Set())).toBe(plan);
  });
});
