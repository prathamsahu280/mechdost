/**
 * A visually hidden file input (`sr-only`) that can take keyboard focus shows its focus ring on a 1 px clipped box, so
 * keyboard users cannot see where they are (WCAG 2.4.7; found in the merge review 2026-11-15). Each hidden file input
 * must either be out of the tab order (`tabIndex={-1}`, opened by a real button) or sit in/after a `file-pick` picker,
 * which draws the ring for it (globals.css).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('hidden file inputs show keyboard focus', () => {
  it('every sr-only file input is out of the tab order or inside a file-pick picker', () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('type="file"')) return;
        const input = lines.slice(i, i + 14).join('\n');
        if (!input.includes('sr-only')) return;
        const before = lines.slice(Math.max(0, i - 14), i).join('\n');
        if (input.includes('tabIndex={-1}') || before.includes('file-pick')) return;
        offenders.push(`${file.slice(root.length + 1)}:${String(i + 1)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the file-pick style draws the focus ring for a wrapped or following input', () => {
    const css = readFileSync(join(root, 'app', '[locale]', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.file-pick:has\(input\[type='file'\]:focus-visible\)/);
    expect(css).toMatch(/\.file-pick:has\(\+ input\[type='file'\]:focus-visible\)/);
  });
});
