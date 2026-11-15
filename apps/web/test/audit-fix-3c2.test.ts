/**
 * Full re-run on GitHub, builder 3c-2 (2026-11-16): source guards for the fixes whose geometry the audit measures.
 * - Shop Availability: the hours select and "Set busy" stay inside their card at 320 px.
 * - The "action rows aligned" rule compares the card foot (bottom), not the top of a taller wrapped button.
 * - The audit's "errors" step presses an ENABLED submit only (a disabled Send waited out the 90 s budget).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..');
const read = (p: string) => readFileSync(join(web, p), 'utf8');

describe('shop availability card (320 px)', () => {
  const s = read('src/components/portal/shop-busy-api.tsx');
  it('lets the select shrink and wraps the hours group under "Closed today"', () => {
    expect(s).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(s).toMatch(/min-w-\[14rem\] flex-1/);
    expect(s).toMatch(/portalField\} mt-1 min-w-0/);
    expect(s).not.toMatch(/shrink-0/);
  });
});

describe('audit checker truth', () => {
  it('aligns action rows by the card foot', () => {
    const g = read('e2e/state-audit/geometry.ts');
    // The foot is the last control's bottom, widened to a panel that ends with it (batch 3c-4, `footBottom`).
    expect(g).toMatch(/let foot = last\.getBoundingClientRect\(\)\.bottom;/);
  });
  it('presses enabled submit buttons only, with a short timeout', () => {
    const h = read('e2e/state-audit/harness.ts');
    expect(h).toContain(`SUBMIT_SELECTOR = 'form button[type="submit"]:visible:enabled'`);
    expect(h).toMatch(/submit\.click\(\{ timeout: 3_000 \}\)/);
  });
});
