/**
 * `pnpm db:import:tatagreen --dir <tatagreen_batteries folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--staff-user <uuid>]` (user 2026-11-24; runbook
 * `docs/runbooks/catalogue-import.md` "Tata Green import"). The shared steps are in `battery-import.ts`; the picture
 * normaliser step is in `normalised-pictures.ts`.
 */
import {
  planTataGreenDir,
  readPicture,
  tataGreenArchivedCsv,
  tataGreenHindiLeftovers,
  tataGreenStatusCsv,
  tataGreenStatusMarkdown,
  type TataGreenPlan,
} from '@mechdost/db/tatagreen';
import { applyTataGreenImport, diffTataGreenImport } from '@mechdost/db/repo';
import { runBatteryImport } from './battery-import';
import { normalisedPictures } from './normalised-pictures';

const pictures = normalisedPictures('mechdost-tatagreen-', readPicture);

runBatteryImport<TataGreenPlan>({
  name: 'Tata Green',
  folder: 'tatagreen_batteries',
  stem: 'tatagreen',
  hindiFile: 'packages/db/src/tatagreen/hindi.ts',
  planDir: planTataGreenDir,
  hindiLeftovers: tataGreenHindiLeftovers,
  diff: diffTataGreenImport,
  apply: applyTataGreenImport,
  readPicture: (dir, file) => pictures.read(dir, file),
  statusCsv: tataGreenStatusCsv,
  statusMarkdown: tataGreenStatusMarkdown,
  archivedCsv: tataGreenArchivedCsv,
  summaryExtras: (plan) => ({
    noPhoto: plan.noPhoto,
    reclassified: plan.reclassified.map((r) => ({ slug: r.slug, category: r.category })),
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
