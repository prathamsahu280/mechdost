// SessionStart hook (after compaction): put the ledger's NOW block and the task protocol back in context
// (CLAUDE.md hard rules 11 and 13; advisor learning L77 — skills were skipped after a compaction).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let now = '(docs/progress.md not readable — read it before anything else)';
try {
  const ledger = readFileSync(join(root, 'docs', 'progress.md'), 'utf8');
  const line = ledger.split('\n').find((l) => l.startsWith('- **NOW'));
  if (line) now = line.length > 2500 ? `${line.slice(0, 2500)}…` : line;
} catch {
  // keep the fallback text
}
process.stdout.write(
  [
    'MechDost resume (context was compacted):',
    '1. Read CLAUDE.md → docs/progress.md → docs/decisions.md → the current spec before acting.',
    '2. Every task starts with the mechdost-advisor skill and ends with code review + website-testing.',
    '3. Never add AI attribution to commits; commit only through the gates (pnpm check).',
    'Ledger NOW:',
    now,
    '',
  ].join('\n'),
);
