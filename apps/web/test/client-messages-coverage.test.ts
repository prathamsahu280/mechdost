/**
 * Every client component's text namespace reaches the browser (UI state audit 2026-11-16, chunk G: real-sign-in
 * screens showed raw keys such as `workshopTier1.f_low` — MISSING_MESSAGE for workshopTier1, supportThread,
 * workshopAnalytics, portal and refunds — because the page's `ClientMessages` list did not name them; the same bug hit
 * `shopTier1` on 2026-11-15). For each page, follow its imports, collect `useTranslations('ns')` in client modules, and
 * check that the page or one of its layouts passes every such namespace to `ClientMessages` (or that the page is under
 * a layout that provides all messages). A namespace may be a part of one (`ustaad.admin`, 2026-11-26).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '..', 'src');
const appDir = join(srcDir, 'app', '[locale]');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const slash = (p: string) => p.split('\\').join('/');
const cache = new Map<string, string>();
const read = (file: string) => {
  let s = cache.get(file);
  if (s === undefined) {
    s = readFileSync(file, 'utf8');
    cache.set(file, s);
  }
  return s;
};

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Files reachable from `entry` (static and dynamic imports inside src). */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)) {
      const next = resolveImport(file, m[1] ?? '');
      if (next && /\.(tsx?|ts)$/.test(next)) stack.push(next);
    }
  }
  return [...seen];
}

/** Namespaces used by client modules reachable from `entry` (static and dynamic imports). */
function clientNamespaces(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const found = new Map<string, string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (/^['"]use client['"]/m.test(text)) {
      for (const m of text.matchAll(/useTranslations\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const ns = m[1] ?? '';
        if (!found.has(ns)) found.set(ns, file.slice(srcDir.length + 1));
      }
    }
    for (const m of text.matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)) {
      const next = resolveImport(file, m[1] ?? '');
      if (next && /\.(tsx?|ts)$/.test(next)) stack.push(next);
    }
  }
  return found;
}

/** Namespaces given to `ClientMessages` in a file (string literals in the `namespaces` array). */
function provided(file: string): Set<string> {
  const out = new Set<string>();
  const text = read(file);
  // The whole `namespaces={...}` expression (inline arrays and `DATA_MODE === 'api' ? [...] : [...]` alike).
  for (let at = text.indexOf('namespaces={'); at >= 0; at = text.indexOf('namespaces={', at + 1)) {
    let depth = 0;
    let end = at + 'namespaces='.length;
    for (; end < text.length; end += 1) {
      const ch = text[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    for (const n of text.slice(at, end).matchAll(/'([A-Za-z0-9_.]+)'/g)) out.add(n[1] ?? '');
  }
  return out;
}

describe('client message bundles cover every client component', () => {
  it('each page (with its layouts) provides the namespaces its client components use', () => {
    const missing: string[] = [];
    for (const page of walk(appDir).filter((f) => /[\\/]page\.tsx$/.test(f))) {
      const used = clientNamespaces(page);
      if (used.size === 0) continue;
      const have = new Set<string>();
      let all = false;
      // The page, its layouts, and every file they reach (shells such as account-shell.tsx hold ClientMessages).
      const roots = [page];
      for (let dir = dirname(page); dir.startsWith(appDir); dir = dirname(dir)) {
        const layout = join(dir, 'layout.tsx');
        if (existsSync(layout)) roots.push(layout);
        if (dir === appDir) break;
      }
      for (const root of roots)
        for (const f of reachable(root)) {
          for (const ns of provided(f)) have.add(ns);
          // A provider without a namespace list passes every message.
          if (/<NextIntlClientProvider(?![^>]*messages=)/.test(read(f))) all = true;
        }
      if (all) continue;
      for (const [ns, via] of used)
        // A namespace is covered by itself or by any namespace it is part of (`pages` covers `pages.shop`).
        if (!ns.split('.').some((_, i, parts) => have.has(parts.slice(0, i + 1).join('.'))))
          missing.push(`${slash(page.slice(appDir.length + 1))}: ${ns} (used in ${slash(via)})`);
    }
    expect(missing).toEqual([]);
    // Walks every page's import graph: about 2 s alone, over 5 s while the whole suite runs in parallel.
  }, 30_000);
});
