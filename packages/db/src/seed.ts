/**
 * Seed reference data that every environment needs. Idempotent — safe to run on every deploy.
 * Today: the RBAC catalogue (permissions, system roles, role_permissions) from packages/shared/src/rbac.ts.
 * Raipur demo data (cities, pincodes, categories, shops, workshops) is added with Phase 1.
 * Usage: pnpm db:seed
 */
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { syncRbacCatalogue } from './repo/rbac';

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

const { db, sql } = createDb(url, { max: 1 });
try {
  await syncRbacCatalogue(db);
  const [row] = await sql<{ roles: number; permissions: number }[]>`
    select (select count(*)::int from roles) as roles, (select count(*)::int from permissions) as permissions`;
  console.log(`seed complete; roles: ${row?.roles ?? 0}, permissions: ${row?.permissions ?? 0}`);
} finally {
  await sql.end();
}
