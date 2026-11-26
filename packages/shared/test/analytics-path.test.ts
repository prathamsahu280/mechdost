import { describe, expect, it } from 'vitest';
import { ANALYTICS_PATH } from '../src/analytics';
import { redactPath } from '../src/analytics-path';

describe('analytics paths never carry secrets (security review 2026-11-13)', () => {
  it('replaces an invite token in the path, in both languages', () => {
    expect(redactPath('/partners/invite/e2e-invite-token-0001')).toBe('/partners/invite/:token');
    expect(redactPath('/hi/partners/invite/abcDEF_123/extra')).toBe('/hi/partners/invite/:token');
    expect(redactPath('/partners/apply/seller')).toBe('/partners/apply/seller');
  });

  it('replaces the garage-owner link token (Ustaad, SR-6), in both languages', () => {
    const token = 'a'.repeat(64);
    expect(redactPath(`/ustaad-attest/${token}`)).toBe('/ustaad-attest/:token');
    expect(redactPath(`/hi/ustaad-attest/${token}`)).toBe('/hi/ustaad-attest/:token');
  });

  it('the API path schema applies the same redaction', () => {
    expect(ANALYTICS_PATH.parse('/partners/invite/secret-token?x=1')).toBe('/partners/invite/:token');
  });
});
