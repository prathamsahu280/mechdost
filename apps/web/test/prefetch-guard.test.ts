/**
 * User report 2026-11-24: after "Forgot password?" the reset button felt slow ("it is not like I click and it
 * processes"). The early Cloudflare check was refused for 60 s after the sign-in form started one, so the reset form
 * only began its check on submit. The guard is keyed by the container element now.
 */
import { describe, expect, it } from 'vitest';
import { PREFETCH_REUSE_MS, shouldPrefetch } from '@/lib/auth/sign-in-retry';

const el = () => ({ isConnected: true });

describe('shouldPrefetch', () => {
  it('starts the check for a form that never had one', () => {
    expect(shouldPrefetch(null, el(), 1000)).toBe(true);
  });

  it('does nothing when the form has no check container (a step without the Cloudflare check)', () => {
    expect(shouldPrefetch(null, null, 1000)).toBe(false);
  });

  it('starts a new check for a swapped-in form even seconds after the previous form started one', () => {
    const signIn = el();
    const reset = el(); // "Forgot password?" mounts a new container
    expect(shouldPrefetch({ el: signIn, at: 1000 }, reset, 3000)).toBe(true);
  });

  it('does not start a second check in the same container inside the reuse window, and does after it', () => {
    const form = el();
    expect(shouldPrefetch({ el: form, at: 1000 }, form, 1000 + PREFETCH_REUSE_MS - 1)).toBe(false);
    expect(shouldPrefetch({ el: form, at: 1000 }, form, 1000 + PREFETCH_REUSE_MS)).toBe(true);
  });
});
