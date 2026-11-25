import { slugify } from '@mechdost/shared/catalogue-import';
import { csvRows, type CsvRow } from '../battery-import';
import { canonicalPack } from './text';
import type { LubeItem, LubePack, PackResearch } from './types';

/**
 * HP packs and prices from the researched CSV (user 2026-11-25, `pnpm db:import:hp --packs <csv>`). Columns:
 * `plan_slug, product_name, grade, pack_label, net_qty, net_unit, mrp_inr, sale_price_inr, source_url, source_type,
 * checked_on, confidence, status, note`.
 *
 * Rules: the researched packs replace the "Standard pack"; the MRP comes only from `mrp_inr` of a row with confidence
 * high or medium (never from `sale_price_inr`); low confidence, and packs whose accepted rows disagree, are left at price on
 * request and listed; `source_url` and `checked_on` stay per pack in the private spec; a product with no rows keeps
 * today's behaviour.
 */
export function parseHpPacksCsv(text: string): CsvRow[] {
  return csvRows(text);
}

/** The URL slug of a product name as the plan makes it ("+" is "plus"). */
export const lubeSlug = (name: string): string => slugify(name.replace(/\+/g, ' plus '));

const RANK: Readonly<Record<string, number>> = { high: 3, medium: 2, low: 1 };

const rupees = (text: string | undefined): number | null => {
  const t = (text ?? '').trim().replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 ? Number(t) : null;
};

export function applyResearchedPacks(
  items: readonly LubeItem[],
  rows: readonly CsvRow[],
): { items: LubeItem[]; research: PackResearch } {
  const bySlug = new Map<string, CsvRow[]>();
  for (const r of rows) {
    const slug = (r.plan_slug ?? '').trim();
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), r]);
  }
  const research: PackResearch = {
    rows: rows.length,
    productsWithPacks: 0,
    packs: 0,
    withMrp: 0,
    lowConfidence: [],
    conflicts: [],
    unmatched: [],
    unreadable: [],
    noData: 0,
  };
  const known = new Set(items.map((i) => lubeSlug(i.name)));
  research.unmatched = [...bySlug.keys()].filter((s) => !known.has(s));

  const out = items.map((item): LubeItem => {
    const slug = lubeSlug(item.name);
    const mine = bySlug.get(slug);
    if (!mine) return item;
    // One group per canonical pack label.
    const groups = new Map<string, { net: LubePack['net']; rows: CsvRow[] }>();
    for (const r of mine) {
      if ((r.net_qty ?? '').trim() === '' && (r.pack_label ?? '').trim() === '') {
        research.noData += 1;
        continue;
      }
      const canon = canonicalPack(`${(r.net_qty ?? '').trim()} ${(r.net_unit ?? '').trim()}`);
      if (!canon) {
        research.unreadable.push({ slug, pack: (r.pack_label ?? '').trim() });
        continue;
      }
      const g = groups.get(canon.label) ?? { net: canon.net, rows: [] };
      g.rows.push(r);
      groups.set(canon.label, g);
    }
    if (groups.size === 0) return item;
    const packs: LubePack[] = [];
    const packSources: NonNullable<LubeItem['packSources']> = {};
    const checks = [...item.checks];
    for (const [label, g] of groups) {
      const accepted = new Set<number>();
      let low: number | null = null;
      for (const r of g.rows) {
        const mrp = rupees(r.mrp_inr);
        if (mrp === null) continue;
        const conf = (r.confidence ?? '').trim().toLowerCase();
        if (conf === 'high' || conf === 'medium') accepted.add(mrp);
        else low = mrp;
      }
      let mrpPaise: number | null = null;
      const only = accepted.size === 1 ? [...accepted][0] : undefined;
      if (only !== undefined) mrpPaise = Math.round(only * 100);
      else if (accepted.size > 1) {
        const list = [...accepted].sort((a, b) => a - b);
        research.conflicts.push({ slug, pack: label, mrpInr: list });
        checks.push(
          `Researched sources disagree on the MRP of ${label} (${list.join(' and ')}); left at price on request.`,
        );
      } else if (low !== null) {
        research.lowConfidence.push({ slug, pack: label, mrpInr: low });
        checks.push(
          `Researched MRP of ${label} (${String(low)}) has low confidence; left at price on request.`,
        );
      }
      packs.push({ label, net: g.net, mrpPaise, sourceText: label });
      research.packs += 1;
      if (mrpPaise !== null) research.withMrp += 1;
      const best = g.rows.reduce(
        (b, r) => Math.max(b, RANK[(r.confidence ?? '').trim().toLowerCase()] ?? 0),
        0,
      );
      packSources[label] = {
        sourceUrls: [...new Set(g.rows.map((r) => (r.source_url ?? '').trim()).filter((u) => u !== ''))],
        checkedOn:
          g.rows
            .map((r) => (r.checked_on ?? '').trim())
            .sort()
            .at(-1) ?? '',
        confidence: Object.keys(RANK).find((k) => RANK[k] === best) ?? '',
      };
    }
    research.productsWithPacks += 1;
    packs.sort((a, b) => a.net.qty - b.net.qty);
    return { ...item, packs, packSources, checks };
  });
  return { items: out, research };
}
