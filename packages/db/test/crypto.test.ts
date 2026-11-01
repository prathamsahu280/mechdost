import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CryptoConfigError,
  DecryptError,
  blindIndex,
  decryptField,
  encryptField,
  isEncrypted,
  loadKeyring,
  needsRotation,
} from '../src/crypto';

const k = () => randomBytes(32).toString('base64');
const env = (keys: string, current: string) => ({
  DATA_ENCRYPTION_KEYS: keys,
  DATA_ENCRYPTION_KEY_ID: current,
  DATA_INDEX_KEY: k(),
});

describe('field encryption (spec 13)', () => {
  const ring = loadKeyring(env(`k1:${k()}`, 'k1'));

  it('round-trips and never stores the plain value', () => {
    const value = encryptField('ABCDE1234F', ring, 'shops.pan_enc');
    expect(isEncrypted(value)).toBe(true);
    expect(value).not.toContain('ABCDE1234F');
    expect(decryptField(value, ring, 'shops.pan_enc')).toBe('ABCDE1234F');
    // Unicode survives (Hindi names in KYC details).
    const hindi = encryptField('{"name":"रवि साहू"}', ring, 'partner_applications.kyc_enc');
    expect(decryptField(hindi, ring, 'partner_applications.kyc_enc')).toBe('{"name":"रवि साहू"}');
  });

  it('uses a fresh IV every time, so equal values do not look equal', () => {
    expect(encryptField('same', ring, 'a.b')).not.toBe(encryptField('same', ring, 'a.b'));
  });

  it('rejects tampering, a value moved to another column, and garbage', () => {
    const value = encryptField('secret', ring, 'staff_security.totp_secret_enc');
    const parts = value.split('.');
    const flipped = [...parts.slice(0, 3), `A${(parts[3] ?? '').slice(1)}`, parts[4]].join('.');
    expect(() => decryptField(flipped, ring, 'staff_security.totp_secret_enc')).toThrow(DecryptError);
    expect(() => decryptField(value, ring, 'shops.pan_enc')).toThrow(DecryptError);
    expect(() => decryptField('plain text', ring, 'shops.pan_enc')).toThrow(DecryptError);
  });

  it('supports key rotation: old values still decrypt and are flagged for re-encryption', () => {
    const oldKey = k();
    const before = loadKeyring(env(`k1:${oldKey}`, 'k1'));
    const value = encryptField('UPI-ravi@okaxis', before, 'refunds.destination_enc');
    const after = loadKeyring(env(`k1:${oldKey},k2:${k()}`, 'k2'));
    expect(decryptField(value, after, 'refunds.destination_enc')).toBe('UPI-ravi@okaxis');
    expect(needsRotation(value, after)).toBe(true);
    expect(needsRotation(encryptField('x', after, 'a.b'), after)).toBe(false);
  });

  it('blind indexes are stable per purpose and differ across purposes', () => {
    expect(blindIndex('ABCDE1234F', ring, 'pan')).toBe(blindIndex('ABCDE1234F', ring, 'pan'));
    expect(blindIndex('ABCDE1234F', ring, 'pan')).not.toBe(blindIndex('ABCDE1234F', ring, 'gstin'));
  });

  it('refuses bad configuration', () => {
    expect(() => loadKeyring({})).toThrow(CryptoConfigError);
    expect(() => loadKeyring(env('k1:short', 'k1'))).toThrow(CryptoConfigError);
    expect(() => loadKeyring(env(`k1:${k()}`, 'k2'))).toThrow(CryptoConfigError);
  });
});
