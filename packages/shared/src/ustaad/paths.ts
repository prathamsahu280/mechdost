/**
 * Internal paths stored by the network (promotion targets `url_internal`, deep links): one shared check used by the
 * Zod DTOs, the API before storing, the renderer and any redirect, and mirrored by the database CHECK
 * `ustaad_promotions_internal_target` (security review 2026-11-26: a loose `^/[^/\\]` let `/ok\n//evil`, backslashes and
 * encoded slashes through). A strict shape: one leading slash, path segments of unreserved/sub-delim characters only (no
 * `%`, so no encoded `//` or `\`), an optional query or fragment without spaces, control characters or backslashes.
 */
import { z } from 'zod';

const SEGMENT = "[A-Za-z0-9._~!$&'()*+,;=:@-]";
const SAFE_INTERNAL_PATH = new RegExp(
  `^/(?:${SEGMENT}+(?:/${SEGMENT}*)*)?(?:[?#][^\\s\\\\\\u0000-\\u001f\\u007f]*)?$`,
);
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

export const INTERNAL_PATH_MAX = 300;

export function isSafeInternalPath(value: string): boolean {
  return value.length <= INTERNAL_PATH_MAX && !FORBIDDEN.test(value) && SAFE_INTERNAL_PATH.test(value);
}

export const InternalPathDto = z.string().max(INTERNAL_PATH_MAX).refine(isSafeInternalPath, 'UNSAFE_PATH');

/**
 * The same rule as a Postgres regex (ARE) for CHECK constraints, written as SQL string literal bodies (single quotes
 * doubled). `INTERNAL_PATH_SQL_FORBIDDEN` must not match anywhere.
 */
// `;` is spelled as the regex escape \x3B because drizzle-kit cuts a CHECK at a semicolon.
export const INTERNAL_PATH_SQL_RE =
  "^/([A-Za-z0-9._~!$&''()*+,\\x3B=:@-]+(/[A-Za-z0-9._~!$&''()*+,\\x3B=:@-]*)*)?([?#][^[:space:][:cntrl:]\\\\]*)?$";
export const INTERNAL_PATH_SQL_FORBIDDEN = '[[:cntrl:]\\\\]';
