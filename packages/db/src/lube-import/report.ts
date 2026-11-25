import {
  archivedCsv,
  statusCsv,
  statusMarkdown,
  tally,
  type ArchivedRow,
  type ReportBrand,
  type ReportRow,
  type RowResult,
} from '../battery-import';
import type { LubePlan } from './types';

export type { ArchivedRow, RowResult };

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report of one lubricant brand: shared sections plus counts per category, drafts, skipped rows and source checks. */
export function lubeReportBrand(opts: {
  name: string;
  stem: string;
  sourceNote: string;
}): ReportBrand<LubePlan> {
  return {
    name: opts.name,
    stem: opts.stem,
    sourceNote: opts.sourceNote,
    listShared: false,
    sharedPictures: {
      heading: 'Products whose own photo is shared with another grade of the same product',
      note: 'The grades of one source row share its photo; it is uploaded once (`spec.photoKind` = `range`).',
    },
    extraSections: (plan) => {
      const perCategory = new Map<string, { products: number; packs: number; mrp: number }>();
      for (const p of plan.products) {
        const row = perCategory.get(p.category.slug) ?? { products: 0, packs: 0, mrp: 0 };
        row.products += 1;
        row.packs += p.variants.length;
        row.mrp += p.variants.filter((v) => v.mrpPaise !== null).length;
        perCategory.set(p.category.slug, row);
      }
      const packs = plan.products.reduce((n, p) => n + p.variants.length, 0);
      const withMrp = plan.products.reduce(
        (n, p) => n + p.variants.filter((v) => v.mrpPaise !== null).length,
        0,
      );
      const bySkip = tally(plan.skipped.map((s) => s.reason));
      const byDraft = tally(plan.drafts.map((d) => d.reason));
      return [
        'Note: the tables above count lines of the status CSV, which has one line per pack (a product with 3 packs is 3 lines).',
        '',
        '### Products and packs per category',
        '',
        '| Category | Products | Packs | Packs with MRP |',
        '|---|---|---|---|',
        ...[...perCategory].map(
          ([k, v]) => `| ${k} | ${String(v.products)} | ${String(v.packs)} | ${String(v.mrp)} |`,
        ),
        `| **Total** | ${String(plan.products.length)} | ${String(packs)} | ${String(withMrp)} |`,
        '',
        `Packs: ${String(packs)}; with an MRP: ${String(withMrp)}; price on request: ${String(packs - withMrp)}.`,
        '',
        ...(plan.research
          ? [
              `### Researched packs and prices (--packs): ${String(plan.research.packs)} packs on ${String(plan.research.productsWithPacks)} products, ${String(plan.research.withMrp)} with an MRP`,
              '',
              `CSV rows: ${String(plan.research.rows)}. MRP only from high or medium confidence rows; the sale price is never the MRP. Products without rows keep the Standard pack (price on request).`,
              '',
              `Low confidence, left at price on request: ${String(plan.research.lowConfidence.length)}`,
              ...plan.research.lowConfidence.map((l) => `- ${l.slug} ${l.pack}: ${String(l.mrpInr)}`),
              '',
              `Sources disagree, left at price on request: ${String(plan.research.conflicts.length)}`,
              ...plan.research.conflicts.map((c) => `- ${c.slug} ${c.pack}: ${c.mrpInr.join(' / ')}`),
              '',
              `CSV rows for no planned product: ${String(plan.research.unmatched.length)}`,
              ...plan.research.unmatched.map((u) => `- ${u}`),
              '',
              `Rows not used (status other than pack_only or found, or an inferred link): ${String(plan.research.ignored)}`,
              '',
              `Rows that found no pack (nothing to import): ${String(plan.research.noData)}`,
              '',
              `Rows with an unreadable pack size: ${String(plan.research.unreadable.length)}`,
              ...plan.research.unreadable.map((u) => `- ${u.slug} ${u.pack}`),
              '',
            ]
          : []),
        `### Products planned as drafts (no usable photo): ${String(plan.drafts.length)}`,
        '',
        ...byDraft.map(([r, n]) => `- ${r}: ${String(n)}`),
        '',
        ...plan.drafts.map((d) => `- ${d.name} (${d.slug}): ${d.reason}`),
        '',
        `### Source rows skipped (not automotive): ${String(plan.skipped.length)}`,
        '',
        ...bySkip.map(([r, n]) => `- ${r}: ${String(n)}`),
        '',
        'Every skipped row with its reason is in `' + opts.stem + '-import-skipped.csv`.',
        '',
        `### Source oddities and how they were handled: ${String(plan.checks.length)}`,
        '',
        ...plan.checks.map((c) => `- ${c.name}${c.slug === '' ? '' : ` (${c.slug})`}: ${c.note}`),
        '',
      ];
    },
  };
}

/** One line per pack, then one line per skipped row (status `skipped: <reason>`). */
export function lubeStatusCsv(
  rows: readonly ReportRow[],
  results?: ReadonlyMap<string, RowResult>,
  plan?: LubePlan,
): string {
  const kept = statusCsv(rows, results);
  if (!plan) return kept;
  const lines = plan.skipped.map((s) =>
    [
      s.sourceRow,
      s.listedCategory,
      s.listedRange,
      '',
      s.name,
      '',
      '',
      '',
      '',
      '',
      0,
      '',
      '',
      `skipped: ${s.reason}`,
      'skipped',
    ]
      .map(cell)
      .join(','),
  );
  return `${kept}${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

/** `<stem>-import-skipped.csv`: the skipped rows with their reason and the explanation. */
export function lubeSkippedCsv(plan: LubePlan): string {
  const lines = plan.skipped.map((s) =>
    [s.sourceRow, s.name, s.listedRange, s.listedCategory, s.reason, s.detail].map(cell).join(','),
  );
  return `source_row,name,range,category,reason,detail\n${lines.join('\n')}\n`;
}

export const lubeArchivedCsv = archivedCsv;

export function lubeStatusMarkdown(
  brand: ReportBrand<LubePlan>,
  plan: LubePlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return statusMarkdown(brand, plan, meta);
}
