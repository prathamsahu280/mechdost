/**
 * Grant a staff role to an existing account, found by its phone number. This is how the first super_admin is
 * made (nobody can grant roles before one exists) and how the real sign-in end-to-end test gets a staff account
 * (runbook docs/runbooks/firebase.md). Recorded in audit_log as a system grant with the reason given.
 * Usage: pnpm db:grant-role --phone +919876543210 --role super_admin --reason "first admin" [--city raipur]
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
import { isRoleKey, ROLES } from '@mechdost/shared/rbac';
import { createDb } from './client';
import { grantRole } from './repo/rbac';
import { cities, users } from './schema';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI and servers provide env vars directly.
}

const { values } = parseArgs({
  options: {
    phone: { type: 'string' },
    role: { type: 'string' },
    reason: { type: 'string' },
    city: { type: 'string' },
  },
});
const { phone, role, reason, city } = values;
if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone) || !role || !reason) {
  console.error('Usage: --phone +91XXXXXXXXXX --role <staff role> --reason "<why>" [--city <slug>]');
  process.exit(1);
}
// Only staff roles here: shop and workshop roles come with their partner records (spec 06/07).
if (!isRoleKey(role) || !['global', 'city'].includes(ROLES[role].scope) || role === 'customer') {
  console.error(`${role} is not a staff role`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}

const { db, sql } = createDb(url, { max: 1 });
try {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new Error(`No account uses ${phone}; the person signs up first`);
  let cityId: string | null = null;
  if (city) {
    const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, city)).limit(1);
    if (!row) throw new Error(`Unknown city ${city}`);
    cityId = row.id;
  }
  await grantRole(db, { userId: user.id, role, cityId, grantedBy: null, reason });
  console.log(`granted ${role}${city ? ` (${city})` : ''} to ${phone}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
