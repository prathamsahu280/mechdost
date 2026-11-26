/**
 * Ustaad public codes (spec 23 § 6): `UQ-` questions, `UJ-` jobs, `UR-` reports. The DB CHECKs use RFC 4648 base32
 * (`A–Z`, `2–7`), unlike the marketplace codes (Crockford, `ids.ts`), so the generator lives here.
 */
import { istYear } from '../time';

const RFC4648 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function ustaadPublicCode(prefix: 'UQ' | 'UJ' | 'UR', cityCode: string, at: Date = new Date()): string {
  if (!/^[A-Z]{3}$/.test(cityCode)) throw new RangeError(`Invalid city code: ${cityCode}`);
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  // 32 divides 256, so `b & 31` is unbiased.
  for (const b of bytes) out += RFC4648.charAt(b & 31);
  return `${prefix}-${cityCode}-${String(istYear(at))}-${out}`;
}
