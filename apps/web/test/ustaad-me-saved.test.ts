import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

/** Me gets one row to Saved (spec 23 § 21i, 2026-11-28); the rest of Me is not restyled. */
describe('Me: one entry row to Saved', () => {
  const src = readFileSync(new URL('../src/components/ustaad/card/next-level.tsx', import.meta.url), 'utf8');
  it('links to /ustaad/saved with the existing shortcut event', () => {
    expect(src).toContain("href: '/ustaad/saved'");
    expect(src).toContain("to: 'saved'");
    expect(src).toContain("t('shortcutSaved')");
  });
  it('has the row text in English and Hindi', () => {
    const e = (en as unknown as { ustaad: { card: Record<string, string> } }).ustaad.card.shortcutSaved;
    const h = (hi as unknown as { ustaad: { card: Record<string, string> } }).ustaad.card.shortcutSaved;
    expect(e).toBeTruthy();
    expect(h).toBeTruthy();
  });
});
