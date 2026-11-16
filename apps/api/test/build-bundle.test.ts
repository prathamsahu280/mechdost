import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deploy runs `dist/server.mjs` and `dist/worker.mjs`. A bundle with a syntax error (2026-11-16: `createRequire`
 * declared twice, banner + bill PDF fonts) passed every unit test and crash-looped the worker on the server, so the
 * real bundles are built and syntax-checked here.
 */
describe('production bundles', () => {
  it('build and parse (node --check)', { timeout: 180_000 }, () => {
    const root = join(__dirname, '..');
    execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'pipe' });
    const bundles = readdirSync(join(root, 'dist')).filter((f) => f.endsWith('.mjs'));
    expect(bundles).toEqual(expect.arrayContaining(['server.mjs', 'worker.mjs']));
    for (const f of bundles) {
      expect(
        () => execFileSync(process.execPath, ['--check', join(root, 'dist', f)], { stdio: 'pipe' }),
        f,
      ).not.toThrow();
    }
  });
});
