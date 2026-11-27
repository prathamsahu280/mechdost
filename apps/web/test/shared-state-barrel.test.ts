import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Turbopack drops unused code per file, not per export: one value import from `@mechdost/shared/state` puts every
// machine of state/index.ts into every page (JS budget, 2026-11-27: /shop 180.2 KB gz). The modules every storefront
// page loads import the small files instead (`@mechdost/shared/state/reasons`); type-only imports are fine.
const ALWAYS_LOADED = ['../src/demo/store.ts', '../src/demo/session-state.ts', '../src/demo/session.ts'];

describe('always-loaded demo modules avoid the state barrel', () => {
  for (const rel of ALWAYS_LOADED) {
    it(rel, () => {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      const valueImports = [
        ...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'@mechdost\/shared\/state'/gms),
      ];
      expect(valueImports.map((m) => m[0])).toEqual([]);
    });
  }
});
