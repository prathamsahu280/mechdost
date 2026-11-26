/**
 * Paths that carry a secret in a segment (security review 2026-11-13): the seller invite link
 * `/partners/invite/<token>` and the Ustaad garage-owner link `/ustaad-attest/<token>` are bearer credentials (and the share teaser `/ustaad/s/<token>`, 2026-11-26), so
 * analytics keeps the route shape and drops the token.
 * Dependency-free so the browser `track()` can use it without the Zod registry.
 */
// The delivery-agent invite `/partners/delivery-invite/<token>` too (spec 24, 2026-11-26).
const SECRET_SEGMENTS =
  /^((?:\/hi)?\/(?:partners\/invite|partners\/delivery-invite|ustaad-attest|ustaad\/s))\/[^/?#]+(?:\/[^?#]*)?/u;

export function redactPath(path: string): string {
  return path.replace(SECRET_SEGMENTS, '$1/:token');
}
