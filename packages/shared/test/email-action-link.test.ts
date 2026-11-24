/** Email action links on our own domain (decision 2026-11-24): reading the code out of a Firebase link, building ours. */
import { describe, expect, it } from 'vitest';
import { emailActionPath, oobCodeFromLink } from '../src/email-action-link';

const REAL =
  'https://mechdost-dev.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=AbC_123-xyz0987654&apiKey=k&lang=en';
const EMULATOR =
  'http://127.0.0.1:9099/emulator/action?mode=verifyEmail&lang=en&oobCode=emu-code-12345678&apiKey=fake-api-key';

describe('oobCodeFromLink', () => {
  it('takes the code from a Firebase link, real or from the Auth Emulator', () => {
    expect(oobCodeFromLink(REAL, 'resetPassword')).toBe('AbC_123-xyz0987654');
    expect(oobCodeFromLink(EMULATOR, 'verifyEmail')).toBe('emu-code-12345678');
  });

  it('refuses a link for another mode, without a code, with an odd code, or that is not a URL', () => {
    expect(oobCodeFromLink(REAL, 'verifyEmail')).toBeNull();
    expect(oobCodeFromLink('https://x.test/a?mode=resetPassword', 'resetPassword')).toBeNull();
    expect(oobCodeFromLink('https://x.test/a?mode=resetPassword&oobCode=short', 'resetPassword')).toBeNull();
    expect(
      oobCodeFromLink('https://x.test/a?mode=resetPassword&oobCode=bad%20code%20here!!', 'resetPassword'),
    ).toBeNull();
    expect(oobCodeFromLink('not a url', 'resetPassword')).toBeNull();
  });
});

describe('emailActionPath', () => {
  it('builds mode, oobCode and lang, escaping anything odd', () => {
    expect(emailActionPath({ mode: 'resetPassword', oobCode: 'abc_DEF-123456', lang: 'hi' })).toBe(
      '/auth/action?mode=resetPassword&oobCode=abc_DEF-123456&lang=hi',
    );
    expect(emailActionPath({ mode: 'a&b', oobCode: 'x y', lang: 'en' })).toBe(
      '/auth/action?mode=a%26b&oobCode=x+y&lang=en',
    );
  });

  it('defaults the language to English', () => {
    expect(emailActionPath({ mode: 'verifyEmail', oobCode: 'abcdefgh' })).toContain('lang=en');
  });
});
