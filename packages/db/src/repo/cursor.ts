import { ValidationError } from './errors';

/**
 * Opaque keyset cursors for every paged list (hard rule 7: cursor pagination, never OFFSET). A cursor is the
 * last row's sort key (as Postgres text, so timestamps keep their microseconds) and its uuid, base64url JSON.
 * Tampered or foreign cursors are a 422 `INVALID_CURSOR`, never a query error.
 */
export interface Keyset {
  k: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeCursor(c: Keyset): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

/** What the cursor's sort key must parse as; checked before it reaches a SQL cast (review B6). */
export type CursorKind = 'number' | 'timestamp' | 'text';

/** `timestamptz::text` as Postgres writes it, e.g. `2026-11-10 12:34:56.123456+05:30`. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/;
const NUMBER = /^-?\d{1,20}(\.\d{1,20})?(e[+-]?\d{1,3})?$/i;

function keyFits(k: string, kind: CursorKind): boolean {
  if (kind === 'number') return NUMBER.test(k);
  if (kind === 'timestamp') return TIMESTAMP.test(k);
  return true;
}

/** `maxKeyLength`: longer sort keys for lists keyed by a name (shop names, up to 300 characters). */
export function decodeCursor(raw: string, kind: CursorKind = 'text', maxKeyLength = 64): Keyset {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'k' in parsed &&
      'id' in parsed &&
      typeof parsed.k === 'string' &&
      typeof parsed.id === 'string' &&
      parsed.k.length <= maxKeyLength &&
      UUID.test(parsed.id) &&
      keyFits(parsed.k, kind)
    )
      return { k: parsed.k, id: parsed.id };
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor', 'INVALID_CURSOR');
}

/** Page size from a client value: default when absent, clamped to [1, max]. */
export function pageSize(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), max);
}
