/**
 * `pnpm db:import:servo --dir <servo_lubricants folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--concurrency N] [--staff-user <uuid>]` (user 2026-11-25; runbook
 * `docs/runbooks/catalogue-import.md` "Servo import"). Only automotive products with a picture (IndiaMART seller
 * photos) are imported; every other row is listed in the report with its reason. Seller prices are not MRPs: every
 * pack is price on request. Old products of brands servo and iocl that are not in the plan are archived.
 */
import {
  lubeArchivedCsv,
  lubeReportBrand,
  lubeSkippedCsv,
  lubeStatusCsv,
  lubeStatusMarkdown,
  planServoDir,
  type LubePlan,
} from '@mechdost/db/lube-import';
import { applyServoImport, diffServoImport } from '@mechdost/db/repo';
import { planHindiLeftovers, readPicture } from '@mechdost/db/battery-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-servo-', readPicture);
const brand = lubeReportBrand({
  name: 'IOCL Servo lubricants',
  stem: 'servo',
  sourceNote: 'iocl.com data sheets and IndiaMART listings (`servo_lubricants_products.csv`)',
});

runBatteryImport<LubePlan>({
  name: 'Servo',
  folder: 'servo_lubricants',
  stem: 'servo',
  hindiFile: 'packages/db/src/lube-import/ (hindi.ts, features-hi-servo.ts, hindi-allowed.ts)',
  planDir: planServoDir,
  hindiLeftovers: planHindiLeftovers,
  diff: diffServoImport,
  apply: applyServoImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: lubeStatusCsv,
  statusMarkdown: (plan, meta) => lubeStatusMarkdown(brand, plan, meta),
  archivedCsv: lubeArchivedCsv,
  extraFiles: (plan) => [{ name: 'servo-import-skipped.csv', content: lubeSkippedCsv(plan) }],
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
