import { describe, expect, it } from 'vitest';
import { InternalPathDto, isSafeInternalPath } from '../src/ustaad/paths';

/** Security review of commit 3b080568 (open redirect / validator differential on promotion targets). */
describe('isSafeInternalPath', () => {
  it.each([
    '//evil.com',
    '/\\evil.com',
    '/%2F%2Fevil.com',
    '/ok\n//evil',
    '/\tx',
    'https://x',
    'javascript:alert(1)',
    '',
    'shop',
    '/shop\\..\\admin',
    '/a b',
    '/x?y=\u0000',
    `/${'a'.repeat(400)}`,
  ])('refuses %j', (v) => {
    expect(isSafeInternalPath(v)).toBe(false);
    expect(InternalPathDto.safeParse(v).success).toBe(false);
  });

  it.each(['/shop?x=1', '/ustaad/learn', '/', '/shop/batteries#top', '/offers?code=DIWALI-25', '/a;b'])(
    'accepts %j',
    (v) => {
      expect(isSafeInternalPath(v)).toBe(true);
      expect(InternalPathDto.safeParse(v).success).toBe(true);
    },
  );
});
