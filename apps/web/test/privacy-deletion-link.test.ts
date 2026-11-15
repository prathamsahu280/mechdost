/**
 * Account → Privacy → "Delete my account" opens the one deletion request built by support tier 2 (Account → Support,
 * `DeletionRequestApi`), not a second system (merge 2026-11-15; was the placeholder `topic=account_deletion`, Q140).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_DELETION_HOOK, DELETION_SECTION_ID } from '../src/lib/privacy-hooks';

describe('privacy deletion link', () => {
  it('goes to the support page at the deletion request section', () => {
    expect(ACCOUNT_DELETION_HOOK.path).toBe('/account/support');
    expect(ACCOUNT_DELETION_HOOK.hash).toBe(DELETION_SECTION_ID);
    expect('query' in ACCOUNT_DELETION_HOOK).toBe(false);
  });

  it('the deletion request section carries that id', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src', 'components', 'support', 'deletion-request-api.tsx'),
      'utf8',
    );
    expect(src).toMatch(/id=\{DELETION_SECTION_ID\}/);
  });
});
