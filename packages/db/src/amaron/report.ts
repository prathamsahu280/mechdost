import {
  archivedCsv,
  statusCsv,
  statusMarkdown,
  type ArchivedRow,
  type ReportBrand,
  type ReportRow,
  type RowResult,
} from '../battery-import';
import type { AmaronPlan } from './plan';

export type { ArchivedRow, RowResult };

const BRAND: ReportBrand<AmaronPlan> = {
  name: 'Amaron',
  sourceNote:
    'amaron_batteries scrape (`amaron_batteries.csv`, `amaron_vehicle_fitment.csv`, `amaron_home_ups_combos.csv`)',
  stem: 'amaron',
  sharedPictures: {
    heading: 'Products whose main picture is shared with other products',
    note: 'Amaron shows one picture for several products (the "Picture notes" column says how many). They are live with it; replace it when a model photo exists (`spec.photoKind` = `range`, per photo in `spec.photoKinds`).',
  },
  extraSections: (plan) => [
    `### Home UPS combos: ${String(plan.combos.total)}`,
    '',
    `Combos are not products: each is listed in \`spec.combos\` of the Home UPS inverter and of the inverter battery that make it (${String(plan.combos.attached)} attached, ${String(plan.combos.unmatched)} with an unknown item code). A combo listing can be added later.`,
    '',
    `### Batteries the vehicle finder does not list: ${String(plan.notInFinder.length)}`,
    '',
    'Each went into the category of the most common product type among the listed batteries of the same range and size class (under 20 Ah counts as small); a range with no listed battery goes to car, SUV and MUV batteries.',
    '',
    ...plan.notInFinder.map((n) => `- ${n.name} (${n.slug}): ${n.category}`),
    '',
  ],
};

/** One CSV line per source row: what it became. An empty MRP means "price on request". */
export function amaronStatusCsv(
  rows: readonly ReportRow[],
  results?: ReadonlyMap<string, RowResult>,
): string {
  return statusCsv(rows, results);
}

export function amaronArchivedCsv(archived: readonly ArchivedRow[]): string {
  return archivedCsv(archived);
}

/** The summary page `docs/catalogue/amaron-import-status.md`. */
export function amaronStatusMarkdown(
  plan: AmaronPlan,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return statusMarkdown(BRAND, plan, meta);
}
