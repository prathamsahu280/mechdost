/**
 * User 2026-11-22 (Q213): change password in Profile → Security, "Delete my account" moved into Profile, a coloured
 * "Sign out" at the top right of the header. Source guards: the delete button lives only in the Security card, the
 * header island loads the sign-out code on the click (JS budget), the button stays 44 px with text from sm.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const json = (l: string) =>
  JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'i18n', l), 'utf8'),
  ) as {
    account: Record<string, string>;
    auth: Record<string, string>;
  };

describe('Profile → Security', () => {
  const card = src('components/account/security-card.tsx');
  it('holds the delete request link and the change-password form', () => {
    expect(card).toContain('ACCOUNT_DELETION_HOOK');
    expect(card).toContain('data-track="privacy_delete_request"');
    expect(card).toContain('validatePasswordChange');
    expect(card).toMatch(/import\('@\/lib\/auth\/firebase-client'\)/);
    expect(card).not.toMatch(/from '@\/lib\/auth\/firebase-client'/);
  });
  it('Privacy no longer has a delete button', () => {
    const privacy = src('components/account/privacy-section-api.tsx');
    expect(privacy).not.toContain('ACCOUNT_DELETION_HOOK');
    expect(privacy).not.toContain('privacy_delete_request');
  });
  it('only the Profile screen mounts the card, lazily', () => {
    const sections = src('components/account/account-api-sections.tsx');
    expect(sections).toMatch(/lazy\(\(\) => import\('\.\/security-card'\)/);
    expect(sections).toContain('<SecurityCard');
  });
  it('the Firebase client re-authenticates before updating the password', () => {
    const client = src('lib/auth/firebase-client.ts');
    const body = /export async function changePassword[\s\S]*?\n}\n/.exec(client)?.[0] ?? '';
    expect(body.indexOf('reauthenticateWithCredential')).toBeGreaterThan(-1);
    expect(body.indexOf('reauthenticateWithCredential')).toBeLessThan(body.indexOf('updatePassword'));
  });
  it('has every string in English and Hindi', () => {
    for (const l of ['en.json', 'hi.json']) {
      const j = json(l);
      for (const k of [
        'securityTitle',
        'pwTitle',
        'pwHelp',
        'pwCurrent',
        'pwNew',
        'pwConfirm',
        'pwSubmit',
        'pwChanged',
        'pwErrCurrent',
        'pwErrSame',
        'pwFail_wrong_current',
        'pwFail_weak',
        'pwFail_rate',
        'pwFail_recent',
        'pwFail_network',
        'pwFail_unavailable',
      ])
        expect(j.account[k], `${l} account.${k}`).toBeTruthy();
      expect(j.auth.signedOutStatus, `${l} auth.signedOutStatus`).toBeTruthy();
    }
  });
});

/**
 * Sign out moved into the account menu (v4 header, user-approved 2026-11-23): the standalone coloured header button is
 * gone; "Sign out" is the last row of the menu, in the error colour.
 */
describe('header Sign out (in the account menu)', () => {
  const menu = src('components/auth/account-menu.tsx');
  const panel = src('components/auth/account-menu-panel.tsx');
  it('loads the sign-out code only on the click', () => {
    expect(panel).toMatch(/import\('@\/lib\/auth\/sign-out'\)/);
    for (const s of [menu, panel]) {
      expect(s).not.toMatch(/from '@\/lib\/auth\/sign-out'/);
      expect(s).not.toMatch(/from '@\/demo\/session'/);
      expect(s).not.toMatch(/from 'next\/dynamic'/);
    }
  });
  it('is the last menu row, a menuitem in the error colour with a 44 px target, that goes home and says so', () => {
    const row = panel.slice(panel.indexOf('data-track="header_sign_out"'));
    expect(row).toContain('role="menuitem"');
    expect(row).toContain('text-error');
    expect(panel).toContain('min-h-11');
    expect(row).toContain('copy.signOut');
    // Goes home with a fresh load once the session has ended (bug 2026-11-23, test/sign-out-clean.test.ts).
    expect(row).toMatch(/m\.signOutEverywhere\(\)/);
    expect(menu).toContain('role="status"');
    expect(menu).toContain('setSaid(true)');
  });
  it('the header passes the labels from the server', () => {
    const header = src('components/site/header.tsx');
    expect(header).toContain("signOut: auth('signOut')");
    expect(header).toContain("signedOut: auth('signedOutStatus')");
  });
  it('the old standalone header Sign out button is gone', () => {
    expect(src('components/site/header.tsx')).not.toContain('header_sign_out');
    expect(menu).not.toContain('header_sign_out');
  });
});
