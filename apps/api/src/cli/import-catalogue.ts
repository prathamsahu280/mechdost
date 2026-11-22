/**
 * `pnpm db:import:catalogue --dir <catalogue-v2/site> [--dry-run] [--limit n]` (design 2026-11-22, runbook
 * `docs/runbooks/catalogue-import.md` "catalogue-v2 import").
 *
 * Plans every product that has its OWN picture (all packs, MRP or not), fills missing MRPs from the maker price lists
 * on exact matches, writes categories, brands, ranges, products and packs (idempotent, never deletes, never
 * overwrites the admin's work), then uploads each picture through the product-photo pipeline (sharp variants, LQIP,
 * EXIF stripped, private Supabase Storage) with bounded concurrency, and finally sets the Raipur admin price = MRP
 * where the admin-price rule allows it. A DRY RUN reads the database and the files only: no write, no upload.
 *
 * It lives in the API package (not `packages/db`) because the picture pipeline (sharp, Storage client) does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createDb } from '@mechdost/db';
import {
  applyCatalogueImport,
  diffCatalogueImport,
  productsWithoutPhoto,
  recordImportEvent,
  saveProductPhoto,
  setAdminPrice,
  productsBySku,
  recordImportRun,
  summariseStatus,
  uuidv7,
  type Tx,
} from '@mechdost/db/repo';
import {
  buildPlan,
  readPhotoBytes,
  statusCsv,
  statusMarkdown,
  type PlannedProduct,
  type PriceRow,
  type StatusRow,
} from '@mechdost/db/catalogue-v2';
import { processProductPhoto } from '../photos/image';
import { supabaseStorage } from '../photos/storage';

interface Args {
  dir: string;
  dryRun: boolean;
  limit?: number;
  priceLists?: string;
  translations?: string;
  exportUntranslated?: string;
  staffUser?: string;
  skipPhotos: boolean;
  photosOnly: boolean;
  concurrency: number;
  report?: string;
  city: string;
  /** Brand slugs to import; the price-list brands by default. */
  brands: string[];
  statusDir: string;
}

/** The brands the maker price lists cover (user 2026-11-22); the rest can be imported later with --brands. */
export const PRICE_LIST_BRANDS = ['castrol', 'gulf', 'exide', 'tata-green', 'kelvinn', 'cerafence', 'elvi'];

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dir: '',
    dryRun: false,
    skipPhotos: false,
    photosOnly: false,
    concurrency: 3,
    city: 'RPR',
    brands: PRICE_LIST_BRANDS,
    statusDir: fileURLToPath(new URL('../../../../docs/catalogue', import.meta.url)),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const v = argv[(i += 1)];
      if (v === undefined) throw new Error(`${flag ?? ''} needs a value`);
      return v;
    };
    if (flag === '--dir') a.dir = next();
    else if (flag === '--dry-run') a.dryRun = true;
    else if (flag === '--limit') a.limit = Number(next());
    else if (flag === '--price-lists') a.priceLists = next();
    else if (flag === '--translations') a.translations = next();
    else if (flag === '--export-untranslated') a.exportUntranslated = next();
    else if (flag === '--staff-user') a.staffUser = next();
    else if (flag === '--skip-photos') a.skipPhotos = true;
    else if (flag === '--photos-only') a.photosOnly = true;
    else if (flag === '--concurrency') a.concurrency = Math.min(Math.max(Number(next()), 1), 6);
    else if (flag === '--report') a.report = next();
    else if (flag === '--city') a.city = next();
    else if (flag === '--brands')
      a.brands = next()
        .split(',')
        .map((b) => b.trim().toLowerCase())
        .filter((b) => b !== '');
    else if (flag === '--status-dir') a.statusDir = next();
    else if (flag !== undefined) throw new Error(`Unknown option ${flag}`);
  }
  if (a.dir === '') throw new Error('--dir <catalogue-v2/site> is required');
  if (a.limit !== undefined && !(a.limit > 0)) throw new Error('--limit must be a positive number');
  return a;
}

const log = (msg: string) => process.stderr.write(`${msg}\n`);

