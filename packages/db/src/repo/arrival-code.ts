import { randomInt } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { decryptField, encryptField, safeEqual, type Keyring } from '../crypto';
import { serviceArrivalCodes } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * The arrival code of a home visit (spec 06, design 2026-11-15): a 4-digit code the customer shows the mechanic at the
 * door. Same protection as the delivery code (`delivery.ts`): stored encrypted (the customer can read it again on the
 * request page), compared in constant time, the attempt is reserved before any comparison so parallel guesses never
 * get more than 5 comparisons, and the code locks after 5 wrong tries. Only an audited admin override gets past a
 * lock. It lives in its own row (`service_arrival_codes`) so guesses never bump the request's `version`. This module
 * never moves the request: the caller does that in the same transaction.
 */
export const ARRIVAL_CODE_MAX_ATTEMPTS = 5;
const AAD = 'service_arrival_codes.code_enc';

/** Issues the code when the customer confirms a home visit; a re-issue resets the attempt counter. */
export async function issueArrivalCode(tx: Tx, keyring: Keyring | null, requestId: string): Promise<void> {
  if (!keyring)
    throw new ConflictError('Arrival codes are not configured on this server', 'ARRIVAL_CODES_UNAVAILABLE');
  const codeEnc = encryptField(String(randomInt(0, 10_000)).padStart(4, '0'), keyring, AAD);
  await tx
    .insert(serviceArrivalCodes)
    .values({ requestId, codeEnc })
    .onConflictDoUpdate({ target: serviceArrivalCodes.requestId, set: { codeEnc, attempts: 0 } });
}

/** The customer's code (decrypted) and whether it is locked; null when none was issued. */
export async function readArrivalCode(
  tx: Tx,
  keyring: Keyring | null,
  requestId: string,
): Promise<{ code: string | null; locked: boolean } | null> {
  const [row] = await tx
    .select({ enc: serviceArrivalCodes.codeEnc, attempts: serviceArrivalCodes.attempts })
    .from(serviceArrivalCodes)
    .where(eq(serviceArrivalCodes.requestId, requestId))
    .limit(1);
  if (!row) return null;
  return {
    code: keyring ? decryptField(row.enc, keyring, AAD) : null,
    locked: row.attempts >= ARRIVAL_CODE_MAX_ATTEMPTS,
  };
}

export type ArrivalCheck =
  { ok: true } | { ok: false; reason: 'wrong'; attemptsLeft: number } | { ok: false; reason: 'locked' };

/** Checks the entered code; a wrong try is counted (the caller must commit it, so it returns instead of throwing). */
export async function verifyArrivalCode(
  tx: Tx,
  keyring: Keyring | null,
  requestId: string,
  entered: string | undefined,
): Promise<ArrivalCheck> {
  if (!keyring)
    throw new ConflictError('Arrival codes are not configured on this server', 'ARRIVAL_CODES_UNAVAILABLE');
  if (!entered || !/^\d{4}$/.test(entered))
    throw new ValidationError('Enter the 4-digit arrival code', 'ARRIVAL_CODE_FORMAT');
  const [reserved] = await tx
    .update(serviceArrivalCodes)
    .set({ attempts: sql`${serviceArrivalCodes.attempts} + 1` })
    .where(
      and(
        eq(serviceArrivalCodes.requestId, requestId),
        lt(serviceArrivalCodes.attempts, ARRIVAL_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ enc: serviceArrivalCodes.codeEnc, attempts: serviceArrivalCodes.attempts });
  if (!reserved) {
    const [row] = await tx
      .select({ attempts: serviceArrivalCodes.attempts })
      .from(serviceArrivalCodes)
      .where(eq(serviceArrivalCodes.requestId, requestId))
      .limit(1);
    if (!row) throw new NotFoundError('No arrival code was issued');
    return { ok: false, reason: 'locked' };
  }
  if (safeEqual(entered, decryptField(reserved.enc, keyring, AAD))) return { ok: true };
  return reserved.attempts >= ARRIVAL_CODE_MAX_ATTEMPTS
    ? { ok: false, reason: 'locked' }
    : { ok: false, reason: 'wrong', attemptsLeft: ARRIVAL_CODE_MAX_ATTEMPTS - reserved.attempts };
}
