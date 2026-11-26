/**
 * Map old "Apply as a mechanic" applications to Ustaad Network invites (spec 23 § 4a; plan task B1). Writes one
 * `ustaad_application_links` row per mechanic application (idempotent); never creates a member (the applicant gives
 * their own consent at join). Invites are sent separately (bell / WhatsApp when templates are live / staff calls).
 * Usage: pnpm db:ustaad:map-mechanic-applications [--dry-run]
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createDb } from '../client';
import { mapMechanicApplications } from '../repo/ustaad/application-links';

const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI and servers provide env vars directly.
}

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}

const { db, sql } = createDb(url, { max: 1 });
try {
  const dryRun = values['dry-run'];
  const r = await db.transaction((tx) => mapMechanicApplications(tx, { dryRun }));
  console.warn(
    `${dryRun ? 'dry run: ' : ''}${String(r.candidates)} mechanic applications, ${String(r.written)} invite links written`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
