import type { ReportBrand, ReportRow } from '../battery-import';
import {
  tyreArchivedCsv,
  tyreReportBrand,
  tyreStatusCsv,
  tyreStatusMarkdown,
  type ArchivedRow,
  type RowResult,
} from '../tyre-import';
import type { ApolloPlan } from './plan';

export type { ArchivedRow, RowResult };

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const base = tyreReportBrand({
  name: 'Apollo',
  stem: 'apollo',
  sourceNote:
    'apollotyres.com and shop.apollotyres.com scrape (`apollo_tyres.csv`, `apollo_brochure_products.csv`, `apollo_vehicle_fitment.csv`)',
});

/** Every row left out of the import, with its reason (user ruling 2026-11-24: India only). */
function droppedSections(plan: ApolloPlan): string[] {
  const count = (r: string) => plan.dropped.filter((d) => d.reason === r).length;
  return [
    `### Rows not imported: ${String(plan.dropped.length)}`,
    '',
    `India only. Shop only (sold on shop.apollotyres.com, not on the India site, includes all Vredestein): ${String(count('shop_only'))}. Brochure only (not on the website): ${String(count('brochure_only'))}. Duplicate listings merged into one size: ${String(count('duplicate'))}. Neither on the India site nor the shop: ${String(count('not_india'))}. Every row is also in \`apollo-import-status.csv\` and \`apollo-import-dropped.csv\`.`,
    '',
    '| Source | Row | Brand | Name | Reason |',
    '|---|---|---|---|---|',
    ...plan.dropped.map(
      (d) =>
        `| ${d.source} | ${String(d.sourceRow)} | ${d.brand} | ${d.name.replace(/\|/g, '/')} | ${d.reason} |`,
    ),
    '',
    `### Fitment lines whose tyre name matches no tyre row: ${String(plan.fitmentUnmatched.length)}`,
    '',
    ...plan.fitmentUnmatched.map((n) => `- ${n}`),
    '',
  ];
}

const BRAND: ReportBrand<ApolloPlan> = {
  ...base,
  extraSections: (plan) => [...(base.extraSections?.(plan) ?? []), ...droppedSections(plan)],
};

/** The status CSV: one line per kept size, then one line per dropped row (status `dropped: <reason>`). */
export function apolloStatusCsv(
  rows: readonly ReportRow[],
  results?: ReadonlyMap<string, RowResult>,
  plan?: ApolloPlan,
): string {
  const kept = tyreStatusCsv(rows, results);
  if (!plan) return kept;
  const lines = plan.dropped.map((d) =>
    [d.sourceRow, '', '', '', d.name, '', '', '', '', '', 0, '', '', `dropped: ${d.reason}`, 'dropped']
      .map(cell)
      .join(','),
  );
  return `${kept}${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

/** `apollo-import-dropped.csv`: the dropped rows with their reason and the long explanation. */
export function apolloDroppedCsv(plan: ApolloPlan): string {
  const lines = plan.dropped.map((d) =>
    [d.source, d.sourceRow, d.brand, d.name, d.reason, d.detail].map(cell).join(','),
  );
  return `source,source_row,brand,name,reason,detail\n${lines.join('\n')}\n`;
}

export const apolloArchivedCsv = tyreArchivedCsv;

/** The summary page `docs/catalogue/apollo-import-status.md`. */
export function apolloStatusMarkdown(
  plan: ApolloPlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return tyreStatusMarkdown(BRAND, plan, meta);
}
