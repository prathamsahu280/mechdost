/**
 * WhatsApp share teaser tokens (spec 23 § 10 step 7, SR-44): `{post id, 16 bytes}.{HMAC-SHA256 tag, 16 bytes}`,
 * base64url, signed with `USTAAD_SHARE_SECRET`. Stateless (no table): the teaser re-reads the post on every open, so
 * a removed post's teaser 404s at once. The token reveals nothing but a random-looking id; the teaser page shows a
 * generic card only (never text, media, names or counts).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/;

const tag = (secret: string, postId: string) =>
  createHmac('sha256', secret).update(`ustaad-share:v1:${postId}`).digest().subarray(0, 16);

export function signShareToken(secret: string, postId: string): string {
  const id = Buffer.from(postId.replace(/-/g, ''), 'hex');
  return `${id.toString('base64url')}.${tag(secret, postId).toString('base64url')}`;
}

/** The post id of a genuine token, else null. */
export function verifyShareToken(secret: string, token: string): string | null {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const [idPart = '', tagPart = ''] = token.split('.');
  const hex = Buffer.from(idPart, 'base64url').toString('hex');
  if (hex.length !== 32) return null;
  const postId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID.test(postId)) return null;
  const given = Buffer.from(tagPart, 'base64url');
  const want = tag(secret, postId);
  return given.length === want.length && timingSafeEqual(given, want) ? postId : null;
}
