import type { BatteryPlan, ReportRow } from './types';

const HEADER = [
  'source_row',
  'product_type',
  'range',
  'model',
  'name',
  'slug',
  'sku',
  'category',
  'mrp_rupees',
  'warranty_months',
  'fitment_vehicles',
  'picture',
  'photo_kind',
  'status',
  'result',
] as const;

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** What a run did with a source row (`planned` before any database was read). */
export type RowResult = 'planned' | 'created' | 'updated' | 'unchanged';

/** One CSV line per source row: what it became. An empty MRP means "price on request". */
export function statusCsv(rows: readonly ReportRow[], results?: ReadonlyMap<string, RowResult>): string {
  const lines = rows.map((r) =>
    [
      r.sourceRow,
      r.productType,
      r.range,
      r.model,
      r.name,
      r.slug,
      r.sku,
      r.category,
      r.mrpRupees,
      r.warrantyMonths,
      r.fitmentCount,
      r.photoFile,
      r.photoKind,
      r.status,
      results?.get(r.slug) ?? 'planned',
    ]
      .map(cell)
      .join(','),
  );
  return `${HEADER.join(',')}\n${lines.join('\n')}\n`;
}

export interface ArchivedRow {
  slug: string;
  name: string;
  status: string;
}

export function archivedCsv(archived: readonly ArchivedRow[]): string {
  const lines = archived.map((a) => [a.slug, a.name, a.status].map(cell).join(','));
  return `slug,name,status_before\n${lines.join('\n')}\n`;
}

export function tally(values: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** What differs between the brands in the summary page. */
export interface ReportBrand<P extends BatteryPlan = BatteryPlan> {
  name: string;
  /** "exidecare scrape (`exide_batteries.csv`, `exide_vehicle_fitment.csv`)". */
  sourceNote: string;
  /** File stem of the report files (`exide` → `exide-import-status.csv`). */
  stem: string;
  /** Heading and note of the shared-picture section. */
  sharedPictures: { heading: string; note: string };
  /** false = only the count of the shared-picture products is printed, not one line each (tyres: whole patterns share). */
  listShared?: boolean;
  /** Extra sections (already Markdown) the brand wants after the tallies. */
  extraSections?: (plan: P) => string[];
}

/** The summary page `docs/catalogue/<stem>-import-status.md`. */
export function statusMarkdown<P extends BatteryPlan>(
  brand: ReportBrand<P>,
  plan: P,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  const table = (title: string, pairs: [string, number][]) =>
    `### ${title}\n\n| | Source rows |\n|---|---|\n${pairs.map(([k, n]) => `| ${k} | ${String(n)} |`).join('\n')}\n`;
  const missing = plan.rows.filter((r) => r.mrpRupees === '');
  const results = meta.results ? tally(plan.rows.map((r) => meta.results?.get(r.slug) ?? 'planned')) : [];
  const archived = meta.archived;
  const shared = plan.rows.filter((r) => r.photoKind === 'range');
  return [
    `# ${brand.name} import status`,
    '',
    `Run: ${meta.run}. Source: ${brand.sourceNote}. One line per source row is in \`${brand.stem}-import-status.csv\`.`,
    '',
    `Source rows: ${String(plan.rows.length)}. Products planned: ${String(plan.products.length)}. Fitment lines in the plan: ${String(plan.products.reduce((n, p) => n + p.fitmentCount, 0))}.`,
    '',
    table('By category', tally(plan.rows.map((r) => r.category))),
    table('By product type', tally(plan.rows.map((r) => r.productType))),
    table('By range', tally(plan.rows.map((r) => r.range))),
    ...(results.length > 0 ? [table('Result of this run', results)] : []),
    `### Price on request (no MRP in the source): ${String(missing.length)}`,
    '',
    ...missing.map((r) => `- ${r.name} (${r.slug})`),
    '',
    `### ${brand.sharedPictures.heading}: ${String(shared.length)}`,
    '',
    brand.sharedPictures.note,
    '',
    ...(brand.listShared === false ? [] : shared.map((r) => `- ${r.name} (${r.slug})`)),
    '',
    ...(brand.extraSections?.(plan) ?? []),
    archived
      ? `### Old ${brand.name} products archived by this run: ${String(archived.length)}\n\nListed in \`${brand.stem}-import-archived.csv\`. Archived, never deleted (old orders and carts point at them).\n`
      : `### Old ${brand.name} products archived\n\nFilled in by the real run (\`${brand.stem}-import-archived.csv\`).\n`,
    '',
  ].join('\n');
}
