/**
 * Public, human-readable identifiers (never the database primary key).
 * Format: PREFIX-CITY-YYYY-XXXXXX, e.g. MD-RPR-2026-7K3Q9X (orders), SR-… (service requests), REQ-… (tickets).
 * The random part is 6 Crockford base32 chars (~1.07e9 combinations per prefix/city/year) — non-guessable;
 * uniqueness is still enforced by a UNIQUE index and a retry on conflict (docs/specs/14-data-integrity.md).
 */
import { istYear } from './time';

/** Crockford base32: no I, L, O, U (avoids confusion when read over the phone). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^([A-Z]{2,4})-([A-Z]{3})-(\d{4})-([0-9A-HJKMNP-TV-Z]{6})$/;

/** Cryptographically random Crockford base32 string (32 divides 256, so `byte & 31` is unbiased). */
export function randomCode(length: number): string {
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new RangeError('length must be 1..64');
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b & 31];
  return out;
}

export type CodePrefix = 'MD' | 'SR' | 'REQ' | 'RET' | 'RF' | (string & {});

export function publicCode(prefix: CodePrefix, cityCode: string, at: Date = new Date()): string {
  if (!/^[A-Z]{2,4}$/.test(prefix)) throw new RangeError(`Invalid code prefix: ${prefix}`);
  if (!/^[A-Z]{3}$/.test(cityCode)) throw new RangeError(`Invalid city code: ${cityCode}`);
  return `${prefix}-${cityCode}-${istYear(at)}-${randomCode(6)}`;
}

export function isPublicCode(code: string, prefix?: CodePrefix): boolean {
  const m = CODE_RE.exec(code);
  return m !== null && (prefix === undefined || m[1] === prefix);
}
