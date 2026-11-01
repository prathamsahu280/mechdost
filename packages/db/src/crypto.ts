import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Application-level field encryption for sensitive columns (decision 2026-11-01 "Encryption"; spec 13).
 * Supabase already encrypts the whole database and its backups at rest (AES-256); this second layer means a
 * leaked dump, a log line or an over-broad query never exposes PAN numbers, KYC details, bank/UPI details or
 * staff 2FA secrets.
 *
 * Format (enforced by CHECK constraints in Postgres): `v1.<keyId>.<iv>.<ciphertext>.<tag>` (base64url parts).
 * AES-256-GCM, a fresh random 96-bit IV per value, and the column name as additional authenticated data, so a
 * value copied into another column fails to decrypt. Keys come from the environment / Secret Manager only.
 * Server-only: never import from apps/web.
 */
export const ENVELOPE_PATTERN =
  '^v1\\.[A-Za-z0-9_-]{1,16}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]{22}$';
const ENVELOPE = new RegExp(ENVELOPE_PATTERN);

export interface Keyring {
  /** Key used for new values. */
  currentId: string;
  keys: ReadonlyMap<string, Buffer>;
  /** Separate key for blind indexes (lookups without decrypting). */
  indexKey: Buffer;
}

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigError';
  }
}

export class DecryptError extends Error {
  constructor() {
    super('Encrypted value could not be decrypted');
    this.name = 'DecryptError';
  }
}

function key32(b64: string, what: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new CryptoConfigError(`${what} must be 32 bytes, base64-encoded`);
  return key;
}

/**
 * Reads `DATA_ENCRYPTION_KEYS` ("id:base64key,id2:base64key"), `DATA_ENCRYPTION_KEY_ID` (the current id) and
 * `DATA_INDEX_KEY`. Old keys stay listed after a rotation so existing values still decrypt.
 */
export function loadKeyring(env: Record<string, string | undefined>): Keyring {
  const list = env.DATA_ENCRYPTION_KEYS?.trim();
  const currentId = env.DATA_ENCRYPTION_KEY_ID?.trim();
  const index = env.DATA_INDEX_KEY?.trim();
  if (!list || !currentId || !index) {
    throw new CryptoConfigError(
      'DATA_ENCRYPTION_KEYS, DATA_ENCRYPTION_KEY_ID and DATA_INDEX_KEY are required',
    );
  }
  const keys = new Map<string, Buffer>();
  for (const entry of list.split(',')) {
    const [id, b64] = entry.split(':');
    if (!id || !b64 || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) {
      throw new CryptoConfigError('DATA_ENCRYPTION_KEYS entries look like "k1:<base64 32-byte key>"');
    }
    keys.set(id, key32(b64, `Encryption key ${id}`));
  }
  if (!keys.has(currentId))
    throw new CryptoConfigError(`DATA_ENCRYPTION_KEY_ID "${currentId}" is not in the keyring`);
  return { currentId, keys, indexKey: key32(index, 'DATA_INDEX_KEY') };
}

/** Encrypts `plain` for one column (`aad` = "table.column"). */
export function encryptField(plain: string, keyring: Keyring, aad: string): string {
  const key = keyring.keys.get(keyring.currentId);
  if (!key) throw new CryptoConfigError('Current encryption key missing');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    keyring.currentId,
    iv.toString('base64url'),
    body.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

/** Decrypts a value written by `encryptField` for the same column; throws DecryptError if tampered or moved. */
export function decryptField(value: string, keyring: Keyring, aad: string): string {
  if (!ENVELOPE.test(value)) throw new DecryptError();
  const [, keyId = '', iv = '', body = '', tag = ''] = value.split('.');
  const key = keyring.keys.get(keyId);
  if (!key) throw new DecryptError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new DecryptError();
  }
}

export function isEncrypted(value: string): boolean {
  return ENVELOPE.test(value);
}

/** True when a value was written with an older key and should be re-encrypted (key rotation job). */
export function needsRotation(value: string, keyring: Keyring): boolean {
  return value.split('.')[1] !== keyring.currentId;
}

/**
 * Deterministic keyed hash for equality lookups and UNIQUE indexes on encrypted data (e.g. "is this PAN already
 * registered?"). Normalise first (trim, upper-case) so formatting differences do not create duplicates.
 */
export function blindIndex(value: string, keyring: Keyring, purpose: string): string {
  return createHmac('sha256', keyring.indexKey).update(`${purpose}\u0000${value}`).digest('base64url');
}

/** Constant-time comparison for secrets such as tokens. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
