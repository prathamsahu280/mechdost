import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { planApolloDir } from '@mechdost/db/apollo';
import { normaliseProductPicture } from '../photos/normalise';
import { processProductPhoto } from '../photos/image';

const dir = 'C:/Users/Admin/Desktop/autoparts/apollo_tyres';
const out = process.argv[2] ?? '';
const plan = planApolloDir(dir);
mkdirSync(`${out}/norm`, { recursive: true });
const files = [...new Set(plan.products.flatMap((p) => p.photos.map((ph) => ph.file)))];
let source = 0;
let normalisedBytes = 0;
let w1600 = 0;
let w640 = 0;
let w320 = 0;
const names = new Map<string, string>();
let n = 0;
for (const f of files) {
  const buf = readFileSync(`${dir}/${f}`);
  source += statSync(`${dir}/${f}`).size;
  const nm = await normaliseProductPicture(buf);
  normalisedBytes += nm.data.length;
  const p = await processProductPhoto(nm.data);
  w1600 += p.w1600.length;
  w640 += p.w640.length;
  w320 += p.w320.length;
  n += 1;
  const name = `${String(n).padStart(3, '0')}.png`;
  writeFileSync(`${out}/norm/${name}`, nm.data);
  names.set(f, name);
}
writeFileSync(
  `${out}/patterns.json`,
  JSON.stringify(
    plan.products.map((p) => ({
      slug: p.slug,
      name: p.name,
      sizes: p.variants.length,
      files: p.photos.map((ph) => ph.file),
      norm: p.photos.map((ph) => names.get(ph.file) ?? ''),
    })),
  ),
);
process.stdout.write(
  `${JSON.stringify({ files: files.length, sourceBytes: source, normalisedPngBytes: normalisedBytes, webp1600: w1600, webp640: w640, webp320: w320, webpTotal: w1600 + w640 + w320 })}\n`,
);
