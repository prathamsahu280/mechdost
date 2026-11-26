/** The delivery-agent invite link carries a one-time token (spec 24): analytics keeps the route, never the token. */
import { describe, expect, it } from 'vitest';
import { redactPath } from '@mechdost/shared/analytics-path';

describe('delivery invite token redaction', () => {
  it('drops the token from /partners/delivery-invite/<token> in both languages', () => {
    expect(redactPath('/partners/delivery-invite/abcdef0123456789abcdef0123456789')).toBe(
      '/partners/delivery-invite/:token',
    );
    expect(redactPath('/hi/partners/delivery-invite/abcdef0123456789abcdef0123456789')).toBe(
      '/hi/partners/delivery-invite/:token',
    );
  });
});
