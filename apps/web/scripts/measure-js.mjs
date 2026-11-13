/**
 * Client JS budget check (spec 16, hard rule 6: product page JS < 180 KB gzip). Loads each page in headless
 * Chromium against a running production server and sums the transferred (compressed) size of every script,
 * then lists the biggest chunks. Usage: `pnpm --filter @mechdost/web exec next build && next start --port 3100`,
 * then `node scripts/measure-js.mjs [baseUrl] [--top N]`. Exits 1 if a page is over budget.
 */
import { chromium } from '@playwright/test';

const BUDGET_KB = 180;
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3100';
const topIndex = process.argv.indexOf('--top');
const top = topIndex > 0 ? Number(process.argv[topIndex + 1]) : 8;
const PAGES = [
  '/',
  '/shop',
  '/shop/castrol-activ-4t-20w40-900ml',
  '/compare?p=castrol-activ-4t-20w40-900ml,motul-3100-4t-10w30-1l,hp-racer4-20w40-900ml',
  '/workshops',
  '/cart',
  '/hi',
];

const browser = await chromium.launch();
let over = false;
for (const path of PAGES) {
  const context = await browser.newContext({ storageState: 'e2e/fixtures/consent-decided.json' });
  const page = await context.newPage();
  const scripts = new Map();
  page.on('response', async (res) => {
    if (res.request().resourceType() !== 'script') return;
    try {
      const sizes = await res.request().sizes();
      scripts.set(res.url(), sizes.responseBodySize);
    } catch {
      /* navigation aborted */
    }
  });
  const res = await page.goto(base + path, { waitUntil: 'networkidle' });
  // The page's own JS = scripts named in the server HTML (what must load before the page is interactive).
  // Everything else is fetched later (route prefetch for links in view, lazy islands) and reported apart.
  const html = (await res?.text()) ?? '';
  const own = new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], base).href));
  const sum = (urls) => urls.reduce((a, u) => a + (scripts.get(u) ?? 0), 0) / 1024;
  const ownUrls = [...scripts.keys()].filter((u) => own.has(u));
  const laterUrls = [...scripts.keys()].filter((u) => !own.has(u));
  const total = sum(ownUrls);
  const flag = total > BUDGET_KB ? '  OVER' : '';
  if (total > BUDGET_KB) over = true;
  console.log(
    `${path.padEnd(40)} ${res?.status()}  page ${total.toFixed(1)} KB gz (${ownUrls.length})  + later ${sum(laterUrls).toFixed(1)} KB (${laterUrls.length})${flag}`,
  );
  for (const u of [...ownUrls].sort((a, b) => (scripts.get(b) ?? 0) - (scripts.get(a) ?? 0)).slice(0, top))
    console.log(`    ${((scripts.get(u) ?? 0) / 1024).toFixed(1).padStart(6)} KB  ${new URL(u).pathname}`);
  for (const u of laterUrls.slice(0, 4))
    console.log(
      `    later ${((scripts.get(u) ?? 0) / 1024).toFixed(1).padStart(6)} KB  ${new URL(u).pathname}`,
    );
  await context.close();
}
await browser.close();
process.exit(over ? 1 : 0);
