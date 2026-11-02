/**
 * In-process Postgres (PGlite + PostGIS/citext/pg_trgm/btree_gist) for tests — no Docker needed.
 * PGlite is single-connection: it proves constraints, triggers and CAS logic; true multi-connection
 * concurrency tests run against Supabase/real Postgres in CI (docs/progress.md rulings).
 *
 * Speed and stability (2026-11-03): migrating a fresh database in every test file re-ran all migrations and,
 * on a loaded machine, timed out. `buildTestDbTemplate()` (Vitest global setup) migrates once per run and dumps
 * the data directory to a temp file named after a hash of the migrations; `createTestDb()` loads a copy of it.
 * Without the template (e.g. a single file run directly) it falls back to migrating from scratch.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
export const TEMPLATE_ENV = 'MECHDOST_PGLITE_TEMPLATE';

const extensions = { postgis, citext, pg_trgm, btree_gist };

/** Mirror Supabase, where extension types (geography, citext) resolve through the `extensions` schema. */
const SEARCH_PATH = 'CREATE SCHEMA IF NOT EXISTS extensions; SET search_path TO public, extensions;';

function wrap(client: PGlite) {
  return { client, db: drizzle(client, { schema, casing: 'snake_case' }) };
}

async function migratedFromScratch() {
  const client = await PGlite.create({ extensions });
  await client.exec(SEARCH_PATH);
  const handle = wrap(client);
  await migrate(handle.db, { migrationsFolder });
  return handle;
}

/** Hash of every migration file and the journal: any change produces a new template. */
function migrationsHash(): string {
  const hash = createHash('sha256');
  const files = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of [...files, join('meta', '_journal.json')]) {
    hash.update(f);
    hash.update(readFileSync(join(migrationsFolder, f)));
  }
  return hash.digest('hex').slice(0, 16);
}

/** Migrates once and stores the data directory; returns its path (reused while migrations are unchanged). */
export async function buildTestDbTemplate(): Promise<string> {
  const file = join(tmpdir(), `mechdost-pglite-${migrationsHash()}.tar.gz`);
  if (existsSync(file)) return file;
  const { client } = await migratedFromScratch();
  const dump = await client.dumpDataDir('gzip');
  await client.close();
  // Write then rename, so a parallel run never loads a half-written file.
  const partial = `${file}.${String(process.pid)}.partial`;
  writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
  renameSync(partial, file);
  return file;
}

export async function createTestDb() {
  const template = process.env[TEMPLATE_ENV];
  if (template && existsSync(template)) {
    const client = await PGlite.create({ extensions, loadDataDir: new Blob([readFileSync(template)]) });
    await client.exec(SEARCH_PATH);
    return wrap(client);
  }
  return migratedFromScratch();
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];
