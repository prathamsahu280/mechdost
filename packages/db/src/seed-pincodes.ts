/**
 * Load a city's reference PIN codes into the database the root `.env` points at (src/pincodes-seed.ts; spec 15
 * "PIN codes"). Idempotent and safe on the launch database: adds missing PINs, refreshes rows the seed added
 * earlier, leaves every admin-changed row alone, never switches a PIN on or off and never deletes.
 * Usage: pnpm db:seed:pincodes [--file seed/raipur-pincodes.json] [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { pincodeFileProblems, upsertPincodes, type PincodeSeedFile } from './pincodes-seed';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI provides env vars directly.
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const file = fileURLToPath(new URL(`../${arg('--file') ?? 'seed/raipur-pincodes.json'}`, import.meta.url));
const data = JSON.parse(readFileSync(file, 'utf8')) as PincodeSeedFile;
const problems = pincodeFileProblems(data);
if (problems.length > 0) {
  console.error(`PIN code file refused:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
const active = data.pincodes.filter((p) => p.active).length;
console.log(
  `${data.city.code}: ${String(data.pincodes.length)} PIN codes in the file (${String(active)} active)`,
);
if (process.argv.includes('--dry-run')) process.exit(0);

const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}
const { db, sql } = createDb(url, { max: 1 });
try {
  const r = await upsertPincodes(db, data);
  console.log(
    `PIN codes: ${String(r.inserted)} added, ${String(r.refreshed)} refreshed, ${String(r.unchanged)} unchanged, ` +
      `${String(r.keptAdmin)} kept as the admin set them`,
  );
  if (r.otherCity.length > 0)
    console.warn(`Listed under another city, left alone: ${r.otherCity.join(', ')}`);
} finally {
  await sql.end();
}
