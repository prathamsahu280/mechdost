// Overnight runner for the UI state audit (runbook docs/runbooks/ui-test-catalogue.md § 9). Runs the checklist in
// chunks, one after another (one browser at a time: low-memory machine), writes each chunk's log, JSON report and
// failure screenshots under apps/web/test-results/state-audit-<date>/<chunk>/ (git-ignored), and ticks
// docs/qa/ui-state-checklist.md after every chunk, so an interrupted night still leaves its results.
// Needs a current production build (`pnpm --filter @mechdost/web build`). A server already on :3100 is reused.
// Chunk G (the real-sign-in screens) runs with playwright.state-audit-api.config.ts against the real-mode build
// (node scripts/state-audit-api-build.mjs, runbook § 9.7): `all` leaves it out, name it (G) or add --api.
// Usage (repo root): node apps/web/scripts/state-audit-run.mjs [A B C D E F G | all] [--api] [--date YYYY-MM-DD]
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHUNKS } from '../e2e/state-audit/cases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const args = process.argv.slice(2);
const at = args.indexOf('--date');
const date = at >= 0 ? args[at + 1] : new Date().toISOString().slice(0, 10);
const named = args.filter((a, i) => (at < 0 || (i !== at && i !== at + 1)) && a !== 'all' && a !== '--api');
const chunks =
  named.length > 0 ? named : Object.keys(CHUNKS).filter((c) => c !== 'G' || args.includes('--api'));
for (const c of chunks)
  if (!(c in CHUNKS)) {
    console.error(`unknown chunk ${c}; use ${Object.keys(CHUNKS).join(' ')} or all`);
    process.exit(2);
  }

let failed = false;
for (const chunk of chunks) {
  const dir = resolve(webDir, 'test-results', `state-audit-${date}`, chunk);
  mkdirSync(dir, { recursive: true });
  const report = resolve(dir, 'report.json');
  const log = openSync(resolve(dir, 'run.log'), 'w');
  const started = Date.now();
  console.log(`chunk ${chunk} (${CHUNKS[chunk]}) → ${dir}`);
  // One fixed command string (an argument array with shell: true is deprecated, learnings T47).
  const config = chunk === 'G' ? 'playwright.state-audit-api.config.ts' : 'playwright.state-audit.config.ts';
  const run = spawnSync(`pnpm exec playwright test -c ${config}`, {
    cwd: webDir,
    shell: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      STATE_AUDIT_ONLY: CHUNKS[chunk],
      STATE_AUDIT_REPORT: report,
      STATE_AUDIT_OUTPUT: resolve(dir, 'output'),
    },
  });
  closeSync(log);
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(`chunk ${chunk}: exit ${String(run.status)} after ${minutes} min`);
  if (run.status !== 0) failed = true;
  const tick = spawnSync(`node scripts/state-audit-tick.mjs "${report}" --date ${date}`, {
    cwd: webDir,
    shell: true,
    stdio: 'inherit',
  });
  if (tick.status !== 0) console.error(`chunk ${chunk}: ticking failed (is the report there? see run.log)`);
}
process.exit(failed ? 1 : 0);
