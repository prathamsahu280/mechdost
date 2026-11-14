import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec 16 (JS budget): the Firebase messaging library (`@firebase/messaging`, ~30 KB) may load only after a person
 * taps "Turn on" or "Turn off". The import graph proves it without a build:
 *   1. only `lib/push/enable-push.ts` mentions the package;
 *   2. every reference to `enable-push` anywhere is a dynamic `import(...)`, never a static `import ... from`;
 *   3. the bell's always-loaded shell imports nothing heavy (the bell chunk is itself a dynamic import).
 * A change that breaks any of these fails here, before it reaches a bundle.
 */
const src = fileURLToPath(new URL('../src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const all = files(src).map((path) => ({
  path: relative(src, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('Firebase messaging loads only after "Turn on"', () => {
  it('only enable-push.ts mentions @firebase/messaging', () => {
    const users = all.filter((f) => f.text.includes('@firebase/messaging')).map((f) => f.path);
    expect(users).toEqual(['lib/push/enable-push.ts']);
  });

  it('nothing imports enable-push statically', () => {
    for (const f of all) {
      if (f.path === 'lib/push/enable-push.ts') continue;
      expect(f.text, f.path).not.toMatch(/^\s*import\s[^;]*from\s+['"][^'"]*enable-push['"]/m);
      expect(f.text, f.path).not.toMatch(/^\s*export\s[^;]*from\s+['"][^'"]*enable-push['"]/m);
    }
    const dynamic = all.filter((f) => /import\(\s*['"][^'"]*enable-push['"]\s*\)/.test(f.text));
    expect(dynamic.length).toBeGreaterThan(0);
  });

  it('the Turn on button asks the browser only inside the tap handler (no permission call on load)', () => {
    const calls = all.filter((f) => /requestPermission\s*\(/.test(f.text)).map((f) => f.path);
    expect(calls).toEqual(['lib/push/enable-push.ts']);
    const card = all.find((f) => f.path === 'components/notices/push-card.tsx')?.text ?? '';
    // enablePush runs from click handlers (`turnOn`), never from an effect.
    expect(card).not.toMatch(/useEffect\([^)]*enablePush/s);
  });

  it('the bell shell loads its chunk dynamically and imports no API or Firebase code itself', () => {
    const shell = all.find((f) => f.path === 'components/notices/bell.tsx')?.text ?? '';
    expect(shell).toMatch(/dynamic\(\(\) => import\('\.\/bell-controller'\)/);
    expect(shell).not.toMatch(/from\s+['"]@\/lib\/(notices-api|push|auth\/firebase)/);
    expect(shell).not.toMatch(/@firebase|firebase\//);
  });

  it('no always-loaded module imports the Firebase app or auth SDK for the bell or push', () => {
    for (const path of [
      'components/site/header.tsx',
      'components/notices/bell.tsx',
      'components/notices/use-notice-refresh.ts',
      'components/notices/push-prompt-slot.tsx',
      'lib/notices-view.ts',
      'lib/push/push-state.ts',
    ]) {
      const text = all.find((f) => f.path === path)?.text ?? '';
      expect(text, path).not.toMatch(/from\s+['"]@firebase\//);
    }
  });
});
