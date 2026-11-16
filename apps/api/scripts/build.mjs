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
  // The CommonJS `require` shim uses a private alias: a source file importing `createRequire` itself (the bill PDF
  // fonts) gave the worker bundle a duplicate declaration and it crashed on start (2026-11-16). Guard: the bundle
  // syntax check in `test/build-bundle.test.ts`.
  banner: {
    js: "import { createRequire as __mdCreateRequire } from 'node:module'; const require = __mdCreateRequire(import.meta.url);",
  },
});
