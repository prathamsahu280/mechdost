/**
 * A staff member's name is user-written text (hard rule 10 allowlist) and must be marked so the Hindi gate and screen
 * readers treat it as such (audit run 2, 2026-11-16: API-SHOP-STAFF "Audit User" on /hi).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('staff names are marked as user text', () => {
  it('staff performance rows mark the member name', () => {
    expect(read('components/portal/shop-staff-performance-api.tsx')).toMatch(
      /<span data-user-content className="font-bold text-ink">\s*\{m\.name/,
    );
  });
  it('the remove question renders the name in a marked span', () => {
    expect(en.shopTier1.teamRemoveAsk).toContain('<who>{name}</who>');
    expect(hi.shopTier1.teamRemoveAsk).toContain('<who>{name}</who>');
    expect(read('components/portal/shop-team-api.tsx')).toMatch(/t\.rich\('teamRemoveAsk'/);
  });
});
