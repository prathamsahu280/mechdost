// Bundle the API for Cloud Run: workspace packages (TypeScript sources) are inlined; npm dependencies stay
// external and are installed in the image with `pnpm deploy --prod`. Dependencies of workspace packages
// (drizzle-orm, postgres, uuid) are bundled because the API does not declare them itself.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@mechdost/'));

await build({
  // server = stateless HTTP API; worker = always-on background loops (live relay; pg-boss jobs later).
  entryPoints: { server: 'src/server.ts', worker: 'src/worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
