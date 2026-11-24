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
  name: 'CEAT',
  stem: 'ceat',
  sourceNote: 'ceat.com scrape (`ceat_tyres.csv`, `ceat_vehicle_fitment.csv`)',
});

export const ceatStatusCsv = tyreStatusCsv;
export const ceatArchivedCsv = tyreArchivedCsv;

/** The summary page `docs/catalogue/ceat-import-status.md`. */
export function ceatStatusMarkdown(
  plan: TyrePlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return tyreStatusMarkdown(BRAND, plan, meta);
}
