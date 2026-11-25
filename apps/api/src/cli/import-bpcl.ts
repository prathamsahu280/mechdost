/**
 * `pnpm db:import:bpcl --dir <bpcl_mak_lubricants folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--concurrency N] [--staff-user <uuid>]` (user 2026-11-25; runbook
 * `docs/runbooks/catalogue-import.md` "HP and BPCL MAK lubricant imports"). Automotive only: the Industrial range and
 * the marine products are skipped and listed in the report. "Rs 354/-" is the pack's MRP; a pack with no price is price
 * on request. A picture the maker shows on many products is never used: that product is a draft.
 */
import {
  lubeArchivedCsv,
  lubeReportBrand,
  lubeSkippedCsv,
  lubeStatusCsv,
  lubeStatusMarkdown,
  planBpclDir,
  type LubePlan,
} from '@mechdost/db/lube-import';
import { applyBpclImport, diffBpclImport } from '@mechdost/db/repo';
import { planHindiLeftovers, readPicture } from '@mechdost/db/battery-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-bpcl-', readPicture);
const brand = lubeReportBrand({
  name: 'BPCL MAK lubricants',
  stem: 'bpcl',
  sourceNote: 'bharatpetroleum.in scrape (`bpcl_mak_lubricants_products.csv`, `_packs.csv`, `_grades.csv`)',
});

runBatteryImport<LubePlan>({
  name: 'BPCL MAK',
  folder: 'bpcl_mak_lubricants',
  stem: 'bpcl',
  hindiFile: 'packages/db/src/lube-import/ (hindi.ts, features-hi-bpcl.ts, hindi-allowed.ts)',
  planDir: planBpclDir,
  hindiLeftovers: planHindiLeftovers,
  diff: diffBpclImport,
  apply: applyBpclImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: lubeStatusCsv,
  statusMarkdown: (plan, meta) => lubeStatusMarkdown(brand, plan, meta),
  archivedCsv: lubeArchivedCsv,
  extraFiles: (plan) => [{ name: 'bpcl-import-skipped.csv', content: lubeSkippedCsv(plan) }],
  summaryExtras: (plan) => ({
    skipped: plan.skipped.length,
    skippedByReason: plan.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {}),
    draftsByReason: plan.drafts.reduce<Record<string, number>>((acc, d) => {
      acc[d.reason] = (acc[d.reason] ?? 0) + 1;
      return acc;
    }, {}),
    checks: plan.checks.length,
  }),
})
  .then(() => {
    const done = pictures.report();
    if (done) process.stderr.write(done);
  })
  .catch((err: unknown) => {
    process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
