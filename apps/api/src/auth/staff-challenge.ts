import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Keyring } from '@mechdost/db/crypto';
import { z } from 'zod';

/**
 * Staff sign-in challenge (decision 2026-11-25). The first call of the two-step staff sign-in has passed Cloudflare
 * and the password; it returns this token so the second call (with the phone ID token) does not need a second
 * Cloudflare check. `base64url(payload).base64url(HMAC)`, key derived from the data keyring's index key (never the
 * encryption key), the payload binds it to the user, their Firebase uid and phone, a 5-minute expiry and a random
 * nonce. Single use is enforced by the caller (the nonce is counted once in the fail-closed rate store).
 */
export const STAFF_CHALLENGE_TTL_SECONDS = 300;

export interface StaffChallengeInput {
  /** `users.id` of the staff member. */
  u: string;
  /** Firebase uid of the account. */
  f: string;
  /** The account's phone (E.164): the number the code was sent to. */
  p: string;
}

const Payload = z
  .object({
    u: z.string().min(1).max(64),
    f: z.string().min(1).max(128),
    p: z.string().min(1).max(20),
    exp: z.number().int(),
    n: z.string().min(8).max(32),
  })
  .strict();

const key = (keyring: Keyring) =>
  createHmac('sha256', keyring.indexKey).update('staff-challenge-v1').digest();
const mac = (keyring: Keyring, body: string) => createHmac('sha256', key(keyring)).update(body).digest();

export function signStaffChallenge(keyring: Keyring, input: StaffChallengeInput, now = Date.now()): string {
  const payload = {
    ...input,
    exp: Math.floor(now / 1000) + STAFF_CHALLENGE_TTL_SECONDS,
    n: randomBytes(12).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(keyring, body).toString('base64url')}`;
}

/** The payload when the signature is ours and the token has not expired, otherwise null. */
export function readStaffChallenge(
  keyring: Keyring,
  token: string,
  now = Date.now(),
): (StaffChallengeInput & { nonce: string }) | null {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(keyring, body);
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = Payload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    if (p.exp < Math.floor(now / 1000)) return null;
    return { u: p.u, f: p.f, p: p.p, nonce: p.n };
  } catch {
    return null;
  }
}
