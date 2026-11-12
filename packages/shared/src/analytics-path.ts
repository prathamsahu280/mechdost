/**
 * Paths that carry a secret in a segment (security review 2026-11-13): the seller invite link
 * `/partners/invite/<token>` is a bearer credential, so analytics keeps the route shape and drops the token.
 * Dependency-free so the browser `track()` can use it without the Zod registry.
 */
const SECRET_SEGMENTS = /^((?:\/hi)?\/partners\/invite)\/[^/?#]+(?:\/[^?#]*)?/u;

export function redactPath(path: string): string {
  return path.replace(SECRET_SEGMENTS, '$1/:token');
}
