/**
 * The staff challenge in the browser (2026-11-25): used once, kept through a mistyped code, and a refused one falls
 * back to a real Cloudflare check without the person doing anything.
 */
import { describe, expect, it } from 'vitest';
import { attemptWithProof, createChallengeSlot } from '../src/lib/auth/sign-in-retry';

type R = { ok: true } | { ok: false; reason: 'turnstile' | 'invalid' };
const refused = (r: R) => !r.ok && r.reason === 'turnstile';

describe('challenge slot', () => {
  it('survives a wrong code (nothing takes it) and is spent by the first take', () => {
    const slot = createChallengeSlot();
    slot.set('signed.token');
    expect(slot.has()).toBe(true); // a wrong code returns before taking: the next try still has it
    expect(slot.take()).toBe('signed.token');
    expect(slot.has()).toBe(false);
    expect(slot.take()).toBe('');
  });

  it('is emptied when going back to sign-in, and ignores an absent challenge', () => {
    const slot = createChallengeSlot();
    slot.set('x');
    slot.clear();
    expect(slot.has()).toBe(false);
    slot.set(undefined);
    expect(slot.has()).toBe(false);
  });
});

describe('attemptWithProof', () => {
  it('uses the proof and never asks for a bot check when the API accepts it', async () => {
    let checks = 0;
    const r = await attemptWithProof<R>({
      proof: 'p',
      withProof: () => Promise.resolve({ ok: true }),
      withCheck: () => {
        checks += 1;
        return Promise.resolve({ ok: true });
      },
      refused,
    });
    expect(r).toEqual({ ok: true });
    expect(checks).toBe(0);
  });

  it('falls back to one real check when the proof is refused, and does not send the proof twice', async () => {
    const proofs: string[] = [];
    let checks = 0;
    const r = await attemptWithProof<R>({
      proof: 'p',
      withProof: (p) => {
        proofs.push(p);
        return Promise.resolve({ ok: false, reason: 'turnstile' });
      },
      withCheck: () => {
        checks += 1;
        return Promise.resolve({ ok: true });
      },
      refused,
    });
    expect(r).toEqual({ ok: true });
    expect(proofs).toEqual(['p']);
    expect(checks).toBe(1);
  });

  it('without a proof it is the plain bot-check path, retried once on a refused token', async () => {
    let checks = 0;
    const r = await attemptWithProof<R>({
      proof: undefined,
      withProof: () => Promise.reject(new Error('unused')),
      withCheck: () => {
        checks += 1;
        return Promise.resolve(checks === 1 ? { ok: false, reason: 'turnstile' } : { ok: true });
      },
      refused,
    });
    expect(r).toEqual({ ok: true });
    expect(checks).toBe(2);
  });

  it('a wrong password is not retried', async () => {
    let calls = 0;
    const r = await attemptWithProof<R>({
      proof: 'p',
      withProof: () => {
        calls += 1;
        return Promise.resolve({ ok: false, reason: 'invalid' });
      },
      withCheck: () => Promise.resolve({ ok: true }),
      refused,
    });
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(calls).toBe(1);
  });
});
