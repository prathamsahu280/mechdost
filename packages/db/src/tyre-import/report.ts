import {
  archivedCsv,
  statusCsv,
  statusMarkdown,
  type ArchivedRow,
  type ReportBrand,
  type ReportRow,
  type RowResult,
} from '../battery-import';
import type { TyrePlan } from './build';

export type { ArchivedRow, RowResult };

/** The summary of one tyre brand: the shared sections plus price on request, products without a picture and the source checks. */
export function tyreReportBrand(opts: {
  name: string;
  stem: string;
  sourceNote: string;
}): ReportBrand<TyrePlan> {
  return {
    name: opts.name,
    sourceNote: opts.sourceNote,
    stem: opts.stem,
    listShared: false,
    sharedPictures: {
      heading: 'Products that use the pattern pictures shared by every size of the pattern',
      note: 'The pictures are per pattern (4 views, or 1). They are uploaded once and shared by all sizes of the pattern (`spec.photoKind` = `range`).',
    },
    extraSections: (plan) => {
      const withSite = plan.priceOnRequest.filter((p) => p.siteDataPaise !== null);
      return [
        `### Price on request, of which the maker holds a hidden price: ${String(plan.priceOnRequest.length)} (${String(withSite.length)})`,
        '',
        'No price is shown on the maker\'s page, so the tyre is listed as "price on request". A price that sits only in the maker\'s hidden site data is kept privately in `spec.ceatPrice.siteData` (never shown, never used as the MRP; user ruling 2026-11-24).',
        '',
        `### Products without a picture (planned as drafts): ${String(plan.noPhoto.length)}`,
        '',
        ...plan.noPhoto.map((n) => `- ${n.name} (${n.slug}): ${n.reason}`),
        '',
        `### Source oddities and how they were handled: ${String(plan.checks.length)}`,
        '',
        ...plan.checks.map((c) => `- ${c.name}${c.slug === '' ? '' : ` (${c.slug})`}: ${c.note}`),
        '',
      ];
    },
  };
}

export const tyreStatusCsv = (rows: readonly ReportRow[], results?: ReadonlyMap<string, RowResult>) =>
  statusCsv(rows, results);

export const tyreArchivedCsv = (archived: readonly ArchivedRow[]) => archivedCsv(archived);

export function tyreStatusMarkdown<P extends TyrePlan>(
  brand: ReportBrand<P>,
  plan: P,
  meta: {
    run: 'plan only' | 'dry run' | 'real run';
    archived?: readonly ArchivedRow[];
    results?: ReadonlyMap<string, RowResult>;
  },
): string {
  return statusMarkdown(brand, plan, meta);
}
