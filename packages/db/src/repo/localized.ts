import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { products, shops } from '../schema';
import type { Tx } from './orders';

/**
 * Hindi completeness for the admin editors (hard rule 10, decision 2026-11-02 "Localised content columns"):
 * a customer-visible English field with no Hindi version falls back to English on /hi and is flagged here, so
 * staff can see exactly what still needs translating. Brand names are never translated and are not checked.
 */
export type HindiField = 'name' | 'description' | 'specSummary' | 'compatibility' | 'highlights';

export interface MissingHindi {
  kind: 'product' | 'shop';
  id: string;
  slug: string | null;
  fields: (HindiField | 'addressLine')[];
}

const blank = (en: unknown, hi: unknown) =>
  sql<boolean>`(${en} is not null and ${en} <> '' and coalesce(${hi}, '') = '')`;

/** Live/submitted products and approved shops that show English on /hi. Bounded (admin list, cursor later). */
export async function missingHindi(db: Tx, limit = 200): Promise<MissingHindi[]> {
  const productRows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: blank(products.name, products.nameHi),
      description: blank(products.description, products.descriptionHi),
      specSummary: blank(products.specSummary, products.specSummaryHi),
      compatibility: blank(products.compatibility, products.compatibilityHi),
      highlights: sql<boolean>`(cardinality(${products.highlights}) > 0 and cardinality(${products.highlightsHi}) = 0)`,
    })
    .from(products)
    .where(
      and(
        ne(products.status, 'archived'),
        or(
          isNull(products.nameHi),
          blank(products.description, products.descriptionHi),
          blank(products.specSummary, products.specSummaryHi),
          blank(products.compatibility, products.compatibilityHi),
          sql`(cardinality(${products.highlights}) > 0 and cardinality(${products.highlightsHi}) = 0)`,
        ),
      ),
    )
    .orderBy(products.slug)
    .limit(limit);
  const shopRows = await db
    .select({
      id: shops.id,
      name: blank(shops.name, shops.nameHi),
      addressLine: blank(shops.addressLine, shops.addressLineHi),
    })
    .from(shops)
    .where(and(eq(shops.status, 'approved'), or(isNull(shops.nameHi), isNull(shops.addressLineHi))))
    .limit(limit);
  const product = (r: (typeof productRows)[number]): MissingHindi => ({
    kind: 'product',
    id: r.id,
    slug: r.slug,
    fields: (['name', 'description', 'specSummary', 'compatibility', 'highlights'] as const).filter(
      (f) => r[f],
    ),
  });
  return [
    ...productRows.map(product),
    ...shopRows.map((r): MissingHindi => ({
      kind: 'shop',
      id: r.id,
      slug: null,
      fields: [...(r.name ? (['name'] as const) : []), ...(r.addressLine ? (['addressLine'] as const) : [])],
    })),
  ];
}

/** Picks the text for a locale with the English fallback (shared by API serializers). */
export function localized(en: string, hi: string | null | undefined, locale: 'en' | 'hi'): string {
  return locale === 'hi' && hi && hi.trim() !== '' ? hi : en;
}
