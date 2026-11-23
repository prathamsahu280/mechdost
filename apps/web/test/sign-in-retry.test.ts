import { describe, expect, it, vi } from 'vitest';
import { isTransientAuthCode, retryOnce, tokenUsable, TOKEN_MAX_AGE_MS } from '../src/lib/auth/sign-in-retry';

describe('sign-in retry helpers (2026-11-23)', () => {
  it('uses a held Turnstile token only while it is young', () => {
    expect(tokenUsable(1_000, 1_000 + TOKEN_MAX_AGE_MS - 1)).toBe(true);
    expect(tokenUsable(1_000, 1_000 + TOKEN_MAX_AGE_MS)).toBe(false);
    expect(tokenUsable(5_000, 1_000)).toBe(false);
  });

  it('retries once when the result was transient, and returns the second result', async () => {
    const attempt = vi.fn().mockResolvedValueOnce('turnstile').mockResolvedValueOnce('signed_in');
    await expect(retryOnce(attempt, (r) => r === 'turnstile')).resolves.toBe('signed_in');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never retries twice', async () => {
    const attempt = vi.fn().mockResolvedValue('turnstile');
    await expect(retryOnce(attempt, (r) => r === 'turnstile')).resolves.toBe('turnstile');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('does not retry a final answer such as a wrong password', async () => {
    const attempt = vi.fn().mockResolvedValue('invalid');
    await expect(retryOnce(attempt, (r) => r === 'turnstile')).resolves.toBe('invalid');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('treats only network blips as transient Firebase codes', () => {
    expect(isTransientAuthCode('auth/network-request-failed')).toBe(true);
    expect(isTransientAuthCode('auth/invalid-custom-token')).toBe(false);
    expect(isTransientAuthCode(undefined)).toBe(false);
  });
});
