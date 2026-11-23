import type { ExidePlan, ExideReportRow } from './plan';

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
export function exideStatusCsv(
  rows: readonly ExideReportRow[],
  results?: ReadonlyMap<string, RowResult>,
): string {
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

export function exideArchivedCsv(archived: readonly ArchivedRow[]): string {
  const lines = archived.map((a) => [a.slug, a.name, a.status].map(cell).join(','));
  return `slug,name,status_before\n${lines.join('\n')}\n`;
}

function tally(values: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** The summary page `docs/catalogue/exide-import-status.md`. */
export function exideStatusMarkdown(
  plan: ExidePlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  const table = (title: string, pairs: [string, number][]) =>
    `### ${title}\n\n| | Products |\n|---|---|\n${pairs.map(([k, n]) => `| ${k} | ${String(n)} |`).join('\n')}\n`;
  const missing = plan.rows.filter((r) => r.mrpRupees === '');
  const results = meta.results ? tally(plan.rows.map((r) => meta.results?.get(r.slug) ?? 'planned')) : [];
  const archived = meta.archived;
  return [
    '# Exide import status',
    '',
    `Run: ${meta.run}. Source: exidecare scrape (\`exide_batteries.csv\`, \`exide_vehicle_fitment.csv\`). One line per source row is in \`exide-import-status.csv\`.`,
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
    `### Generic range pictures (Exide shows one picture for the whole range): ${String(plan.rows.filter((r) => r.photoKind === 'range').length)}`,
    '',
    'These products are live with their range photo; replace it with a model photo when one exists (`spec.photoKind` = `range`).',
    '',
    ...plan.rows.filter((r) => r.photoKind === 'range').map((r) => `- ${r.name} (${r.slug})`),
    '',
    archived
      ? `### Old Exide products archived by this run: ${String(archived.length)}\n\nListed in \`exide-import-archived.csv\`. Archived, never deleted (old orders and carts point at them).\n`
      : '### Old Exide products archived\n\nFilled in by the real run (`exide-import-archived.csv`).\n',
    '',
  ].join('\n');
}
