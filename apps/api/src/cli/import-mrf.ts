/**
 * `pnpm db:import:mrf --dir <mrf_tyres folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--staff-user <uuid>]` (user 2026-11-24; runbook
 * `docs/runbooks/catalogue-import.md` "MRF tyre import"). The shared steps are in `battery-import.ts` (the brand
 * importers' CLI core) and the picture step in `normalised-pictures.ts`; pictures are per pattern and shared by all sizes.
 */
import { applyMrfImport, diffMrfImport } from '@mechdost/db/repo';
import { mrfArchivedCsv, mrfStatusCsv, mrfStatusMarkdown, planMrfDir, readPicture } from '@mechdost/db/mrf';
import { planHindiLeftovers, type TyrePlan } from '@mechdost/db/tyre-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-mrf-', readPicture);

runBatteryImport<TyrePlan>({
  name: 'MRF',
  folder: 'mrf_tyres',
  stem: 'mrf',
  hindiFile: 'packages/db/src/tyre-import/ (hindi.ts, features-hi-mrf.ts)',
  planDir: planMrfDir,
  hindiLeftovers: planHindiLeftovers,
  diff: diffMrfImport,
  apply: applyMrfImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: mrfStatusCsv,
  statusMarkdown: mrfStatusMarkdown,
  archivedCsv: mrfArchivedCsv,
  summaryExtras: (plan) => ({
    noPhoto: plan.noPhoto,
    sourceChecks: plan.checks.length,
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
