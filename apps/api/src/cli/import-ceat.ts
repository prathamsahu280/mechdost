/**
 * `pnpm db:import:ceat --dir <ceat_tyres folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--staff-user <uuid>]` (user 2026-11-24; runbook
 * `docs/runbooks/catalogue-import.md` "CEAT tyre import"). The shared steps are in `battery-import.ts` (the brand
 * importers' CLI core) and the picture step in `normalised-pictures.ts`; pictures are per pattern and shared by all sizes.
 */
import {
  ceatArchivedCsv,
  ceatStatusCsv,
  ceatStatusMarkdown,
  planCeatDir,
  readPicture,
} from '@mechdost/db/ceat';
import { applyCeatImport, diffCeatImport } from '@mechdost/db/repo';
import { planHindiLeftovers, type TyrePlan } from '@mechdost/db/tyre-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-ceat-', readPicture);

runBatteryImport<TyrePlan>({
  name: 'CEAT',
  folder: 'ceat_tyres',
  stem: 'ceat',
  hindiFile: 'packages/db/src/tyre-import/ (hindi.ts, features-hi-ceat.ts)',
  planDir: planCeatDir,
  hindiLeftovers: planHindiLeftovers,
  diff: diffCeatImport,
  apply: applyCeatImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: ceatStatusCsv,
  statusMarkdown: ceatStatusMarkdown,
  archivedCsv: ceatArchivedCsv,
  summaryExtras: (plan) => ({
    priceOnRequestWithHiddenPrice: plan.priceOnRequest.filter((p) => p.siteDataPaise !== null).length,
    noPhoto: plan.noPhoto,
    sourceChecks: plan.checks.length,
    orphanFitment: plan.orphanFitment,
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
