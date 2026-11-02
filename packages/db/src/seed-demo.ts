/**
 * Load (or remove) the Raipur DEMO catalogue in the database the root `.env` points at (src/demo-seed.ts).
 * Dev and staging only; refuses NODE_ENV=production. Remove before public launch (Q21).
 * Usage: pnpm db:seed:demo · pnpm db:seed:demo --remove
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from './client';
import { removeRaipurDemo, seedRaipurDemo, type DemoFixture } from './demo-seed';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
try {
  process.loadEnvFile(rootEnv);
} catch {
  // CI provides env vars directly.
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to load demo data with NODE_ENV=production');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url || url.includes('<')) {
  console.error('DATABASE_URL is missing or still a placeholder in .env');
  process.exit(1);
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const { db, sql } = createDb(url, { max: 1 });
try {
  if (process.argv.includes('--remove')) {
    await removeRaipurDemo(db, fixture);
    console.log('demo catalogue removed');
  } else {
    const r = await seedRaipurDemo(db, fixture);
    console.log(`demo catalogue loaded; products: ${r.products}, shops: ${r.shops}, offers: ${r.offers}`);
  }
} finally {
  await sql.end();
}
