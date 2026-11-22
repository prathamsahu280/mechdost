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

describe('header Sign out', () => {
  const link = src('components/auth/account-link.tsx');
  it('loads the sign-out code only on the click', () => {
    expect(link).toMatch(/import\('@\/lib\/auth\/sign-out'\)/);
    expect(link).not.toMatch(/from '@\/lib\/auth\/sign-out'/);
    expect(link).not.toMatch(/from '@\/demo\/session'/);
    expect(link).not.toMatch(/from 'next\/dynamic'/);
  });
  it('is a coloured 44 px button with text from sm, an accessible name before, and goes home with a status', () => {
    expect(link).toContain('min-h-11');
    expect(link).toContain('bg-accent-soft');
    expect(link).toContain('text-accent-soft-text');
    expect(link).toContain('sr-only sm:not-sr-only nav:sr-only xl:not-sr-only');
    expect(link).toContain('title={signOut}');
    expect(link).toContain('role="status"');
    expect(link).toMatch(/router\.push\(prefix \|\| '\/'\)/);
  });
  it('the header passes the labels from the server', () => {
    const header = src('components/site/header.tsx');
    expect(header).toContain("signOut={auth('signOut')}");
    expect(header).toContain("signedOut={auth('signedOutStatus')}");
  });
});