async function pool<T>(items: readonly T[], size: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) return;
      await work(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.NODE_ENV === 'production' && !args.dryRun && process.env.ALLOW_PROD_IMPORT !== 'yes')
    throw new Error('Refusing a real import with NODE_ENV=production unless ALLOW_PROD_IMPORT=yes');
  const priceRows = args.priceLists ? (JSON.parse(readFileSync(args.priceLists, 'utf8')) as PriceRow[]) : [];
  const translations = args.translations
    ? new Map(Object.entries(JSON.parse(readFileSync(args.translations, 'utf8')) as Record<string, string>))
    : undefined;
  const built = buildPlan({
    dir: args.dir,
    limit: args.limit,
    priceRows,
    translations,
    brands: new Set(args.brands),
  });
  const { report, fills } = built;
  let products = built.products;
  const rowOf = (p: PlannedProduct): StatusRow | undefined =>
    report.rows.find((r) => r.section === p.section && r.sourceId === p.sourceId);
  // Never import a product without a readable picture: the bytes must exist and decode.
  const usable: PlannedProduct[] = [];
  for (const p of products) {
    const problem = await pictureUnreadable(args.dir, p);
    if (problem === null) {
      usable.push(p);
      continue;
    }
    const row = rowOf(p);
    if (row) Object.assign(row, { status: 'skipped', reason: 'no_picture_bytes', detail: problem, slug: '' });
    report.skippedBadPhoto.push({ section: p.section, id: p.sourceId, name: p.name, reason: problem });
  }
  products = usable;
  for (const p of products) {
    const row = rowOf(p);
    if (!row) continue;
    row.packsWithMrp = p.packs.filter((k) => k.mrpPaise !== null).length;
    row.mrpFills = p.packs
      .flatMap((k) => (k.mrpFill ? [`${k.label}: ${k.mrpFill.file} p.${String(k.mrpFill.page)}`] : []))
      .join('; ');
  }

  const url = process.env.DATABASE_URL;
  if (!url || url.includes('<')) throw new Error('DATABASE_URL is missing or still a placeholder');
  const { db, sql } = createDb(url, { max: 4 });
  const tx = db as unknown as Tx;
  const { rows: _rows, ...planSummary } = report;
  const out: Record<string, unknown> = { dryRun: args.dryRun, plan: planSummary, mrpFills: fills };
  try {
    if (args.exportUntranslated) {
      const texts = [
        ...new Set(
          products.flatMap((p) =>
            p.description !== null && p.descriptionHi === null ? [p.description] : [],
          ),
        ),
      ];
      writeFileSync(
        args.exportUntranslated,
        JSON.stringify(Object.fromEntries(texts.map((t) => [t, ''])), null, 1),
      );
      log(`wrote ${String(texts.length)} descriptions to translate to ${args.exportUntranslated}`);
    }
    const diff = await diffCatalogueImport(tx, products);
    const { classes, ...diffCounts } = diff;
    out.diff = diffCounts;
    for (const p of products) {
      const row = rowOf(p);
      const cls = classes.get(p.slug);
      if (row && cls) row.status = cls === 'new' ? 'imported' : cls;
    }
    mkdirSync(args.statusDir, { recursive: true });
    writeFileSync(`${args.statusDir}/catalogue-v2-import-status.csv`, statusCsv(report.rows));
    writeFileSync(
      `${args.statusDir}/catalogue-v2-import-status.md`,
      statusMarkdown(report.rows, {
        run: args.dryRun ? 'dry run' : 'real run',
        brands: args.brands.join(', '),
      }),
    );
    log(`status report written to ${args.statusDir}`);
    const pending = await photoTargets(tx, products);
    out.photosToUpload = args.skipPhotos ? 0 : pending.length;
    if (args.dryRun) {
      finish(args, out);
      return;
    }

    const staffUserId = args.staffUser ?? process.env.IMPORT_STAFF_USER_ID;
    if (!staffUserId)
      throw new Error('--staff-user <uuid> (or IMPORT_STAFF_USER_ID) is required for a real import');

    if (!args.photosOnly) {
      out.written = await applyCatalogueImport(tx, products, {
        staffUserId,
        onBatch: (done, total) => log(`products ${String(done)}/${String(total)}`),
      });
      await recordImportEvent(tx, staffUserId, out.written as never);
      await recordImportRun(tx, staffUserId, summariseStatus(report.rows, new Date()));
      out.adminPrices = await setCityPrices(tx, products, args.city, staffUserId);
    }
    if (!args.skipPhotos) out.photos = await uploadPhotos(tx, products, args, staffUserId);
    finish(args, out);
    return;
  } finally {
    await sql.end();
  }
}

/** Null when the full-size picture is present and decodes as an image; else the reason. */
async function pictureUnreadable(dir: string, p: PlannedProduct): Promise<string | null> {
  if (!p.photo) return 'NO_PICTURE';
  try {
    const bytes = await readPhotoBytes(dir, p.photo);
    if (bytes.length !== p.photo.length) return 'SHORT_READ';
    const meta = await sharp(bytes, { failOn: 'error' }).metadata();
    return meta.width && meta.height ? null : 'NOT_DECODABLE';
  } catch {
    return 'NOT_DECODABLE';
  }
}

