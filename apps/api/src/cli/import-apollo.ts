/**
 * `pnpm db:import:apollo --dir <apollo_tyres folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--staff-user <uuid>]` (user 2026-11-24; runbook
 * `docs/runbooks/catalogue-import.md` "Apollo tyre import"). India only: shop-only rows and brochure-only sizes are
 * dropped and listed in the report. The shared steps are in `battery-import.ts` and the picture step in
 * `normalised-pictures.ts`; pictures are per pattern and shared by all sizes (brochure images are never used).
 */
import {
  apolloArchivedCsv,
  apolloDroppedCsv,
  apolloStatusCsv,
  apolloStatusMarkdown,
  planApolloDir,
  readPicture,
  type ApolloPlan,
} from '@mechdost/db/apollo';
import { applyApolloImport, diffApolloImport } from '@mechdost/db/repo';
import { planHindiLeftovers } from '@mechdost/db/tyre-import';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-apollo-', readPicture);

runBatteryImport<ApolloPlan>({
  name: 'Apollo',
  folder: 'apollo_tyres',
  stem: 'apollo',
  hindiFile: 'packages/db/src/tyre-import/ (hindi.ts, features-hi-apollo.ts)',
  planDir: planApolloDir,
  hindiLeftovers: planHindiLeftovers,
  diff: diffApolloImport,
  apply: applyApolloImport,
  sharePhotos: true,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: apolloStatusCsv,
  statusMarkdown: apolloStatusMarkdown,
  archivedCsv: apolloArchivedCsv,
  extraFiles: (plan) => [{ name: 'apollo-import-dropped.csv', content: apolloDroppedCsv(plan) }],
  summaryExtras: (plan) => ({
    dropped: plan.dropped.length,
    droppedByReason: plan.dropped.reduce<Record<string, number>>((acc, d) => {
      acc[d.reason] = (acc[d.reason] ?? 0) + 1;
      return acc;
    }, {}),
    fitmentUnmatched: plan.fitmentUnmatched,
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
