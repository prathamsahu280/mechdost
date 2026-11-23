/**
 * `pnpm db:import:exide --dir <exide_batteries folder> [--dry-run | --plan-only] [--skip-photos] [--staff-user <uuid>]`
 * (user 2026-11-23; runbook `docs/runbooks/catalogue-import.md` "Exide import"). The shared steps are in
 * `battery-import.ts`.
 */
import { applyExideImport, diffExideImport, type ExideRunResult } from '@mechdost/db/repo';
import {
  exideArchivedCsv,
  exideHindiLeftovers,
  exideStatusCsv,
  exideStatusMarkdown,
  planExideDir,
  readPicture,
} from '@mechdost/db/exide';
import { runBatteryImport } from './battery-import';

runBatteryImport({
  name: 'Exide',
  folder: 'exide_batteries',
  stem: 'exide',
  hindiFile: 'packages/db/src/exide/hindi.ts',
  planDir: planExideDir,
  hindiLeftovers: exideHindiLeftovers,
  diff: diffExideImport,
  apply: (tx, products, opts): Promise<ExideRunResult> => applyExideImport(tx, products, opts),
  readPicture,
  statusCsv: exideStatusCsv,
  statusMarkdown: exideStatusMarkdown,
  archivedCsv: exideArchivedCsv,
  summaryExtras: () => ({}),
}).catch((err: unknown) => {
  process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
