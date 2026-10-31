/**
 * Apply migrations with the Supabase *session* pooler URL (DATABASE_URL in the root .env).
 * Usage: pnpm db:migrate
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI provides env vars directly.
}

const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  await sql`select set_config('search_path', 'public, extensions', false)`;
  await migrate(drizzle(sql), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  const rows = await sql<
    { count: number }[]
  >`select count(*)::int as count from pg_tables where schemaname = 'public'`;
  console.log(`migrations applied; public tables: ${rows[0]?.count ?? 0}`);
} finally {
  await sql.end();
}
