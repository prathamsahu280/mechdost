import type { StatusRow } from './plan';

const HEADER = [
  'section',
  'source_id',
  'brand',
  'range',
  'product',
  'packs',
  'packs_with_mrp',
  'mrp_filled_from_price_list',
  'status',
  'reason',
  'detail',
  'slug',
] as const;

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The import status report as CSV: one row for EVERY product in catalogue-v2 (public product data only). */
export function statusCsv(rows: readonly StatusRow[]): string {
  const lines = rows.map((r) =>
    [
      r.section,
      r.sourceId,
      r.brand,
      r.range,
      r.name,
      r.packs,
      r.packsWithMrp,
      r.mrpFills,
      r.status,
      r.reason,
      r.detail,
      r.slug,
    ]
      .map(cell)
      .join(','),
  );
  return `${HEADER.join(',')}\n${lines.join('\n')}\n`;
}

function tally(rows: readonly StatusRow[], key: (r: StatusRow) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/** Short summary of the same rows: counts per status, section, brand and skip reason, and how to re-run. */
export function statusMarkdown(
  rows: readonly StatusRow[],
  meta: { run: 'dry run' | 'real run'; brands: string },
): string {
  const table = (title: string, pairs: [string, number][]) =>
    `### ${title}\n\n| | Products |\n|---|---|\n${pairs.map(([k, n]) => `| ${k} | ${String(n)} |`).join('\n')}\n`;
  const bySection = new Map<string, StatusRow[]>();
  for (const r of rows) bySection.set(r.section, [...(bySection.get(r.section) ?? []), r]);
  const sectionLines = [...bySection].map(([sec, list]) => {
    const n = (s: string) => list.filter((r) => r.status === s).length;
    return `| ${sec} | ${String(list.length)} | ${String(n('imported'))} | ${String(n('updated'))} | ${String(n('unchanged'))} | ${String(n('skipped'))} |`;
  });
  const imported = rows.filter((r) => r.status !== 'skipped');
  return `# catalogue-v2 import status

Last ${meta.run}. Brands imported: ${meta.brands}. One row per product of catalogue-v2 is in
\`catalogue-v2-import-status.csv\` (${String(rows.length)} rows). A dry run shows what the import WOULD do.

- Products on the list: ${String(rows.length)}
- Imported / updated / unchanged: ${String(imported.length)} (${String(imported.reduce((n, r) => n + r.packs, 0))} packs, ${String(imported.reduce((n, r) => n + r.packsWithMrp, 0))} with an MRP)
- Skipped: ${String(rows.length - imported.length)}

| Section | Products | Imported | Updated | Unchanged | Skipped |
|---|---|---|---|---|---|
${sectionLines.join('\n')}

${table(
  'Status',
  tally(rows, (r) => r.status),
)}
${table(
  'Skip reasons',
  tally(
    rows.filter((r) => r.reason !== ''),
    (r) => r.reason,
  ),
)}
${table(
  'Brand (imported products)',
  tally(imported, (r) => r.brand),
)}

Skip reasons: \`not_price_list_brand\` (brand not in the \`--brands\` list), \`representative_picture\` (the picture is of a
similar product), \`no_picture_bytes\` (no picture entry, or the bytes are empty or do not decode), \`invalid\`
(the source row could not be planned; \`detail\` says why).

## How to re-run

\`\`\`
pnpm db:import:catalogue --dir <catalogue-v2/site> --dry-run     # writes this report, changes nothing
pnpm db:import:catalogue --dir <catalogue-v2/site> --staff-user <uuid>
pnpm db:import:catalogue --dir <site> --brands castrol,gulf,motul   # other brands later, no code change
\`\`\`

See \`docs/runbooks/catalogue-import.md\`.
`;
}
