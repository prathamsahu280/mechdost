/**
 * Serves MapLibre's web worker from /vendor (decision 2026-11-01 "Map worker"). MapLibre 6 resolves its worker
 * next to its own module via import.meta.url; Next's bundler does not emit that file, so the map never loads.
 * We copy it under a versioned name (immutable caching) and point MapLibre at it with setWorkerUrl().
 * Runs before `dev` and `build`; the output folder is git-ignored.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const source = join(dirname(pkgPath), 'dist', 'maplibre-gl-worker.mjs');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'vendor');
const target = `maplibre-gl-worker-${version}.mjs`;

mkdirSync(outDir, { recursive: true });
// Drop workers from older MapLibre versions so stale files never ship.
for (const file of readdirSync(outDir)) {
  if (file.startsWith('maplibre-gl-worker-') && file !== target) rmSync(join(outDir, file));
}
copyFileSync(source, join(outDir, target));
console.log(`map worker → public/vendor/${target}`);
