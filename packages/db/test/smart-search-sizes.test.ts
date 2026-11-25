/**
 * Search by size (spec 02 "Search by size", user 2026-11-25): a product is found by any of its active sizes, in any
 * spacing, ranks above products that only match the brand, and says which size matched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../src/testing';
import * as s from '../src/schema';
import { listCatalogue, suggestCatalogue, type Tx } from '../src/repo';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
const F: Record<string, string> = {};

interface Size {
  sku: string;
  options: Record<string, unknown>;
  net?: { qty: number; unit: 'ml' | 'g' };
  status?: 'active' | 'archived';
}

async function product(slug: string, brand: string, category: string, name: string, sizes: Size[]) {
  const [p] = await db
    .insert(s.products)
    .values({
      slug,
      name,
      brandId: F[brand]!,
      categoryId: F[category]!,
      hsn: '4011',
      gstRateBp: 2800,
      status: 'live',
    })
    .returning();
  for (const z of sizes)
    await db.insert(s.productVariants).values({
      productId: p!.id,
      sku: z.sku,
      options: z.options,
      mrpPaise: 100000,
      status: z.status ?? 'active',
      ...(z.net ? { netQty: z.net.qty, netUnit: z.net.unit } : {}),
    });
}

const tyre = (sku: string, size: string, load: number, speed: string, tl = 'TL'): Size => ({
  sku,
  options: { size, loadIndex: load, speedRating: speed, tlTt: tl },
});

const find = async (q: string) => (await listCatalogue(t(), { cityCode: 'RPR', q, locale: 'en' })).items;
const slugs = async (q: string) => (await find(q)).map((i) => i.slug);

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
  for (const [key, slug, name] of [
    ['tyres', 'tyres', 'Tyres'],
    ['lubricants', 'lubricants', 'Lubricants'],
  ] as const)
    F[key] = (await db.insert(s.categories).values({ slug, name }).returning())[0]!.id;
  for (const [key, name] of [
    ['ceat', 'CEAT'],
    ['mrf', 'MRF'],
    ['castrol', 'Castrol'],
  ] as const)
    F[key] = (await db.insert(s.brands).values({ slug: key, name }).returning())[0]!.id;

  await product('ceat-milaze', 'ceat', 'tyres', 'CEAT Milaze X5', [
    tyre('CEAT-A1', '3.50-10', 51, 'J'),
    tyre('CEAT-A2', '90/90-12', 54, 'J'),
    tyre('CEAT-A3', '90/100-10', 53, 'J'),
    tyre('CEAT-A4', '100/90-10', 56, 'J', 'TT'),
  ]);
  await product('ceat-secura', 'ceat', 'tyres', 'CEAT Secura Zoom', [tyre('CEAT-B1', '2.75-18', 48, 'P')]);
  await product('mrf-zapper', 'mrf', 'tyres', 'MRF Zapper', [tyre('MRF-C1', '175/65 R14', 82, 'T')]);
  await product('ceat-car', 'ceat', 'tyres', 'CEAT SecuraDrive', [
    tyre('CEAT-D1', '175/65 R14', 82, 'T'),
    { ...tyre('CEAT-D2', '145/80 R12', 74, 'T'), status: 'archived' },
  ]);
  await product('castrol-gtx', 'castrol', 'lubricants', 'Castrol GTX', [
    { sku: 'CAS-1', options: { label: '1 L' }, net: { qty: 1000, unit: 'ml' } },
    { sku: 'CAS-2', options: { label: '3.5 L' }, net: { qty: 3500, unit: 'ml' } },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('a product is found by any of its sizes, in any spacing', () => {
  it.each(['90/90-12', '90 90 12', '90/90 -12', '90/90R12', '90/90 r12'])(
    '"%s" finds the CEAT Milaze',
    async (q) => {
      expect(await slugs(q)).toEqual(['ceat-milaze']);
    },
  );
  it.each(['3.50-10', '3.50 - 10'])('"%s" finds the bias size', async (q) => {
    expect(await slugs(q)).toEqual(['ceat-milaze']);
  });
  it.each(['175/65R14', '175/65 R14', '175 65 r14', '175/65-14'])('"%s" finds both car tyres', async (q) => {
    expect((await slugs(q)).sort()).toEqual(['ceat-car', 'mrf-zapper']);
  });
  it('pack sizes: "3.5 l", "3.5l" and "3500ml" find the 3.5 L pack', async () => {
    for (const q of ['3.5 l', '3.5l', '3500ml', '3.5 litre']) expect(await slugs(q)).toEqual(['castrol-gtx']);
  });
  it('an archived size is not found', async () => {
    expect(await slugs('145/80 R12')).toEqual([]);
  });
  it('the SKU still works', async () => {
    expect(await slugs('CEAT-A2')).toEqual(['ceat-milaze']);
  });
  it('a size edit is searchable at once (trigger), and an archive removes it', async () => {
    const [v] = await db.select().from(s.productVariants).where(eq(s.productVariants.sku, 'CEAT-B1'));
    await db
      .update(s.productVariants)
      .set({ options: { size: '2.75-17', loadIndex: 41, speedRating: 'P', tlTt: 'TT' } })
      .where(eq(s.productVariants.id, v!.id));
    expect(await slugs('2.75-17')).toEqual(['ceat-secura']);
    expect(await slugs('2.75-18')).toEqual([]);
    await db.update(s.productVariants).set({ status: 'archived' }).where(eq(s.productVariants.id, v!.id));
    expect(await slugs('2.75-17')).toEqual([]);
    await db.update(s.productVariants).set({ status: 'active' }).where(eq(s.productVariants.id, v!.id));
    expect(await slugs('2.75-17')).toEqual(['ceat-secura']);
  });
});

describe('ranking and the matched size', () => {
  it('"90/90-12 ceat": the CEAT with that size comes before the other CEAT tyres', async () => {
    const order = await slugs('90/90-12 ceat');
    expect(order[0]).toBe('ceat-milaze');
    expect(order).toContain('ceat-car');
  });
  it('says which size matched, with its SKU, and only that size', async () => {
    const [card] = await find('90/90-12');
    expect(card?.matchedSizes).toEqual([{ label: '90/90-12 54J TL', sku: 'CEAT-A2' }]);
    expect(card?.sizeCount).toBe(4);
  });
  it('the pack that matched is named; a query without a size names none', async () => {
    const [card] = await find('castrol 3.5 l');
    expect(card?.matchedSizes).toEqual([{ label: '3.5 L', sku: 'CAS-2' }]);
    const [plain] = await find('castrol');
    expect(plain?.matchedSizes).toEqual([]);
  });
});

describe('the suggestions use the same search', () => {
  it('"90/90-12" suggests the product', async () => {
    const out = await suggestCatalogue(t(), { q: '90/90-12', locale: 'en', cityCode: 'RPR' });
    expect(out.find((i) => i.kind === 'product')?.slug).toBe('ceat-milaze');
    expect(out.find((i) => i.kind === 'product')?.matchedSize).toEqual({
      label: '90/90-12 54J TL',
      sku: 'CEAT-A2',
    });
  });
});
