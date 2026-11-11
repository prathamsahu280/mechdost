// Stop hook (warn only, never blocks): source changed but the ledger did not (CLAUDE.md hard rule 13).
import { execFileSync } from 'node:child_process';

let status = '';
try {
  status = execFileSync('git', ['status', '--porcelain'], {
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  });
} catch {
  process.exit(0);
}
const files = status
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3).trim());
const sourceChanged = files.some((f) => /^(apps|packages)\//.test(f));
const ledgerChanged = files.includes('docs/progress.md');
if (sourceChanged && !ledgerChanged) {
  process.stdout.write(
    JSON.stringify({
      systemMessage:
        'Reminder: code changed but docs/progress.md did not. Update the ledger (and the spec/decisions) before moving on.',
    }),
  );
}
process.exit(0);
