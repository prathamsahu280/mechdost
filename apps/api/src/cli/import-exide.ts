/**
 * `pnpm db:import:exide --dir <exide_batteries folder> [--dry-run | --plan-only] [--skip-photos] [--staff-user <uuid>]`
 * (user 2026-11-23; runbook `docs/runbooks/catalogue-import.md` "Exide import").
 *
 * Reads the exidecare scrape (`exide_batteries.csv`, `exide_vehicle_fitment.csv`, `pictures/…`), archives every Exide
 * product already listed that is not in it (never deletes), creates or updates one live product per source row, then
 * uploads the pictures through the product-photo pipeline (sharp variants, LQIP, private Storage) with bounded
 * concurrency, skipping a picture the product already has (same source URL or same content hash).
 *
 *  - `--plan-only`: no database at all; writes the status report from the files.
 *  - `--dry-run`: reads the database too; prints what a real run would create, update and archive; writes nothing.
 *
 * It lives in the API package because the picture pipeline (sharp, Storage client) does.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '@mechdost/db';
import {
  applyExideImport,
  diffExideImport,
  exidePhotoStates,
  recordImportRun,
  reorderProductPhotos,
  saveProductPhoto,
  summariseStatus,
  uuidv7,
  type ExideRunResult,
  type Tx,
} from '@mechdost/db/repo';
import {
  exideArchivedCsv,
  exideHindiLeftovers,
  exideStatusCsv,
  exideStatusMarkdown,
  planExideDir,
  readPicture,
  type ExidePlan,
  type ExidePlannedProduct,
  type RowResult,
} from '@mechdost/db/exide';
import { processProductPhoto } from '../photos/image';
import { supabaseStorage } from '../photos/storage';

interface Args {
  dir: string;
  dryRun: boolean;
  planOnly: boolean;
  skipPhotos: boolean;
  staffUser?: string;
  concurrency: number;
  statusDir: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dir: '',
    dryRun: false,
    planOnly: false,
    skipPhotos: false,
    concurrency: 3,
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
    else if (flag === '--plan-only') a.planOnly = true;
    else if (flag === '--skip-photos') a.skipPhotos = true;
    else if (flag === '--staff-user') a.staffUser = next();
    else if (flag === '--concurrency') a.concurrency = Math.min(Math.max(Number(next()), 1), 6);
    else if (flag === '--status-dir') a.statusDir = next();
    else if (flag !== undefined) throw new Error(`Unknown option ${flag}`);
  }
  if (a.dir === '') throw new Error('--dir <exide_batteries folder> is required');
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

function writeStatus(
  args: Args,
  plan: ExidePlan,
  run: 'plan only' | 'dry run' | 'real run',
  result?: ExideRunResult,
) {
  const results = result
    ? new Map<string, RowResult>([...result.results].map(([slug, r]) => [slug, r]))
    : undefined;
  mkdirSync(args.statusDir, { recursive: true });
  writeFileSync(`${args.statusDir}/exide-import-status.csv`, exideStatusCsv(plan.rows, results));
  writeFileSync(
    `${args.statusDir}/exide-import-status.md`,
    exideStatusMarkdown(plan, { run, archived: result?.archived, results }),
  );
  if (result) writeFileSync(`${args.statusDir}/exide-import-archived.csv`, exideArchivedCsv(result.archived));
  log(`status report written to ${args.statusDir}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    process.env.NODE_ENV === 'production' &&
    !args.dryRun &&
    !args.planOnly &&
    process.env.ALLOW_PROD_IMPORT !== 'yes'
  )
    throw new Error('Refusing a real import with NODE_ENV=production unless ALLOW_PROD_IMPORT=yes');
  const plan = planExideDir(args.dir);
  // Hard rule 10: Hindi text keeps brand, model and vehicle names only. A real run stops on leftovers.
  const leftovers = exideHindiLeftovers(plan);
  if (leftovers.length > 0 || plan.untranslated.length > 0) {
    log(
      `${String(leftovers.length)} Hindi texts hold English words; untranslated features: ${plan.untranslated.join(' | ')}`,
    );
    for (const l of leftovers.slice(0, 10)) log(`  ${l.slug} ${l.field}: ${l.words.join(', ')}`);
    if (!args.dryRun && !args.planOnly)
      throw new Error('Fix the Hindi (packages/db/src/exide/hindi.ts) first');
  }
  const summary: Record<string, unknown> = {
    sourceRows: plan.rows.length,
    products: plan.products.length,
    drafts: plan.products.filter((p) => p.status === 'draft').length,
    byCategory: tally(plan.products.map((p) => p.category.slug)),
    byRange: tally(plan.products.map((p) => p.range.name)),
    priceOnRequest: plan.rows.filter((r) => r.mrpRupees === '').map((r) => r.slug),
    rangePhotos: plan.rows.filter((r) => r.photoKind === 'range').length,
    slugCollisions: plan.slugCollisions,
    skuCollisions: plan.skuCollisions,
    hindiLeftovers: leftovers.length,
  };
  if (args.planOnly) {
    writeStatus(args, plan, 'plan only');
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url || url.includes('<')) throw new Error('DATABASE_URL is missing or still a placeholder');
  const { db, sql } = createDb(url, { max: 4 });
  const tx = db as unknown as Tx;
  try {
    if (args.dryRun) {
      const diff = await diffExideImport(tx, plan.products);
      writeStatus(args, plan, 'dry run', diff);
      process.stdout.write(
        `${JSON.stringify({ ...summary, dryRun: true, diff: diff.counts, toArchive: diff.archived.map((a) => a.slug) }, null, 2)}\n`,
      );
      return;
    }
    const staffUserId = args.staffUser ?? process.env.IMPORT_STAFF_USER_ID;
    if (!staffUserId)
      throw new Error('--staff-user <uuid> (or IMPORT_STAFF_USER_ID) is required for a real import');
    const result = await applyExideImport(tx, plan.products, { staffUserId });
    await recordImportRun(
      tx,
      staffUserId,
      summariseStatus(
        plan.rows.map((r) => ({
          brand: 'Exide',
          status:
            result.results.get(r.slug) === 'created' ? 'imported' : (result.results.get(r.slug) ?? 'skipped'),
          reason: '',
        })),
        new Date(),
      ),
    );
    writeStatus(args, plan, 'real run', result);
    const out: Record<string, unknown> = {
      ...summary,
      written: result.counts,
      archived: result.archived.length,
    };
    if (!args.skipPhotos) out.photos = await uploadPhotos(tx, plan.products, args, staffUserId);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    await sql.end();
  }
}

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function uploadPhotos(
  tx: Tx,
  products: readonly ExidePlannedProduct[],
  args: Args,
  staffUserId: string,
) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret || supabaseUrl.includes('<'))
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set');
  const storage = supabaseStorage({ url: supabaseUrl, secretKey: secret, bucket: 'service-photos' });
  await storage.ensureBucket();
  const states = await exidePhotoStates(tx, products);
  const stats = { uploaded: 0, skipped: 0, failed: 0, total: products.length };
  const failures: { slug: string; error: string }[] = [];
  await pool(products, args.concurrency, async (p, i) => {
    const state = states.get(p.slug);
    const photo = p.photo;
    if (!state || !photo) return;
    try {
      if (state.sources.has(photo.sourceUrl) && photo.sourceUrl !== '') {
        stats.skipped += 1;
        return;
      }
      const processed = await processProductPhoto(readPicture(args.dir, photo.file));
      const sha256 = createHash('sha256').update(processed.w1600).digest('hex');
      if (state.hashes.has(sha256)) {
        stats.skipped += 1;
        return;
      }
      const mediaId = uuidv7();
      const dir = `product/${state.productId}`;
      const path = `${dir}/${mediaId}.webp`;
      const thumbPath = `${dir}/${mediaId}-thumb.webp`;
      const path640 = `${dir}/${mediaId}-640.webp`;
      await storage.put(path, processed.w1600);
      await storage.put(thumbPath, processed.w320);
      await storage.put(path640, processed.w640);
      try {
        const saved = await saveProductPhoto(tx, {
          slug: p.slug,
          actor: { kind: 'staff', userId: staffUserId },
          alt: photo.alt,
          altHi: photo.altHi,
          photoSource: photo.sourceUrl === '' ? photo.file : photo.sourceUrl,
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
            sha256,
            lqip: processed.lqip,
          },
        });
        // An old picture of a replaced product stays (staff can remove it); the new one goes first.
        if (state.photoIds.length > 0)
          await reorderProductPhotos(tx, {
            slug: p.slug,
            ids: [saved.id, ...state.photoIds],
            userId: staffUserId,
          });
      } catch (err) {
        await Promise.allSettled([path, thumbPath, path640].map((k) => storage.remove(k)));
        throw err;
      }
      stats.uploaded += 1;
      if ((i + 1) % 25 === 0) log(`photos ${String(i + 1)}/${String(products.length)}`);
    } catch (err) {
      stats.failed += 1;
      failures.push({ slug: p.slug, error: err instanceof Error ? err.message : String(err) });
    }
  });
  return { ...stats, failures: failures.slice(0, 50) };
}

main().catch((err: unknown) => {
  process.stderr.write(`import failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
