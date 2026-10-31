/**
 * In-process Postgres (PGlite + PostGIS/citext/pg_trgm/btree_gist) for tests — no Docker needed.
 * PGlite is single-connection: it proves constraints, triggers and CAS logic; true multi-connection
 * concurrency tests run against Supabase/real Postgres in CI (docs/progress.md rulings).
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { postgis } from '@electric-sql/pglite-postgis';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export async function createTestDb() {
  const client = await PGlite.create({ extensions: { postgis, citext, pg_trgm, btree_gist } });
  // Mirror Supabase, where extension types (geography, citext) resolve through the `extensions` schema.
  await client.exec('CREATE SCHEMA IF NOT EXISTS extensions; SET search_path TO public, extensions;');
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  return { client, db };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];
