/**
 * The shared part of the battery brand importers (`pnpm db:import:exide`, `pnpm db:import:amaron`; user 2026-11-23,
 * runbook `docs/runbooks/catalogue-import.md`). A brand's CLI file only says which plan, writer and report to use.
 *
 * Reads the brand's scrape folder, archives every product of the brand already listed that is not in it (never
 * deletes), creates or updates one live product per source row, then uploads the pictures through the product-photo
 * pipeline (sharp variants, LQIP, private Storage) with bounded concurrency, skipping a picture the product already
 * has (same source URL or same content hash) and putting the product's pictures in gallery order.
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
import type { BatteryPlan, PlannedPhoto, PlannedProduct, RowResult } from '@mechdost/db/battery-import';
import {
  batteryPhotoStates,
  recordImportRun,
  attachSharedProductPhoto,
  reorderProductPhotos,
  saveProductPhoto,
  summariseStatus,
  uuidv7,
  type BatteryPhotoState,
  type BatteryRunResult,
  type Tx,
} from '@mechdost/db/repo';
import { processProductPhoto, type ProcessedProductImage } from '../photos/image';
import { supabaseStorage } from '../photos/storage';
import { addSkipFiles, withoutSkippedPhotos } from './skip-photos';

/** What differs between the brands. */
export interface BatteryCliBrand<P extends BatteryPlan> {
  /** "Exide": the name in messages and in the import-run audit rows. */
  name: string;
  /** "exide_batteries": the folder the CSVs and `pictures/` are in. */
  folder: string;
  /** Report file stem: `<stem>-import-status.csv`. */
  stem: string;
  /** Where the Hindi dictionary lives (named in the error of a failed Hindi check). */
  hindiFile: string;
  planDir(dir: string, opts?: { packs?: string }): P;
  /** The brand takes a researched pack list (`--packs <csv>`; HP). */
  acceptsPacks?: boolean;
  hindiLeftovers(plan: P): { slug: string; field: string; words: string[] }[];
  diff(tx: Tx, products: readonly PlannedProduct[]): Promise<BatteryRunResult>;
  apply(
    tx: Tx,
    products: readonly PlannedProduct[],
    opts: { staffUserId: string },
  ): Promise<BatteryRunResult>;
  /** The picture bytes the photo pipeline gets (a brand may tidy them first; the source file is never changed). */
  readPicture(dir: string, file: string): Buffer | Promise<Buffer>;
  /** A file several products use is stored once and shared (tyre patterns); false = each product stores its own copy. */
  sharePhotos?: boolean;
  statusCsv(rows: P['rows'], results?: ReadonlyMap<string, RowResult>, plan?: P): string;
  statusMarkdown(
    plan: P,
    meta: {
      run: 'plan only' | 'dry run' | 'real run';
      archived?: readonly { slug: string; name: string; status: string }[];
      results?: ReadonlyMap<string, RowResult>;
    },
  ): string;
  archivedCsv(archived: readonly { slug: string; name: string; status: string }[]): string;
  /** Extra report files written next to the status report (Apollo: the dropped rows). */
  extraFiles?(plan: P): { name: string; content: string }[];
  /** Extra numbers for the printed summary. */
  summaryExtras?(plan: P): Record<string, unknown>;
}

interface Args {
  dir: string;
  dryRun: boolean;
  planOnly: boolean;
  skipPhotos: boolean;
  /** Pictures (path relative to the folder, or just the file name) left out of the import: the product imports without them. */
  skipPhotoFiles: Set<string>;
  staffUser?: string;
  /** Researched pack list (HP). */
  packs?: string;
  concurrency: number;
  statusDir: string;
}

