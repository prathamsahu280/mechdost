/**
 * Adds the Ustaad Network starter lists (curated hashtags, Banned words, Personal details to hide, Blocked link
 * sites; src/ustaad/starter-lists.ts) to the database the root `.env` points at. Idempotent: only missing rows are
 * added; rows an admin already has (even switched off) are never changed; nothing is deleted.
 * Usage: pnpm db:seed:ustaad-starter [--dry-run]
 */
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { seedUstaadStarterLists, USTAAD_STARTER } from './ustaad/starter-lists';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI provides env vars directly.
}

console.log(
  `Starter: ${String(USTAAD_STARTER.tags.length)} tags, ${String(USTAAD_STARTER.banned.length)} banned words, ` +
    `${String(USTAAD_STARTER.piiPattern.length)} personal-detail phrases, ${String(USTAAD_STARTER.linkDomain.length)} link sites`,
);
if (process.argv.includes('--dry-run')) process.exit(0);

const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}
const { db, sql } = createDb(url, { max: 1 });
try {
  const r = await db.transaction((tx) => seedUstaadStarterLists(tx));
  console.log(
    `Added ${String(r.tags)} tags and ${String(r.words)} list entries; existing rows left as they were.`,
  );
} finally {
  await sql.end();
}
