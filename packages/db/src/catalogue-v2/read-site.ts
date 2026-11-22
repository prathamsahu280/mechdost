import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  emptyReport,
  newPlanState,
  planSection,
  SECTIONS,
  summarise,
  type PlannedPhoto,
  type PlannedProduct,
  type PlanReport,
  type SourceProduct,
} from './plan';
import { fillMissingMrps, type MrpFill, type PriceRow } from './price-fill';

/** The v2 site folder: `data/{lub,bat,car,tyr,flt}.json`, `data/img.json`, `img/*.webp` packs. */
export interface SiteFiles {
  dir: string;
}

type ImageIndex = readonly (readonly [
  readonly [string, number, number],
  readonly [string, number, number],
])[];

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export interface BuiltPlan {
  products: PlannedProduct[];
  report: PlanReport;
  fills: MrpFill[];
}

/**
 * Read the site folder and plan every section. `limit` caps the products per section (dry runs on a sample);
 * `priceRows` (from `extract-price-lists.py`) fill missing MRPs before anything else.
 */
export function buildPlan(opts: {
  dir: string;
  limit?: number;
  priceRows?: readonly PriceRow[];
  translations?: ReadonlyMap<string, string>;
  brands?: ReadonlySet<string>;
}): BuiltPlan {
  const images = (readJson(join(opts.dir, 'data', 'img.json')) as { img: ImageIndex }).img;
  const report = emptyReport();
  const state = newPlanState();
  const products: PlannedProduct[] = [];
  for (const section of SECTIONS) {
    const file = readJson(join(opts.dir, 'data', `${section}.json`)) as { products: SourceProduct[] };
    const planned = planSection(
      { section, products: file.products, images, translations: opts.translations, brands: opts.brands },
      report,
      state,
    );
    products.push(...(opts.limit === undefined ? planned : planned.slice(0, opts.limit)));
  }
  const fills = fillMissingMrps(products, opts.priceRows ?? []);
  return { products, report: summarise(products, report), fills };
}

/** The full-size WebP of one planned photo, read from its pack file by byte range (no whole-pack read). */
export async function readPhotoBytes(dir: string, photo: PlannedPhoto): Promise<Buffer> {
  const handle = await open(join(dir, 'img', `${photo.pack}.webp`), 'r');
  try {
    const buf = Buffer.alloc(photo.length);
    await handle.read(buf, 0, photo.length, photo.offset);
    return buf;
  } finally {
    await handle.close();
  }
}