/** Products that have a photo in the plan and none stored yet (the resume point; ignores products not imported yet). */
async function photoTargets(tx: Tx, products: readonly PlannedProduct[]): Promise<PlannedProduct[]> {
  return productsWithoutPhoto(tx, products);
}

/**
 * Raipur admin price = MRP for every pack with an MRP, through the existing admin-price repository. Its rule needs a
 * shop that already sells the pack (`NO_SHOP`); the import never creates shop offers (Q208), so those are counted as
 * skipped. After 25 straight `NO_SHOP` answers the rest is skipped without asking again.
 */
async function setCityPrices(tx: Tx, products: readonly PlannedProduct[], city: string, staffUserId: string) {
  const counts = { set: 0, skippedNoShop: 0, skippedOther: 0 };
  let streak = 0;
  for (const p of products)
    for (const pack of p.packs) {
      if (pack.mrpPaise === null) continue;
      if (streak >= 25) {
        counts.skippedNoShop += 1;
        continue;
      }
      try {
        await setAdminPrice(tx, {
          sku: pack.sku,
          cityCode: city,
          pincode: null,
          pricePaise: pack.mrpPaise,
          expectedVersion: null,
          staffUserId,
        });
        counts.set += 1;
        streak = 0;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'NO_SHOP') {
          counts.skippedNoShop += 1;
          streak += 1;
        } else if (code === 'STALE_PRICE' || code === 'CONFLICT') {
          streak = 0; // already has a price: left as the admin set it
          counts.skippedOther += 1;
        } else {
          counts.skippedOther += 1;
        }
      }
    }
  return counts;
}

async function uploadPhotos(tx: Tx, products: readonly PlannedProduct[], args: Args, staffUserId: string) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret || supabaseUrl.includes('<'))
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set');
  const storage = supabaseStorage({ url: supabaseUrl, secretKey: secret, bucket: 'service-photos' });
  await storage.ensureBucket();
  const todo = await productsWithoutPhoto(tx, products);
  const found = await productsBySku(
    tx,
    todo.flatMap((p) => p.packs.slice(0, 1).map((k) => k.sku)),
  );
  const stats = { uploaded: 0, failed: 0, total: todo.length };
  const failures: { slug: string; error: string }[] = [];
  await pool(todo, args.concurrency, async (p, i) => {
    const hit = found.get(p.packs[0]?.sku ?? '');
    const photo = p.photo;
    if (!hit || !photo) return;
    const { slug, productId } = hit;
    const mediaId = uuidv7();
    try {
      const processed = await processProductPhoto(await readPhotoBytes(args.dir, photo));
      const dir = `product/${productId}`;
      const path = `${dir}/${mediaId}.webp`;
      const thumbPath = `${dir}/${mediaId}-thumb.webp`;
      const path640 = `${dir}/${mediaId}-640.webp`;
      await storage.put(path, processed.w1600);
      await storage.put(thumbPath, processed.w320);
      await storage.put(path640, processed.w640);
      try {
        await saveProductPhoto(tx, {
          slug,
          actor: { kind: 'staff', userId: staffUserId },
          alt: photo.alt.length >= 3 ? photo.alt : p.name,
          altHi: photo.altHi.length >= 3 ? photo.altHi : p.name,
          photoSource: photo.sourceUrl,
          image: {
            mediaId,
            bucket: storage.bucket,
            path,
            thumbPath,
            path640,
            width: processed.width,
            height: processed.height,
            bytes: processed.w1600.length,
            thumbBytes: processed.w320.length,
            sha256: createHash('sha256').update(processed.w1600).digest('hex'),
            lqip: processed.lqip,
          },
        });
      } catch (err) {
        await Promise.allSettled([path, thumbPath, path640].map((k) => storage.remove(k)));
        throw err;
      }
      stats.uploaded += 1;
      if ((i + 1) % 50 === 0) log(`photos ${String(stats.uploaded)}/${String(todo.length)}`);
    } catch (err) {
      stats.failed += 1;
      failures.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return { ...stats, failures: failures.slice(0, 50) };
}

function finish(args: Args, out: Record<string, unknown>) {
  const text = JSON.stringify(out, null, 2);
  if (args.report) writeFileSync(args.report, text);
  process.stdout.write(`${text}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
