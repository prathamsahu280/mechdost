import {
  tyreArchivedCsv,
  tyreReportBrand,
  tyreStatusCsv,
  tyreStatusMarkdown,
  type ArchivedRow,
  type RowResult,
  type TyrePlan,
} from '../tyre-import';

export type { ArchivedRow, RowResult };

const BRAND = tyreReportBrand({
  name: 'MRF',
  stem: 'mrf',
  sourceNote: 'mrftyres.com scrape (`mrf_tyres.csv`, `mrf_vehicle_fitment.csv`)',
});

export const mrfStatusCsv = tyreStatusCsv;
export const mrfArchivedCsv = tyreArchivedCsv;

/** The summary page `docs/catalogue/mrf-import-status.md`. */
export function mrfStatusMarkdown(
  plan: TyrePlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return tyreStatusMarkdown(BRAND, plan, meta);
}
