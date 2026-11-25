/**
 * Smart search (spec 02, design 2026-11-22): query understanding in SQL, synonyms from the table, typo tolerance,
 * suggestions, "did you mean", and the admin synonym editor (audited, optimistic version).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import {
  addSearchSynonym,
  catalogueHasMatch,
  didYouMeanCatalogue,
  invalidateSearchVocab,
  listCatalogue,
  listSearchSynonyms,
  setSearchSynonymActive,
  suggestCatalogue,
  type Tx,
} from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};

async function product(
  slug: string,
  brand: string,
  category: string,
  extra: Partial<typeof s.products.$inferInsert>,
  net?: { qty: number; unit: 'ml' | 'g' },
) {
  const [p] = await db
    .insert(s.products)
    .values({
      slug,
      name: slug,
      brandId: F[brand]!,
      categoryId: F[category]!,
      hsn: '2710',
      gstRateBp: 1800,
      status: 'live',
      ...extra,
    })
    .returning();
  await db.insert(s.productVariants).values({
    productId: p!.id,
    sku: `SKU-${slug.toUpperCase()}`,
    mrpPaise: 50000,
    ...(net ? { netQty: net.qty, netUnit: net.unit } : {}),
  });
}

const slugs = async (q: string) =>
  (await listCatalogue(t(), { cityCode: 'RPR', q, locale: 'en' })).items.map((i) => i.slug);

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  await db.insert(s.cities).values({
    stateId: state!.id,
    code: 'RPR',
    slug: 'raipur',
    name: 'Raipur',
    status: 'live',
    centroid: { lng: 81.64, lat: 21.227 },
  });
  F.staff = (await db.insert(s.users).values({ firebaseUid: 'fb-search-staff' }).returning())[0]!.id;
  for (const [key, slug, name, nameHi] of [
    ['lubricants', 'lubricants', 'Lubricants', 'लुब्रिकेंट'],
    ['batteries', 'batteries', 'Batteries', 'बैटरी'],
    ['tyres', 'tyres', 'Tyres', 'टायर'],
  ] as const) {
    F[key] = (await db.insert(s.categories).values({ slug, name, nameHi }).returning())[0]!.id;
  }
  for (const [key, name] of [
    ['castrol', 'Castrol'],
    ['mobil', 'Mobil'],
    ['exide', 'Exide'],
  ] as const) {
    F[key] = (await db.insert(s.brands).values({ slug: key, name }).returning())[0]!.id;
  }

  await product(
    'castrol-activ-4t',
    'castrol',
    'lubricants',
    {
      name: 'Castrol Activ 4T 20W40',
      specSummary: 'Engine oil for 2W · 20W40 · 900 ml',
      vehicleTypes: ['2W'],
    },
    { qty: 900, unit: 'ml' },
  );
  await product(
    'castrol-magnatec',
    'castrol',
    'lubricants',
    { name: 'Castrol Magnatec 5W-30', specSummary: 'Engine oil for cars · 3.5 L', vehicleTypes: ['4W'] },
    { qty: 3500, unit: 'ml' },
  );
  await product(
    'mobil-super',
    'mobil',
    'lubricants',
    { name: 'Mobil Super Moto 20W 50', specSummary: 'Engine oil for 2W · 1 L', vehicleTypes: ['2W'] },
    { qty: 1000, unit: 'ml' },
  );
  await product('exide-35', 'exide', 'batteries', {
    name: 'Exide Mileage 35 Ah car battery',
    nameHi: 'Exide माइलेज 35 Ah कार बैटरी',
    specSummary: '12 V · 35 Ah',
    vehicleTypes: ['4W'],
  });
  await product('exide-xl4a', 'exide', 'batteries', {
    name: 'Exide Xplore XLTZ4A',
    specSummary: '12 V · 3 Ah',
    vehicleTypes: ['2W'],
  });
  await product('mrf-tyre', 'castrol', 'tyres', { name: 'MRF Zapper 90/90-12 tyre', vehicleTypes: ['2W'] });
  await product('draft-oil', 'castrol', 'lubricants', { name: 'Castrol Draft 20W40', status: 'draft' });
});

beforeEach(() => {
  invalidateSearchVocab();
});

afterAll(async () => {
  await client.close();
});

describe('query understanding in the listing', () => {
  it('"20w40 bike oil" puts the 2W 20W-40 oil first, drafts never', async () => {
    const r = await slugs('20w40 bike oil');
    expect(r[0]).toBe('castrol-activ-4t');
    expect(r).not.toContain('draft-oil');
  });
  it('every spelling of the viscosity finds the same oil', async () => {
    for (const q of ['20w40', '20 w 40', '20W-40', '20w-40'])
      expect(await slugs(q)).toContain('castrol-activ-4t');
  });
  it('"castrol 900ml" ranks the 900 ml pack above the 3.5 L one', async () => {
    const r = await slugs('castrol 900ml');
    expect(r.indexOf('castrol-activ-4t')).toBeLessThan(r.indexOf('castrol-magnatec'));
  });
  it('"0.9 l" and "900 ml" are the same pack', async () => {
    expect(await slugs('0.9 l')).toEqual(await slugs('900ml'));
    expect(await slugs('900ml')).toEqual(['castrol-activ-4t']);
  });
  it('"exide 35ah" puts the 35 Ah battery first', async () => {
    expect((await slugs('exide 35ah'))[0]).toBe('exide-35');
  });
  it('tyre sizes match however they are spaced', async () => {
    expect(await slugs('90/90-12')).toEqual(['mrf-tyre']);
  });
  it('Hinglish and Hindi words find the product: baitri, बैटरी, tel', async () => {
    expect(await slugs('baitri')).toEqual(expect.arrayContaining(['exide-35', 'exide-xl4a']));
    expect(await slugs('बैटरी')).toContain('exide-35');
    expect(await slugs('tel')).toContain('castrol-activ-4t');
  });
  it('a typo still finds the brand: castrl', async () => {
    expect(await slugs('castrl')).toContain('castrol-activ-4t');
  });
  it('bike intent boosts 2W, car intent boosts 4W', async () => {
    expect((await slugs('bike battery'))[0]).toBe('exide-xl4a');
    expect((await slugs('car battery'))[0]).toBe('exide-35');
  });
  it('the part number or SKU is exact', async () => {
    expect(await slugs('sku-exide-35')).toEqual(['exide-35']);
  });
  it('nonsense finds nothing; the admin analytics helper agrees', async () => {
    expect(await slugs('qwzxv')).toEqual([]);
    expect(await catalogueHasMatch(t(), 'qwzxv')).toBe(false);
    expect(await catalogueHasMatch(t(), '20w40')).toBe(true);
  });
});

describe('suggestions and did you mean', () => {
  it('brands, categories and products, at most 8, no drafts', async () => {
    const items = await suggestCatalogue(t(), { q: 'cast', locale: 'en', cityCode: 'RPR' });
    expect(items.length).toBeLessThanOrEqual(8);
    expect(items[0]).toMatchObject({ kind: 'brand', slug: 'castrol' });
    expect(items.map((i) => i.slug)).not.toContain('draft-oil');
  });
  it('categories follow the locale', async () => {
    const items = await suggestCatalogue(t(), { q: 'battery', locale: 'hi', cityCode: 'RPR' });
    expect(items.find((i) => i.kind === 'category')?.label).toBe('बैटरी');
  });
  it('under two characters nothing is suggested', async () => {
    expect(await suggestCatalogue(t(), { q: 'c', locale: 'en', cityCode: 'RPR' })).toEqual([]);
  });
  it('wildcards in the text do not match everything', async () => {
    const items = await suggestCatalogue(t(), { q: '%%', locale: 'en', cityCode: 'RPR' });
    expect(items.filter((i) => i.kind === 'brand')).toEqual([]);
  });
  it('did you mean: the closest live brand or product, none for gibberish', async () => {
    expect(await didYouMeanCatalogue(t(), 'castroll')).toBe('Castrol');
    expect(await didYouMeanCatalogue(t(), 'qwzxv')).toBeNull();
  });
  it('the range seam is called when given and its items come after the brands', async () => {
    const items = await suggestCatalogue(t(), {
      q: 'activ',
      locale: 'en',
      cityCode: 'RPR',
      ranges: () =>
        Promise.resolve([
          {
            kind: 'range',
            label: 'Activ',
            slug: 'activ',
            subtitle: 'Castrol',
            photo: null,
            matchedSize: null,
          },
        ]),
    });
    expect(items.some((i) => i.kind === 'range')).toBe(true);
  });
});

describe('the synonym editor', () => {
  it('is seeded from the built-in vocabulary', async () => {
    const all = await listSearchSynonyms(t());
    expect(all.find((r) => r.term === 'baitri')).toMatchObject({ kind: 'synonym', expandsTo: ['battery'] });
    expect(all.length).toBeGreaterThan(100);
  });
  it('a new word works at once, is audited, and a duplicate is refused', async () => {
    expect(await slugs('dhamaka')).toEqual([]);
    const row = await addSearchSynonym(t(), {
      term: 'Dhamaka',
      locale: 'hinglish',
      kind: 'synonym',
      expandsTo: ['exide'],
      staffUserId: F.staff!,
    });
    expect(row.term).toBe('dhamaka');
    expect(await slugs('dhamaka')).toContain('exide-35');
    await expect(
      addSearchSynonym(t(), {
        term: 'dhamaka',
        locale: 'hinglish',
        kind: 'synonym',
        expandsTo: ['exide'],
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'SYNONYM_EXISTS' });
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'search_synonym.created'));
    expect(audit).toHaveLength(1);
  });
  it('a category word must name a real category', async () => {
    await expect(
      addSearchSynonym(t(), {
        term: 'nothing',
        locale: 'en',
        kind: 'category',
        expandsTo: ['no-such-slug'],
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'SYNONYM_CATEGORY' });
  });
  it('switching a word off removes it from the search; stale versions are refused', async () => {
    const baitri = (await listSearchSynonyms(t())).find((r) => r.term === 'baitri' && r.kind === 'synonym')!;
    await expect(
      setSearchSynonymActive(t(), {
        id: baitri.id,
        expectedVersion: baitri.version + 5,
        active: false,
        staffUserId: F.staff!,
      }),
    ).rejects.toMatchObject({ code: 'STALE_SYNONYM' });
    const off = await setSearchSynonymActive(t(), {
      id: baitri.id,
      expectedVersion: baitri.version,
      active: false,
      staffUserId: F.staff!,
    });
    expect(off.version).toBe(baitri.version + 1);
    expect(await slugs('baitri')).toEqual([]);
  });
});
