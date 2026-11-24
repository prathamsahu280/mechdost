import {
  archivedCsv,
  statusCsv,
  statusMarkdown,
  type ArchivedRow,
  type ReportBrand,
  type ReportRow,
  type RowResult,
} from '../battery-import';
import type { TataGreenPlan } from './plan';

export type { ArchivedRow, RowResult };

const BRAND: ReportBrand<TataGreenPlan> = {
  name: 'Tata Green',
  sourceNote: 'tatagreen_batteries scrape (`tatagreen_batteries.csv`, `tatagreen_vehicle_fitment.csv`)',
  stem: 'tatagreen',
  sharedPictures: {
    heading: 'Products whose main picture is shared with other products',
    note: 'Tata Green shows one picture for 2 or 3 products (the "Picture note" column says how many). They are live with it; replace it when a model photo exists (`spec.photoKind` = `range`).',
  },
  extraSections: (plan) => [
    `### Products without a picture: ${String(plan.noPhoto.length)}`,
    '',
    'Planned as drafts (no usable picture). `placeholder` = the grey "picture not available" image of the site, byte-identical on three products, never imported as a photo; `no_file` = the source has no file.',
    '',
    ...plan.noPhoto.map((n) => `- ${n.name} (${n.slug}): ${n.reason}`),
    '',
    `### Category follows the name the site gives the product: ${String(plan.reclassified.length)}`,
    '',
    'Tata Green lists some vehicle batteries on a different page than the product name says (for example the TG car batteries under "commercial"). The name wins; `spec.categoryRule` records why. Staff can move them.',
    '',
    ...plan.reclassified.map((r) => `- ${r.name} (${r.slug}): ${r.category}`),
    '',
  ],
};

/** One CSV line per source row: what it became. An empty MRP means "price on request". */
export function tataGreenStatusCsv(
  rows: readonly ReportRow[],
  results?: ReadonlyMap<string, RowResult>,
): string {
  return statusCsv(rows, results);
}

export function tataGreenArchivedCsv(archived: readonly ArchivedRow[]): string {
  return archivedCsv(archived);
}

/** The summary page `docs/catalogue/tatagreen-import-status.md`. */
export function tataGreenStatusMarkdown(
  plan: TataGreenPlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return statusMarkdown(BRAND, plan, meta);
}
