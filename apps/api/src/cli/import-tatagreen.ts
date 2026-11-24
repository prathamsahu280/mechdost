/**
 * `pnpm db:import:tatagreen --dir <tatagreen_batteries folder> [--dry-run | --plan-only] [--skip-photos]
 * [--skip-photos-for <names | @list.txt>] [--staff-user <uuid>]` (user 2026-11-24; runbook
 * `docs/runbooks/catalogue-import.md` "Tata Green import"). The shared steps are in `battery-import.ts`.
 *
 * Pictures: the source folder is never touched. Each picture is evened out in memory by `normaliseProductPicture`
 * (plain border trimmed, product centred on a square canvas, at most 1600 px, at most 2x enlarged) and a copy is
 * written to a temp folder (printed at the end) so the result can be looked at. Watermarks, site URLs and logos are
 * never painted out: a picture that carries one is left out with `--skip-photos-for`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { normaliseProductPicture } from '../photos/normalise';
import { runBatteryImport } from './battery-import';

const stats = { processed: 0, trimmed: 0, enlarged: 0, reduced: 0, matte: 0 };
const cache = new Map<string, Promise<Buffer>>();
let outDir: string | null = null;

/** The picture as the pipeline gets it: normalised once per file, a copy kept in the temp folder. */
function normalisedPicture(dir: string, file: string): Promise<Buffer> {
  let hit = cache.get(file);
  if (!hit) {
    hit = normaliseProductPicture(readPicture(dir, file)).then((n) => {
      stats.processed += 1;
      if (n.trimmed) stats.trimmed += 1;
      if (n.scale > 1.001) stats.enlarged += 1;
      if (n.scale < 0.999) stats.reduced += 1;
      if (n.background === 'matte') stats.matte += 1;
      outDir ??= mkdtempSync(join(tmpdir(), 'mechdost-tatagreen-'));
      const name = `${String(stats.processed).padStart(3, '0')}-${file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}.png`;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, name.replace(/[^\w. ()-]+/g, '_')), n.data);
      return n.data;
    });
    cache.set(file, hit);
  }
  return hit;
}

runBatteryImport<TataGreenPlan>({
  name: 'Tata Green',
  folder: 'tatagreen_batteries',
  stem: 'tatagreen',
  hindiFile: 'packages/db/src/tatagreen/hindi.ts',
  planDir: planTataGreenDir,
  hindiLeftovers: tataGreenHindiLeftovers,
  diff: diffTataGreenImport,
  apply: applyTataGreenImport,
  readPicture: normalisedPicture,
  statusCsv: tataGreenStatusCsv,
  statusMarkdown: tataGreenStatusMarkdown,
  archivedCsv: tataGreenArchivedCsv,
  summaryExtras: (plan) => ({
    noPhoto: plan.noPhoto,
    reclassified: plan.reclassified.map((r) => ({ slug: r.slug, category: r.category })),
  }),
})
  .then(() => {
    if (stats.processed > 0)
      process.stderr.write(`pictures normalised: ${JSON.stringify(stats)}; copies in ${outDir ?? ''}\n`);
  })
  .catch((err: unknown) => {
    process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
