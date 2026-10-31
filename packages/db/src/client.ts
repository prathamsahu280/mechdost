import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;

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
    connection: { application_name: 'mechdost-api', TimeZone: 'UTC' },
  });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
