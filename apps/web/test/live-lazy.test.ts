import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Spec 16 (JS budget): the Firebase database SDK (`@firebase/database`, ~30 KB gz) must never enter a page's initial
 * JS (/shop and /cart sit near the 180 KB gate). Proven from the import graph, no build needed:
 *   1. only `lib/live/live-listener.ts` mentions the package;
 *   2. every reference to `live-listener` is a dynamic `import(...)`, and only `live-hub.ts` makes it;
 *   3. `live-hub.ts` (which header-adjacent code may import) pulls in no Firebase package;
 *   4. nothing in the header or layout path uses `next/dynamic` for it, or imports the hub statically.
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
const text = (path: string) => all.find((f) => f.path === path)?.text ?? '';

describe('the live listener loads lazily', () => {
  it('only live-listener.ts mentions @firebase/database', () => {
    expect(all.filter((f) => f.text.includes('@firebase/database')).map((f) => f.path)).toEqual([
      'lib/live/live-listener.ts',
    ]);
  });

  it('live-listener is only ever a dynamic import, made by live-hub', () => {
    for (const f of all) {
      if (f.path === 'lib/live/live-listener.ts') continue;
      expect(f.text, f.path).not.toMatch(/^\s*(import|export)\s[^;]*from\s+['"][^'"]*live-listener['"]/m);
    }
    const dynamic = all
      .filter((f) => /import\(\s*['"][^'"]*live-listener['"]\s*\)/.test(f.text))
      .map((f) => f.path);
    expect(dynamic).toEqual(['lib/live/live-hub.ts']);
  });

  it('the hub imports no Firebase package and no firebase-client', () => {
    expect(text('lib/live/live-hub.ts')).not.toMatch(/@firebase|firebase-client|from\s+['"]firebase/);
  });

  it('the header, layout and cart pill never import the hub or listener statically, nor use next/dynamic for it', () => {
    for (const path of [
      'components/site/header.tsx',
      'components/commerce/cart-pill.tsx',
      'components/notices/bell.tsx',
    ]) {
      expect(text(path), path).not.toMatch(/from\s+['"][^'"]*\/live\//);
      expect(text(path), path).not.toMatch(/from\s+['"]next\/dynamic['"]/);
    }
    const layouts = all.filter((f) => /^app\/(\[locale\]\/)?layout\.tsx$/.test(f.path));
    for (const f of layouts) expect(f.text, f.path).not.toMatch(/\/live\//);
  });

  it('only signed-in code starts it: cart sync and the notice feed, behind the configured check', () => {
    const starters = all
      .filter((f) => /\bstartLive\(/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(starters).toEqual([
      'components/notices/use-notice-feed.ts',
      'lib/live/live-hub.ts',
      'lib/storefront-sync.ts',
    ]);
    expect(text('lib/live/live-hub.ts')).toMatch(/AUTH_MODE === 'firebase'/);
  });

  it('sign-out resets the hub next to the cart reset', () => {
    expect(text('lib/auth/sign-out.ts')).toMatch(/live-hub'\)\.then\(\(m\) => \{\s*m\.resetLive\(\)/);
  });
});
