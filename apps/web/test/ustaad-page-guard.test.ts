import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Live 2026-11-28: signed out during the staff preview, /ustaad answered 404 but the HTML still carried the network's
// messages (name, tagline, banned-screen text) — Next renders a page in parallel with its layout, so the layout's
// notFound() alone does not stop the page's own ClientMessages. Every page runs the same guard first.
const root = fileURLToPath(new URL('../src/app/[locale]/ustaad', import.meta.url));
const pages = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : n === 'page.tsx' ? [p] : [];
  });

describe('every Mechanic Network page guards itself on the server', () => {
  const files = pages(root);
  it('finds the pages', () => {
    expect(files.length).toBeGreaterThan(20);
  });
  for (const f of files) {
    it(f.slice(root.length), () => {
      const src = readFileSync(f, 'utf8');
      if (/\bredirect\(/.test(src) && !src.includes('ClientMessages')) return; // redirect-only pages render nothing
      expect(src).toMatch(/await guardUstaadPage\(\)/);
    });
  }
  it('the guard 404s when the network is off or hidden from this viewer', () => {
    const g = readFileSync(new URL('../src/lib/ustaad/page-guard.ts', import.meta.url), 'utf8');
    expect(g).toMatch(/access === 'off'\) notFound\(\)/);
    expect(g).toMatch(/ustaadHiddenOnServer\(/);
  });
});
