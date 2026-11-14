import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Keyring } from '@mechdost/db/crypto';
import { PHOTO_URL_TTL_SECONDS } from '@mechdost/shared/service-photos';

/**
 * Image URLs for the browser. An `<img>` cannot send the bearer token, so the API issues, after its rights check
 * on the listing request, a URL carrying an expiry and an HMAC over (photo media id, expiry). The HMAC key is derived
 * from the data keyring's index key (never the Storage key, which never leaves the server); the URL is good for
 * 10 minutes and for that one photo only. Public gallery photos need no token: the image route re-checks the public
 * setting and the job's status on every read.
 */
const key = (keyring: Keyring) =>
  createHmac('sha256', keyring.indexKey).update('service-photo-url-v1').digest();

const mac = (keyring: Keyring, mediaId: string, exp: number) =>
  createHmac('sha256', key(keyring))
    .update(`${mediaId}.${String(exp)}`)
    .digest('base64url');

export function signPhotoUrl(keyring: Keyring, mediaId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + PHOTO_URL_TTL_SECONDS;
  return { exp, sig: mac(keyring, mediaId, exp) };
}

export function verifyPhotoUrl(
  keyring: Keyring,
  mediaId: string,
  exp: number,
  sig: string,
  now = Date.now(),
): boolean {
  if (!Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;
  const want = Buffer.from(mac(keyring, mediaId, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
