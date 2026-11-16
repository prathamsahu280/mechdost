/** Phone-code failures name their real reason (real-API QA pass 4, 2026-11-16). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { analyticsAuthCode, phoneSendFailFor } from '../src/lib/auth/auth-errors';

const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('phoneSendFailFor', () => {
  it('maps the app-credential and captcha codes to the security check', () => {
    for (const c of [
      'auth/invalid-app-credential',
      'auth/missing-app-credential',
      'auth/captcha-check-failed',
    ])
      expect(phoneSendFailFor(c)).toBe('captcha');
  });
  it('maps throttling codes to too many codes', () => {
    expect(phoneSendFailFor('auth/too-many-requests')).toBe('rate');
    expect(phoneSendFailFor('auth/quota-exceeded')).toBe('rate');
  });
  it('maps a dropped connection to its own reason', () => {
    expect(phoneSendFailFor('auth/network-request-failed')).toBe('network');
  });
  it('keeps the phone reason and falls back to unavailable', () => {
    expect(phoneSendFailFor('auth/invalid-phone-number')).toBe('phone');
    expect(phoneSendFailFor('auth/operation-not-allowed')).toBe('unavailable');
    expect(phoneSendFailFor('')).toBe('unavailable');
  });
});

describe('analyticsAuthCode', () => {
  it('keeps Firebase codes and never anything else', () => {
    expect(analyticsAuthCode('auth/network-request-failed')).toBe('auth/network-request-failed');
    expect(analyticsAuthCode('')).toBe('unknown');
    expect(analyticsAuthCode('+919876543210 failed')).toBe('unknown');
  });
  it('is accepted by the event schema', () => {
    const ok = CLIENT_EVENT_SCHEMAS.auth_code_failed.safeParse({
      stage: 'send',
      code: 'auth/quota-exceeded',
      path: '/login',
    });
    expect(ok.success).toBe(true);
  });
});

describe('sign-in copy', () => {
  it('has the network message and the no-name banner in both languages', () => {
    for (const l of [en, hi]) {
      expect(l.auth.errNetwork.length).toBeGreaterThan(5);
      expect(l.auth.alreadySignedInNoName).not.toContain('{name}');
      expect(l.shopTier2.statusErr_network.length).toBeGreaterThan(5);
    }
  });
  it('uses the no-name banner when the account has no name', () => {
    const src = read('components/auth/login-flow.tsx');
    expect(src).toContain("current.name ? t('alreadySignedIn'");
    expect(src).toContain("t('alreadySignedInNoName')");
  });
  it('tracks send and confirm failures by Firebase code', () => {
    const src = read('components/auth/login-flow.tsx');
    expect(src).toContain("track('auth_code_failed'");
    expect(src).toContain("stage: 'send'");
    expect(src).toContain("stage: 'confirm'");
  });
});
