// Builds the real-sign-in copy of the web for the API-mode UI audit into apps/web/.next-api (the demo build in
// .next is left alone). Every value below is a public, fake audit value: nothing here is a secret and nothing is
// read from .env (process values win over .env files in Next). The audit's mocked API lives in the browser
// (e2e/state-audit/api-mode); NEXT_PUBLIC_API_URL only names the origin the page.route mock answers.
// Usage (repo root or apps/web): node apps/web/scripts/state-audit-api-build.mjs   (needs about 3 GB free RAM, one build at a time)
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Everything resolves from this file, so it works from the repo root and from apps/web.
const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = {
  ...process.env,
  NEXT_DIST_DIR: process.env.STATE_AUDIT_DIST ?? '.next-api',
  NEXT_PUBLIC_AUTH_MODE: 'firebase',
  NEXT_PUBLIC_DATA_MODE: 'api',
  NEXT_PUBLIC_API_URL: process.env.STATE_AUDIT_API_ORIGIN ?? 'http://127.0.0.1:4100',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'audit-fake-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'audit.invalid',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-audit',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:audit',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3101',
};
for (const key of [
  'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
])
  delete env[key];

const run = (args) => {
  const r = spawnSync('pnpm', args, { cwd: webDir, stdio: 'inherit', env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['exec', 'node', resolve(webDir, 'scripts', 'copy-map-worker.mjs')]);
run(['exec', 'next', 'build']);
console.log(
  'built apps/web/.next-api: run the audit with pnpm exec playwright test -c playwright.state-audit-api.config.ts',
);
