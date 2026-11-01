import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

export type TlsOption = false | 'require' | { ca: string; rejectUnauthorized: true };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Encryption in transit (decision 2026-11-01 "Encryption"). Every connection to a non-local database uses TLS;
 * with `DATABASE_CA_CERT` (path to Supabase's CA certificate, Dashboard → Database → SSL) the server certificate
 * is verified too (verify-full), which also stops man-in-the-middle attacks. Only a database on this machine
 * (tests, Supabase local) may connect without TLS.
 */
export function tlsFor(url: string, env: Record<string, string | undefined> = process.env): TlsOption {
  const host = new URL(url).hostname;
  if (LOCAL_HOSTS.has(host)) return false;
  const caPath = env.DATABASE_CA_CERT?.trim();
  if (caPath) return { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  // Fail closed in production: encryption without certificate verification is open to man-in-the-middle, so
  // the server refuses to start rather than downgrade. Dev may use 'require' until the CA is installed (Q23).
  if (env.NODE_ENV === 'production') {
    throw new Error('DATABASE_CA_CERT is required in production (verify-full TLS to the database)');
  }
  return 'require';
}

/**
 * Production/dev client. Use the Supabase *transaction* pooler (port 6543) for the API at runtime
 * (prepare: false is required there) and the *session* pooler (5432) for migrations.
 */
export function createDb(url: string, opts: { max?: number; transactionPooler?: boolean } = {}) {
  const sql = postgres(url, {
    max: opts.max ?? 10,
    prepare: opts.transactionPooler ? false : true,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: tlsFor(url),
    connection: { application_name: 'mechdost-api', TimeZone: 'UTC' },
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
