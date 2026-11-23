/** The email link page (/auth/action, 2026-11-23): query parsing, Firebase error mapping, safe continue URL. */
import { describe, expect, it } from 'vitest';
import { CLIENT_EVENT_SCHEMAS } from '@mechdost/shared/analytics';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import { actionFailFor, parseActionParams, safeContinuePath } from '../src/lib/auth/email-action';

const q = (s: string) => new URLSearchParams(s);

describe('parseActionParams', () => {
  it('reads every mode Firebase sends', () => {
    for (const mode of ['verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail'])
      expect(parseActionParams(q(`mode=${mode}&oobCode=abcDEF123_-xyz`)).mode).toBe(mode);
  });
  it('drops unknown modes and malformed codes', () => {
    expect(parseActionParams(q('mode=revertSecondFactorAddition&oobCode=abcDEF123')).mode).toBeNull();
    expect(parseActionParams(q('mode=verifyEmail&oobCode=short')).oobCode).toBeNull();
    expect(parseActionParams(q('mode=verifyEmail&oobCode=has space and <tags>')).oobCode).toBeNull();
    expect(parseActionParams(q('')).oobCode).toBeNull();
  });
});

describe('actionFailFor', () => {
  it.each([
    ['auth/expired-action-code', 'expired'],
    ['auth/invalid-action-code', 'invalid'],
    ['auth/user-not-found', 'invalid'],
    ['auth/user-disabled', 'disabled'],
    ['auth/network-request-failed', 'network'],
    ['auth/weak-password', 'weak'],
    ['auth/internal-error', 'unavailable'],
    ['unknown', 'unavailable'],
  ])('%s -> %s', (code, reason) => {
    expect(actionFailFor(code)).toBe(reason);
  });
});

describe('safeContinuePath', () => {
  it('keeps same-site URLs and paths only', () => {
    expect(safeContinuePath('https://mechdost.com/orders?x=1', 'mechdost.com')).toBe('/orders?x=1');
    expect(safeContinuePath('/account', 'mechdost.com')).toBe('/account');
  });
  it('refuses other sites, protocol tricks and loops', () => {
    expect(safeContinuePath('https://evil.example/phish', 'mechdost.com')).toBeNull();
    expect(safeContinuePath('//evil.example/x', 'mechdost.com')).toBeNull();
    expect(safeContinuePath('javascript:alert(1)', 'mechdost.com')).toBeNull();
    expect(safeContinuePath('https://mechdost.com/auth/action?mode=x', 'mechdost.com')).toBeNull();
    expect(safeContinuePath(null, 'mechdost.com')).toBeNull();
  });
});

describe('email action analytics and copy', () => {
  it('accepts the typed events and rejects extra or free-text props', () => {
    expect(CLIENT_EVENT_SCHEMAS.auth_email_action_opened.safeParse({ mode: 'resetPassword' }).success).toBe(
      true,
    );
    expect(
      CLIENT_EVENT_SCHEMAS.auth_email_action_failed.safeParse({ mode: 'verifyEmail', code: 'missing' })
        .success,
    ).toBe(true);
    expect(
      CLIENT_EVENT_SCHEMAS.auth_email_action_failed.safeParse({ mode: 'verifyEmail', code: 'a@b.com' })
        .success,
    ).toBe(false);
    expect(CLIENT_EVENT_SCHEMAS.auth_password_reset_done.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });
  it('has the same copy keys in English and Hindi', () => {
    expect(Object.keys(hi.emailAction).sort()).toEqual(Object.keys(en.emailAction).sort());
  });
});
