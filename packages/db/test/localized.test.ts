/**
 * Localised content columns (hard rule 10, decision 2026-11-02): English + Hindi side by side, missing Hindi is
 * flagged for admin, highlights stay aligned line by line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { localized, missingHindi, type Tx } from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [brand] = await db
    .insert(s.brands)
    .values({ slug: 'exide', name: 'Exide', origin: 'oes' })
    .returning();
  const [cat] = await db
    .insert(s.categories)
    .values({ slug: 'batteries', name: 'Batteries', nameHi: 'बैटरी' })
    .returning();
  F.brand = brand!.id;
  F.category = cat!.id;
});

afterAll(async () => {
  await client.close();
});

const product = (slug: string, over: Partial<typeof s.products.$inferInsert> = {}) => ({
  slug,
  name: 'XLTZ4A two-wheeler battery',
  brandId: F.brand!,
  categoryId: F.category!,
  hsn: '8507',
  gstRateBp: 1800,
  status: 'live',
  ...over,
});

describe('localised content columns', () => {
  it('flags English-only fields and stays quiet once Hindi is filled in', async () => {
    await db.insert(s.products).values(
      product('exide-xltz4a', {
        specSummary: '12 V · 3 Ah · VRLA',
        highlights: ['Maintenance-free', '24-month warranty'],
      }),
    );
    const [flagged] = await missingHindi(t());
    expect(flagged).toMatchObject({ kind: 'product', slug: 'exide-xltz4a' });
    expect(flagged?.fields).toEqual(['name', 'specSummary', 'highlights']);

    await db
      .update(s.products)
      .set({
        nameHi: 'XLTZ4A दोपहिया बैटरी',
        specSummaryHi: '12 V · 3 Ah · VRLA',
        highlightsHi: ['बिना रखरखाव', '24 महीने की वारंटी'],
      })
      .where(eq(s.products.slug, 'exide-xltz4a'));
    expect(await missingHindi(t())).toEqual([]);
  });

  it('keeps Hindi highlights aligned with English (empty or the same count) and caps them at 8', async () => {
    await expect(
      db.insert(s.products).values(product('bad-align', { highlights: ['a', 'b'], highlightsHi: ['क'] })),
    ).rejects.toThrow();
    await expect(
      db
        .insert(s.products)
        .values(product('too-many', { highlights: Array.from({ length: 9 }, (_, i) => `h${String(i)}`) })),
    ).rejects.toThrow();
  });

  it('falls back to English when the Hindi text is missing', () => {
    expect(localized('Batteries', 'बैटरी', 'hi')).toBe('बैटरी');
    expect(localized('Batteries', null, 'hi')).toBe('Batteries');
    expect(localized('Batteries', '  ', 'hi')).toBe('Batteries');
    expect(localized('Batteries', 'बैटरी', 'en')).toBe('Batteries');
  });
});
