// PreToolUse hook (Bash/PowerShell `git commit`): CLAUDE.md hard rule 12 — no AI attribution in commits.
// Reads the tool call as JSON on stdin; exit 2 blocks the call and shows stderr to Claude.
import { readFileSync } from 'node:fs';

const ATTRIBUTION = /co-authored-by:|generated with[^\n]*claude|🤖 generated/i;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0); // not our business if the payload is unreadable
}
const command = String(input?.tool_input?.command ?? '');
if (/\bgit\b[^\n]*\bcommit\b/.test(command) && ATTRIBUTION.test(command)) {
  process.stderr.write(
    'Blocked by .claude/hooks/commit-guard.mjs: CLAUDE.md hard rule 12 forbids AI attribution lines ' +
      '(Co-Authored-By, "Generated with Claude Code") in commits. Remove them and commit again.\n',
  );
  process.exit(2);
}
process.exit(0);
