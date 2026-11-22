import { parseNetQuantity, type PlannedProduct } from './plan';

/** One MRP the maker price lists hold (`scripts/extract-price-lists.py`). */
export interface PriceRow {
  file: string;
  /** PDF page, or the worksheet row of the spreadsheet. */
  page: number;
  brand: string;
  product: string;
  pack: string;
  mrpRupees: number;
}

export interface MrpFill {
  sku: string;
  slug: string;
  brand: string;
  pack: string;
  mrpPaise: number;
  file: string;
  page: number;
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

function packKey(pack: string): string {
  const q = parseNetQuantity(pack);
  return q ? `${String(q.qty)}${q.unit}` : norm(pack);
}

/**
 * Fill the packs catalogue-v2 left without an MRP from the price lists, on EXACT brand + product + pack matches only
 * (names compared without case, spaces and punctuation; pack sizes compared as quantities, so "0.9 L" = "900 ml").
 * A pack the lists price twice with different MRPs is left alone (ambiguous). Rows with no brand cannot be tied to a
 * brand and never match. Mutates the planned packs (`mrpPaise`, `mrpFill`) and returns each fill for the report.
 */
export function fillMissingMrps(products: PlannedProduct[], rows: readonly PriceRow[]): MrpFill[] {
  const index = new Map<string, PriceRow[]>();
  for (const r of rows) {
    if (r.brand.trim() === '' || !(r.mrpRupees > 0)) continue;
    const key = `${norm(r.brand)}|${norm(r.product)}|${packKey(r.pack)}`;
    const list = index.get(key);
    if (list) list.push(r);
    else index.set(key, [r]);
  }
  const fills: MrpFill[] = [];
  for (const p of products) {
    for (const pack of p.packs) {
      if (pack.mrpPaise !== null || pack.label === '') continue;
      const hits = index.get(`${norm(p.brand.name)}|${norm(p.name)}|${packKey(pack.label)}`);
      const first = hits?.[0];
      if (!hits || !first || hits.some((h) => h.mrpRupees !== first.mrpRupees)) continue;
      const mrpPaise = Math.round(first.mrpRupees * 100);
      pack.mrpPaise = mrpPaise;
      pack.mrpFill = { file: first.file, page: first.page };
      fills.push({
        sku: pack.sku,
        slug: p.slug,
        brand: p.brand.name,
        pack: pack.label,
        mrpPaise,
        file: first.file,
        page: first.page,
      });
    }
  }
  return fills;
}
