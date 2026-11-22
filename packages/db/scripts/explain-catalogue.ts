/**
 * Read-only diagnostic (spec 16, budget incident 2026-11-22): times and EXPLAINs the storefront catalogue queries
 * against the database in DATABASE_URL (SELECT only; EXPLAIN ANALYZE of a SELECT writes nothing). Never prints the URL.
 *   pnpm --filter @mechdost/db exec tsx scripts/explain-catalogue.ts [--plans]
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createDb } from '../src/client';
import { listCatalogue, getCatalogueProduct, listCatalogueCategories } from '../src/repo/catalogue';
import type { Tx } from '../src/repo/orders';

try {
  process.loadEnvFile(process.env.ENV_FILE ?? new URL('../../../.env', import.meta.url));
} catch {
  /* env already set */
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const plans = process.argv.includes('--plans');
const { sql: pg } = createDb(url, { max: 1, transactionPooler: true });
const dialect = new PgDialect();

/** Runs the query; for the big SELECTs also prints the execution plan. */
const traced: Tx = {
  execute: async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    if (plans && /^\s*(with ranked|with pg|select)/i.test(text) && text.length > 400) {
      const plan = await pg.unsafe(`explain (analyze, buffers, timing off) ${text}`, params as never[]);
      console.log(plan.map((r) => String(r['QUERY PLAN'])).join('\n'));
    }
    return pg.unsafe(text, params as never[]);
  },
} as unknown as Tx;

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await fn();
  console.log(`${label}: ${(performance.now() - t).toFixed(0)} ms`);
  return r;
}

const t0 = performance.now();
await pg`select 1`;
console.log(`connect + first query: ${(performance.now() - t0).toFixed(0)} ms`);
await time('select 1 (warm conn)', () => pg`select 1`);
const counts = await pg`select (select count(*) from products where status = 'live')::int as live,
  (select count(*) from product_variants)::int as variants, (select count(*) from shop_inventory)::int as inv,
  (select count(*) from admin_prices)::int as admin_prices, (select count(*) from product_photos)::int as photos,
  (select count(*) from reviews)::int as reviews`;
console.log('rows', JSON.stringify(counts[0]));

const base = { cityCode: 'RPR', locale: 'hi' as const };
for (let i = 0; i < 2; i++) {
  await time(`list default (newest, 24) #${String(i + 1)}`, () =>
    listCatalogue(traced, { ...base, limit: 24 }),
  );
}
await time('list sort=price_asc', () => listCatalogue(traced, { ...base, limit: 24, sort: 'price_asc' }));
await time('list q=castrol', () => listCatalogue(traced, { ...base, limit: 24, q: 'castrol' }));
await time('list category=engine-oil', () =>
  listCatalogue(traced, { ...base, limit: 24, category: 'engine-oil' }),
);
await time('list limit=5 related', () =>
  listCatalogue(traced, { ...base, limit: 5, category: 'polishes-waxes' }),
);
await time('categories', () => listCatalogueCategories(traced, 'hi'));
await time('product page', () => getCatalogueProduct(traced, 'castrol-crb-plus-20w-40-ch-4', base));
await pg.end();
