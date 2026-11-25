/** Helpers shared by the `ustaad-*` schema files (spec 23 § 6). */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** `'a','b','c'` as a plain string (for `sql.raw` fragments that combine several columns). */
export const quoted = (values: readonly string[]): string =>
  values.map((v) => `'${v.replaceAll("'", "''")}'`).join(',');

/** `'a','b','c'` for a CHECK built from a shared code list (single source: `@mechdost/shared/ustaad/codes`). */
export const inList = (values: readonly string[]): SQL => sql.raw(quoted(values));

/** `column in (...)`. */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${inList(values)})`;

/** `column is null or column in (...)`. */
export const nullOrOneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} is null or ${column} in (${inList(values)})`;

/** Every element of a text[] column is one of the codes. */
export const allOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} <@ array[${inList(values)}]::text[]`;
