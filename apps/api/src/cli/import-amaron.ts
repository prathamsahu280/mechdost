/**
 * `pnpm db:import:amaron --dir <amaron_batteries folder> [--dry-run | --plan-only] [--skip-photos] [--staff-user <uuid>]`
 * (user 2026-11-23; runbook `docs/runbooks/catalogue-import.md` "Amaron import"). The shared steps are in
 * `battery-import.ts`.
 */
import {
  amaronArchivedCsv,
  amaronHindiLeftovers,
  amaronStatusCsv,
  amaronStatusMarkdown,
  type AmaronPlan,
  planAmaronDir,
  readPicture,
} from '@mechdost/db/amaron';
import { applyAmaronImport, diffAmaronImport } from '@mechdost/db/repo';
import { runBatteryImport } from './battery-import';

runBatteryImport<AmaronPlan>({
  name: 'Amaron',
  folder: 'amaron_batteries',
  stem: 'amaron',
  hindiFile: 'packages/db/src/amaron/hindi.ts',
  planDir: planAmaronDir,
  hindiLeftovers: amaronHindiLeftovers,
  diff: diffAmaronImport,
  apply: applyAmaronImport,
  readPicture,
  statusCsv: amaronStatusCsv,
  statusMarkdown: amaronStatusMarkdown,
  archivedCsv: amaronArchivedCsv,
  summaryExtras: (plan) => ({
    combos: plan.combos,
    notInFinder: plan.notInFinder.map((n) => ({ slug: n.slug, category: n.category })),
  }),
}).catch((err: unknown) => {
  process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
