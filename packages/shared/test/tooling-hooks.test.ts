/**
 * Project tooling that enforces hard rules mechanically (review 2026-11-11, T1/T2): the Claude Code commit guard
 * and the git commit-msg hook. Runs the real scripts. Attribution text is built from parts so this file itself
 * never looks like an attributed commit to the guard.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guard = join(root, '.claude', 'hooks', 'commit-guard.mjs');
const COAUTHOR = ['Co', 'Authored', 'By'].join('-') + ': Claude <noreply@anthropic.com>';
const GENERATED = ['Generated', 'with', 'Claude', 'Code'].join(' ');
const COMMIT = ['git', 'commit'].join(' ');

const runGuard = (command: string) =>
  spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });

describe('commit guard (Claude Code PreToolUse hook)', () => {
  it('blocks a commit carrying an AI co-author or "Generated with" line', () => {
    const blocked = runGuard(`${COMMIT} -m "fix: x\n\n${COAUTHOR}"`);
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toContain('hard rule 12');
    expect(runGuard(`${COMMIT} -m "docs: y\n\n${GENERATED}"`).status).toBe(2);
  });

  it('lets a clean commit and unrelated commands through', () => {
    expect(runGuard(`${COMMIT} -m "fix(api): illegal moves are 409"`).status).toBe(0);
    expect(runGuard('git status').status).toBe(0);
  });
});

describe('git commit-msg hook', () => {
  const run = (message: string) => {
    const file = join(mkdtempSync(join(tmpdir(), 'msg-')), 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    return spawnSync('sh', [join(root, '.githooks', 'commit-msg'), file], { encoding: 'utf8' });
  };

  it('refuses attribution lines and accepts a clean message', () => {
    expect(run(`fix: x\n\n${COAUTHOR}\n`).status).toBe(1);
    expect(run('fix: x\n\nRegular body text.\n').status).toBe(0);
  });
});
