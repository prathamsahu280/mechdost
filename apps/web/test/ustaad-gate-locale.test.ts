import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Ustaad gate renders in the layout's template outside the next-intl provider during static prerender, so it
// must not call useLocale (CI demo build failed on /[locale]/ustaad/area, 2026-11-27). The layout passes the locale.
describe('UstaadGate gets the locale from its layout', () => {
  const gate = readFileSync(
    new URL('../src/components/ustaad/shell/ustaad-gate.tsx', import.meta.url),
    'utf8',
  );
  const layout = readFileSync(new URL('../src/app/[locale]/ustaad/layout.tsx', import.meta.url), 'utf8');
  it('the gate does not call useLocale', () => {
    expect(gate).not.toMatch(/useLocale\(/);
  });
  it('the layout passes locale to the gate', () => {
    expect(layout).toMatch(/<UstaadGate[^>]*\blocale=\{locale\}/s);
  });
});
