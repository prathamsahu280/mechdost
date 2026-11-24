import { randomInt } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { decryptField, encryptField, safeEqual, type Keyring } from '../crypto';
import { rsaArrivalCodes, serviceArrivalCodes } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';

/**
 * The arrival code of a home visit (spec 06, design 2026-11-15) or a roadside job (spec 22): a 4-digit code the
 * customer shows the mechanic. Same protection as the delivery code (`delivery.ts`): stored encrypted (the customer can
 * read it again on the request page), compared in constant time, the attempt is reserved before any comparison so
 * parallel guesses never get more than 5 comparisons, and the code locks after 5 wrong tries. Only an audited admin
 * override gets past a lock. It lives in its own row so guesses never bump the request's `version`. This module never
 * moves the request: the caller does that in the same transaction. `kind` picks the table: home visits (`service`,
 * the default) or roadside jobs (`rsa`); both tables have the same columns and their own AAD.
 */
export const ARRIVAL_CODE_MAX_ATTEMPTS = 5;

export type ArrivalKind = 'service' | 'rsa';

/** The two tables are column-for-column the same, so one typed view serves both. */
function storeOf(kind: ArrivalKind): { table: typeof serviceArrivalCodes; aad: string } {
  return kind === 'rsa'
    ? {
        table: rsaArrivalCodes as unknown as typeof serviceArrivalCodes,
        aad: 'rsa_arrival_codes.code_enc',
      }
    : { table: serviceArrivalCodes, aad: 'service_arrival_codes.code_enc' };
}

/** Issues the code when the customer confirms a home visit or a roadside offer is accepted; a re-issue resets the attempt counter. */
export async function issueArrivalCode(
  tx: Tx,
  keyring: Keyring | null,
  requestId: string,
  kind: ArrivalKind = 'service',
): Promise<void> {
  if (!keyring)
    throw new ConflictError('Arrival codes are not configured on this server', 'ARRIVAL_CODES_UNAVAILABLE');
  const { table, aad } = storeOf(kind);
  const codeEnc = encryptField(String(randomInt(0, 10_000)).padStart(4, '0'), keyring, aad);
  await tx
    .insert(table)
    .values({ requestId, codeEnc })
    .onConflictDoUpdate({ target: table.requestId, set: { codeEnc, attempts: 0 } });
}

/** The customer's code (decrypted) and whether it is locked; null when none was issued. */
export async function readArrivalCode(
  tx: Tx,
  keyring: Keyring | null,
  requestId: string,
  kind: ArrivalKind = 'service',
): Promise<{ code: string | null; locked: boolean } | null> {
  const { table, aad } = storeOf(kind);
  const [row] = await tx
    .select({ enc: table.codeEnc, attempts: table.attempts })
    .from(table)
    .where(eq(table.requestId, requestId))
    .limit(1);
  if (!row) return null;
  return {
    code: keyring ? decryptField(row.enc, keyring, aad) : null,
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
  kind: ArrivalKind = 'service',
): Promise<ArrivalCheck> {
  if (!keyring)
    throw new ConflictError('Arrival codes are not configured on this server', 'ARRIVAL_CODES_UNAVAILABLE');
  if (!entered || !/^\d{4}$/.test(entered))
    throw new ValidationError('Enter the 4-digit arrival code', 'ARRIVAL_CODE_FORMAT');
  const { table, aad } = storeOf(kind);
  const [reserved] = await tx
    .update(table)
    .set({ attempts: sql`${table.attempts} + 1` })
    .where(and(eq(table.requestId, requestId), lt(table.attempts, ARRIVAL_CODE_MAX_ATTEMPTS)))
    .returning({ enc: table.codeEnc, attempts: table.attempts });
  if (!reserved) {
    const [row] = await tx
      .select({ attempts: table.attempts })
      .from(table)
      .where(eq(table.requestId, requestId))
      .limit(1);
    if (!row) throw new NotFoundError('No arrival code was issued');
    return { ok: false, reason: 'locked' };
  }
  if (safeEqual(entered, decryptField(reserved.enc, keyring, aad))) return { ok: true };
  return reserved.attempts >= ARRIVAL_CODE_MAX_ATTEMPTS
    ? { ok: false, reason: 'locked' }
    : { ok: false, reason: 'wrong', attemptsLeft: ARRIVAL_CODE_MAX_ATTEMPTS - reserved.attempts };
}
