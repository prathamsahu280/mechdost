// drizzle-kit quotes custom types that contain parentheses ("geography(Point,4326)"), which Postgres rejects.
// Runs after every `drizzle-kit generate` (see package.json "generate").
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../drizzle/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let fixed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/"(geography\([A-Za-z]+,\d+\))"/g, '$1');
  if (after !== before) {
    writeFileSync(path, after);
    fixed++;
  }
}
console.log(`fix-migrations: ${fixed} file(s) updated`);
