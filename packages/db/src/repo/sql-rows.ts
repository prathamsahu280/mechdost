/**
 * Raw `db.execute` results differ by driver: postgres-js returns an array, PGlite `{ rows }`. Numbers from
 * int8/numeric columns arrive as strings (postgres-js), bigint (PGlite) or number; `num` normalises them.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

export function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint' || typeof v === 'string') return Number(v);
  throw new TypeError('not a number');
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}
