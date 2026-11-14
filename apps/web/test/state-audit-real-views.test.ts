import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REAL_MODE_VIEWS } from '../e2e/state-audit/model.ts';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe('real-API-mode views in the UI state model', () => {
  it('lists views whose component file exists, with unique codes and at least three states', () => {
    const codes = REAL_MODE_VIEWS.map((v) => v.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const v of REAL_MODE_VIEWS) {
      expect(existsSync(root(v.file)), v.file).toBe(true);
      expect(v.states.length, v.code).toBeGreaterThanOrEqual(3);
      expect(v.reach.length, v.code).toBeGreaterThan(10);
    }
  });

  it('the give-up and warnings views take every text from the shopGiveUp locale namespace', () => {
    for (const file of ['shop-give-up.tsx', 'shop-warnings-api.tsx', 'admin-shop-warnings.tsx']) {
      const src = readFileSync(root(`src/components/portal/${file}`), 'utf8');
      expect(src).toContain("useTranslations('shopGiveUp')");
    }
  });
});