function parseArgs(argv: string[], brand: { folder: string }): Args {
  const a: Args = {
    dir: '',
    dryRun: false,
    planOnly: false,
    skipPhotos: false,
    skipPhotoFiles: new Set(),
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
    else if (flag === '--skip-photos-for') addSkipFiles(a.skipPhotoFiles, next());
    else if (flag === '--staff-user') a.staffUser = next();
    else if (flag === '--packs') a.packs = next();
    else if (flag === '--concurrency') a.concurrency = Math.min(Math.max(Number(next()), 1), 6);
    else if (flag === '--status-dir') a.statusDir = next();
    else if (flag !== undefined) throw new Error(`Unknown option ${flag}`);
  }
  if (a.dir === '') throw new Error(`--dir <${brand.folder} folder> is required`);
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

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function writeStatus<P extends BatteryPlan>(
  brand: BatteryCliBrand<P>,
  args: Args,
  plan: P,
  run: 'plan only' | 'dry run' | 'real run',
  result?: BatteryRunResult,
) {
  const results = result
    ? new Map<string, RowResult>([...result.results].map(([slug, r]) => [slug, r]))
    : undefined;
  mkdirSync(args.statusDir, { recursive: true });
  writeFileSync(
    `${args.statusDir}/${brand.stem}-import-status.csv`,
    brand.statusCsv(plan.rows, results, plan),
  );
  for (const f of brand.extraFiles?.(plan) ?? []) writeFileSync(`${args.statusDir}/${f.name}`, f.content);
  writeFileSync(
    `${args.statusDir}/${brand.stem}-import-status.md`,
    brand.statusMarkdown(plan, { run, archived: result?.archived, results }),
  );
  if (result)
    writeFileSync(`${args.statusDir}/${brand.stem}-import-archived.csv`, brand.archivedCsv(result.archived));
  log(`status report written to ${args.statusDir}`);
}

export async function runBatteryImport<P extends BatteryPlan>(brand: BatteryCliBrand<P>): Promise<void> {
  const args = parseArgs(process.argv.slice(2), brand);
  if (
    process.env.NODE_ENV === 'production' &&
    !args.dryRun &&
    !args.planOnly &&
    process.env.ALLOW_PROD_IMPORT !== 'yes'
  )
    throw new Error('Refusing a real import with NODE_ENV=production unless ALLOW_PROD_IMPORT=yes');
  if (args.packs !== undefined && brand.acceptsPacks !== true)
    throw new Error(`--packs is not used by the ${brand.name} import`);
  const plan = withoutSkippedPhotos(brand.planDir(args.dir, { packs: args.packs }), args.skipPhotoFiles);
  if (args.skipPhotoFiles.size > 0) {
    const left = plan.products.reduce((n, p) => n + p.photos.length, 0);
    log(
      `--skip-photos-for: ${String(args.skipPhotoFiles.size)} names; ${String(left)} pictures remain in the plan`,
    );
  }
  // Hard rule 10: Hindi text keeps brand, model and vehicle names only. A real run stops on leftovers.
  const leftovers = brand.hindiLeftovers(plan);
  if (leftovers.length > 0 || plan.untranslated.length > 0) {
    log(
      `${String(leftovers.length)} Hindi texts hold English words; untranslated features: ${plan.untranslated.join(' | ')}`,
    );
    for (const l of leftovers.slice(0, 10)) log(`  ${l.slug} ${l.field}: ${l.words.join(', ')}`);
    if (!args.dryRun && !args.planOnly) throw new Error(`Fix the Hindi (${brand.hindiFile}) first`);
  }
  const summary: Record<string, unknown> = {
    sourceRows: plan.rows.length,
    products: plan.products.length,
    drafts: plan.products.filter((p) => p.status === 'draft').length,
    byCategory: tally(plan.products.map((p) => p.category.slug)),
    byRange: tally(plan.products.map((p) => p.range.name)),
    priceOnRequestRows: plan.rows.filter((r) => r.mrpRupees === '').length,
    priceOnRequest: [...new Set(plan.rows.filter((r) => r.mrpRupees === '').map((r) => r.slug))],
    sharedMainPhotos: plan.rows.filter((r) => r.photoKind === 'range').length,
    photosPlanned: plan.products.reduce((n, p) => n + p.photos.length, 0),
    slugCollisions: plan.slugCollisions,
    skuCollisions: plan.skuCollisions,
    hindiLeftovers: leftovers.length,
    ...brand.summaryExtras?.(plan),
  };
  if (args.planOnly) {
    writeStatus(brand, args, plan, 'plan only');
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url || url.includes('<')) throw new Error('DATABASE_URL is missing or still a placeholder');
  const { db, sql } = createDb(url, { max: 4 });
  const tx = db as unknown as Tx;
  try {
    if (args.dryRun) {
      const diff = await brand.diff(tx, plan.products);
      writeStatus(brand, args, plan, 'dry run', diff);
      process.stdout.write(
        `${JSON.stringify({ ...summary, dryRun: true, diff: diff.counts, toArchive: diff.archived.map((a) => a.slug) }, null, 2)}\n`,
      );
      return;
    }
    const staffUserId = args.staffUser ?? process.env.IMPORT_STAFF_USER_ID;
    if (!staffUserId)
      throw new Error('--staff-user <uuid> (or IMPORT_STAFF_USER_ID) is required for a real import');
    const result = await brand.apply(tx, plan.products, { staffUserId });
    await recordImportRun(
      tx,
      staffUserId,
      summariseStatus(
        plan.rows.map((r) => ({
          brand: brand.name,
          status:
            result.results.get(r.slug) === 'created' ? 'imported' : (result.results.get(r.slug) ?? 'skipped'),
          reason: '',
        })),
        new Date(),
      ),
    );
    writeStatus(brand, args, plan, 'real run', result);
    const out: Record<string, unknown> = {
      ...summary,
      written: result.counts,
      archived: result.archived.length,
    };
    if (!args.skipPhotos) out.photos = await uploadPhotos(brand, tx, plan.products, args, staffUserId);
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    await sql.end();
  }
}

type PhotoStorage = ReturnType<typeof supabaseStorage>;

async function uploadPhotos<P extends BatteryPlan>(
  brand: BatteryCliBrand<P>,
  tx: Tx,
  products: readonly PlannedProduct[],
  args: Args,
  staffUserId: string,
) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secret || supabaseUrl.includes('<'))
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set');
  const storage = supabaseStorage({ url: supabaseUrl, secretKey: secret, bucket: 'service-photos' });
  await storage.ensureBucket();
  const states = await batteryPhotoStates(tx, products);
  const stats = { uploaded: 0, shared: 0, skipped: 0, failed: 0, products: 0, photos: 0 };
  const failures: { slug: string; error: string }[] = [];

  // A file several products share (Amaron's one "View" picture, a pair's front photo) is processed once.
  const uses = new Map<string, number>();
  for (const p of products) for (const ph of p.photos) uses.set(ph.file, (uses.get(ph.file) ?? 0) + 1);
  const shared = new Map<string, Promise<ProcessedProductImage>>();
  const processFile = async (file: string): Promise<ProcessedProductImage> => {
    if ((uses.get(file) ?? 0) < 2) return processProductPhoto(await brand.readPicture(args.dir, file));
    let hit = shared.get(file);
    if (!hit) {
      hit = Promise.resolve(brand.readPicture(args.dir, file)).then(processProductPhoto);
      shared.set(file, hit);
    }
    return hit;
  };

  // A picture several products share (a tyre pattern's pictures, shared by every size) is stored once: the first product to
  // need it uploads it, the others get a photo row on the same stored image (`attachSharedProductPhoto`).
  const leaders = new Map<string, Promise<{ id: string; existing: boolean }>>();
  const placeOrShare = async (p: PlannedProduct, state: BatteryPhotoState, photo: PlannedPhoto) => {
    if ((uses.get(photo.file) ?? 0) < 2 || brand.sharePhotos !== true)
      return placePhoto(tx, storage, staffUserId, p, state, photo, processFile);
    const source = photo.sourceUrl === '' ? photo.file : photo.sourceUrl;
    const known = state.idBySource.get(source);
    if (known) return { id: known, existing: true };
    const lead = leaders.get(photo.file);
    if (!lead) {
      const first = placePhoto(tx, storage, staffUserId, p, state, photo, processFile);
      leaders.set(photo.file, first);
      return first;
    }
    const from = await lead;
    const saved = await attachSharedProductPhoto(tx, {
      slug: p.slug,
      actor: { kind: 'staff', userId: staffUserId },
      alt: photo.alt,
      altHi: photo.altHi,
      photoSource: source,
      fromPhotoId: from.id,
    });
    state.idBySource.set(source, saved.id);
    stats.shared += 1;
    return { id: saved.id, existing: false };
  };

  await pool(products, args.concurrency, async (p, i) => {
    const state = states.get(p.slug);
    if (!state || p.photos.length === 0) return;
    stats.products += 1;
    // The photo ids in the order the plan wants them (an existing photo keeps its place; a new one is added).
    const wanted: string[] = [];
    const added: string[] = [];
    for (const photo of p.photos) {
      stats.photos += 1;
      try {
        const id = await placeOrShare(p, state, photo);
        if (id.existing) stats.skipped += 1;
        else {
          stats.uploaded += 1;
          added.push(id.id);
        }
        wanted.push(id.id);
      } catch (err) {
        stats.failed += 1;
        failures.push({ slug: p.slug, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Gallery order: this import's pictures first, in plan order; an old picture of a replaced product stays behind.
    // Only when this run added a picture: a re-run that uploads nothing never undoes an order staff set.
    const unique = [...new Set(wanted)];
    const order = [...unique, ...state.photoIds.filter((id) => !unique.includes(id))];
    const current = [...state.photoIds, ...added];
    if (added.length > 0 && order.some((id, k) => id !== current[k]))
      await reorderProductPhotos(tx, { slug: p.slug, ids: order, userId: staffUserId }).catch(
        (err: unknown) => {
          failures.push({ slug: p.slug, error: err instanceof Error ? err.message : String(err) });
        },
      );
    if ((i + 1) % 25 === 0) log(`photos ${String(i + 1)}/${String(products.length)}`);
  });
  return { ...stats, failures: failures.slice(0, 50) };
}

/** One planned picture of a product: the id of the photo already holding it, or a new upload. */
async function placePhoto(
  tx: Tx,
  storage: PhotoStorage,
  staffUserId: string,
  p: PlannedProduct,
  state: BatteryPhotoState,
  photo: PlannedPhoto,
  processFile: (file: string) => Promise<ProcessedProductImage>,
): Promise<{ id: string; existing: boolean }> {
  const source = photo.sourceUrl === '' ? photo.file : photo.sourceUrl;
  const known = state.idBySource.get(source);
  if (known) return { id: known, existing: true };
  const processed = await processFile(photo.file);
  const sha256 = createHash('sha256').update(processed.w1600).digest('hex');
  const sameHash = state.idByHash.get(sha256);
  if (sameHash) return { id: sameHash, existing: true };
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
      photoSource: source,
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
    state.idBySource.set(source, saved.id);
    state.idByHash.set(sha256, saved.id);
    return { id: saved.id, existing: false };
  } catch (err) {
    await Promise.allSettled([path, thumbPath, path640].map((k) => storage.remove(k)));
    throw err;
  }
}
