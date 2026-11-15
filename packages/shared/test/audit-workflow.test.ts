/**
 * The full UI state audit runs on GitHub in parallel shards (user 2026-11-16: "offload some to github actions to
 * speed things up"; the low-memory PC took hours per chunk). Both builds are covered: demo (chunks A-F) and the
 * real-sign-in build with the mocked API (chunk G). Every action is pinned by full commit SHA (hard rule 4).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  join(__dirname, '..', '..', '..', '.github', 'workflows', 'ui-state-audit.yml'),
  'utf8',
);

describe('UI state audit workflow', () => {
  it('splits the run into parallel shards', () => {
    expect(workflow).toMatch(/shard: \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/);
    expect(workflow).toContain('--shard=${{ matrix.shard }}/10');
    expect(workflow).toContain('fail-fast: false');
  });

  it('runs chunk G against the real-sign-in build with the mocked API', () => {
    expect(workflow).toContain('options: [demo, api]');
    expect(workflow).toContain('node apps/web/scripts/state-audit-api-build.mjs');
    expect(workflow).toContain('playwright.state-audit-api.config.ts');
  });

  it('keeps one report per shard and never commits', () => {
    expect(workflow).toContain('state-audit-report-${{ inputs.mode }}-${{ matrix.shard }}.json');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toMatch(/git (commit|push)/);
  });

  it('pins every action by full commit SHA', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe('visual review workflow (2026-11-16)', () => {
  const visual = readFileSync(
    join(__dirname, '..', '..', '..', '.github', 'workflows', 'visual-review.yml'),
    'utf8',
  );
  it('captures in parallel shards, never commits and pins every action', () => {
    expect(visual).toContain('--shard=${{ matrix.shard }}/5');
    expect(visual).toContain('VISUAL_SHOTS');
    expect(visual).toContain('contents: read');
    expect(visual).not.toMatch(/git (commit|push)/);
    for (const u of [...visual.matchAll(/uses: (\S+)/g)].map((m) => m[1] ?? ''))
      expect(u, u).toMatch(/@[0-9a-f]{40}$/);
  });
});
