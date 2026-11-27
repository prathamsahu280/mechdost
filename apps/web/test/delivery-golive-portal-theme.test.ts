/**
 * DC-P10 (QA 2026-11-27): the rider status strip was `bg-white` with the theme's `text-ink`, which turns light in dark
 * mode (~1.2:1). Theme text sits on a theme surface (`bg-surface`), so both themes pass WCAG 1.4.3.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('rider status strip uses theme tokens (DC-P10)', () => {
  it('no white background under theme ink text', () => {
    const src = readFileSync(new URL('../src/components/delivery/agent-portal.tsx', import.meta.url), 'utf8');
    const classes = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
      (m) => m[1] ?? m[2] ?? '',
    );
    expect(classes.filter((c) => c.includes('bg-white') && /\btext-ink\b/.test(c))).toEqual([]);
    expect(
      classes.filter((c) => c.includes('bg-surface') && /\btext-ink\b/.test(c)).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
