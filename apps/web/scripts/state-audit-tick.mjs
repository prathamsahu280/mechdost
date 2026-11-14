// Ticks docs/qa/ui-state-checklist.md from a Playwright JSON report of the UI state audit: pass → [x] with the
// date, fail → [!] with the findings summary and a link to the failure screenshot; rewrites the "Run results"
// block. Usage (from the repo root):
//   node apps/web/scripts/state-audit-tick.mjs apps/web/test-results/state-audit-report.json [--date 2026-11-15]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { resultsFromReport, tickChecklist } from '../e2e/state-audit/checklist.ts';

const here = dirname(fileURLToPath(import.meta.url));
const checklist = resolve(here, '../../../docs/qa/ui-state-checklist.md');
const reportPath = process.argv[2];
if (!reportPath) {
  console.error(
    'usage: node apps/web/scripts/state-audit-tick.mjs <playwright-json-report> [--date YYYY-MM-DD]',
  );
  process.exit(2);
}
const at = process.argv.indexOf('--date');
const date = at > 0 ? process.argv[at + 1] : new Date().toISOString().slice(0, 10);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
// Screenshot paths in the report are absolute (or relative to apps/web): link them relative to the checklist.
const webDir = resolve(here, '..');
const toLink = (p) =>
  relative(dirname(checklist), isAbsolute(p) ? p : resolve(webDir, p))
    .split('\\')
    .join('/');
const results = resultsFromReport(report, toLink);
const md = readFileSync(checklist, 'utf8').replace(/\r\n/g, '\n');
const out = tickChecklist(md, results, date);
// Same formatting as `pnpm format`, so the ticked file passes `format:check` as written.
const formatted = await prettier.format(out.markdown, {
  ...(await prettier.resolveConfig(checklist)),
  filepath: checklist,
});
writeFileSync(checklist, formatted);
console.log(
  `ticked ${checklist}: ${String(out.passed)} passed, ${String(out.failed)} failed, ${String(out.skipped)} skipped, ${String(out.untouched)} not in this report`,
);
