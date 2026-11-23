import {
  archivedCsv,
  statusCsv,
  statusMarkdown,
  type ArchivedRow,
  type BatteryPlan,
  type ReportBrand,
  type ReportRow,
  type RowResult,
} from '../battery-import';

export type { ArchivedRow, RowResult };

const BRAND: ReportBrand = {
  name: 'Exide',
  sourceNote: 'exidecare scrape (`exide_batteries.csv`, `exide_vehicle_fitment.csv`)',
  stem: 'exide',
  sharedPictures: {
    heading: 'Generic range pictures (Exide shows one picture for the whole range)',
    note: 'These products are live with their range photo; replace it with a model photo when one exists (`spec.photoKind` = `range`).',
  },
};

/** One CSV line per source row: what it became. An empty MRP means "price on request". */
export function exideStatusCsv(rows: readonly ReportRow[], results?: ReadonlyMap<string, RowResult>): string {
  return statusCsv(rows, results);
}

export function exideArchivedCsv(archived: readonly ArchivedRow[]): string {
  return archivedCsv(archived);
}

/** The summary page `docs/catalogue/exide-import-status.md`. */
export function exideStatusMarkdown(
  plan: BatteryPlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return statusMarkdown(BRAND, plan, meta);
}
