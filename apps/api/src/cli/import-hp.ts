/**
 * `pnpm db:import:hp --dir <hp_lubricants folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--concurrency N] [--packs <researched csv>] [--staff-user <uuid>]` (user 2026-11-25; runbook
 * `docs/runbooks/catalogue-import.md` "HP and BPCL MAK lubricant imports"). Automotive only: industrial, marine,
 * railroad and stationary rows are skipped and listed in the report. HP shows no prices and no pack sizes, so every pack is
 * price on request. A picture the maker shows on many products is never used: that product is a draft.
 */
import {
  lubeArchivedCsv,
  lubeReportBrand,
  lubeSkippedCsv,
  lubeStatusCsv,
  lubeStatusMarkdown,
  planHpDir,
  type LubePlan,
} from '@mechdost/db/lube-import';
import { applyHpImport, diffHpImport } from '@mechdost/db/repo';
import { planHindiLeftovers, readPicture } from '@mechdost/db/battery-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-hp-', readPicture);
const brand = lubeReportBrand({
  name: 'HP lubricants',
  stem: 'hp',
  sourceNote: 'hplubricants.in scrape (`hp_lubricants_products.csv`, `hp_lubricants_grades.csv`)',
});

runBatteryImport<LubePlan>({
  name: 'HP',
  folder: 'hp_lubricants',
  stem: 'hp',
  hindiFile: 'packages/db/src/lube-import/ (hindi.ts, features-hi-hp.ts, hindi-allowed.ts)',
  planDir: planHpDir,
  acceptsPacks: true,
  hindiLeftovers: planHindiLeftovers,
  diff: diffHpImport,
  apply: applyHpImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: lubeStatusCsv,
  statusMarkdown: (plan, meta) => lubeStatusMarkdown(brand, plan, meta),
  archivedCsv: lubeArchivedCsv,
  extraFiles: (plan) => [{ name: 'hp-import-skipped.csv', content: lubeSkippedCsv(plan) }],
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
    research: plan.research
      ? {
          rows: plan.research.rows,
          productsWithPacks: plan.research.productsWithPacks,
          packs: plan.research.packs,
          withMrp: plan.research.withMrp,
          lowConfidence: plan.research.lowConfidence.length,
          conflicts: plan.research.conflicts.length,
          unmatched: plan.research.unmatched.length,
          unreadable: plan.research.unreadable.length,
        }
      : undefined,
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
