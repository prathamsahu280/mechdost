// Writes docs/qa/ui-state-checklist.md from the UI state model (apps/web/e2e/state-audit/model.ts), keeping the
// ticks and results of every line whose state did not change, formatted with the repo's Prettier settings. Node
// runs the TypeScript sources directly (type stripping, Node 24).
// Usage (repo root): node apps/web/scripts/state-audit-checklist.mjs [--check]
//   --check  exit 1 when the file differs from the model (the Vitest sync test does the same in `pnpm check`)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { buildCases } from '../e2e/state-audit/cases.ts';
import { mergeChecklist, renderChecklist } from '../e2e/state-audit/checklist.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../../docs/qa/ui-state-checklist.md');
const fresh = renderChecklist(buildCases());
const existing = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
const merged = existing ? mergeChecklist(existing, fresh) : fresh;
const next = await prettier.format(merged, {
  ...(await prettier.resolveConfig(target)),
  filepath: target,
});

if (process.argv.includes('--check')) {
  if (next !== existing) {
    console.error(
      'docs/qa/ui-state-checklist.md is out of date: run node apps/web/scripts/state-audit-checklist.mjs',
    );
    process.exit(1);
  }
  console.log('checklist up to date');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, next);
  const items = next.split('\n').filter((l) => /^- \[[ x!]\] /.test(l)).length;
  console.log(`wrote ${target} (${String(items)} items)`);
}
