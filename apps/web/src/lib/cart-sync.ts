import { CartDto, CartUnchangedDto, CART_MAX_LINES, type ServerCart } from '@mechdost/shared/cart-api';
import { cartNow, replaceCart, type CartLine } from '@/demo/store';
import { authed } from './orders-api';

/**
 * Keeps the browser cart and the signed-in customer's server cart together (spec 03 "Server cart", design 2026-11-15
 * item 3), in real sign-in mode only. **The server cart is the source of truth; the browser copy is a cache** that the
 * header, cards and cart page read with no network wait.
 *
 * Several devices (user 2026-11-15: phone and laptop at once, nothing may be lost). The browser never sends its whole
 * cart. It remembers the last server snapshot it saw (\`SYNC_KEY\`: account, version, lines) and sends only the
 * difference between the cart now and that snapshot, one line at a time: more of a pack is an **add** (adds from two
 * devices sum), fewer is a **set** (last write wins for that line), a pack that is gone is a **remove**. Each answer is
 * the whole server cart, which the browser then adopts, so what another device did meanwhile appears and nothing is
 * overwritten. A page load or a refresh that finds no local edits just reads the server cart (with \`since=<version>\`,
 * so "unchanged" is a tiny answer) and adopts it: a stale copy is never pushed over the server.
 *
 * \`refreshCart\` is the one function everything calls (the 60 s poll, a tab becoming visible, opening the cart or
 * checkout, a local change after a short pause, and later the shared live listener). Calls queue one after another.
 * Prices are never part of any of this: lines are SKUs and quantities; prices come from the checkout quote.
 *
 * Shared devices (security review 2026-11-15): the snapshot belongs to an account. A cart saved for another account is
 * dropped, never merged or sent. Sign-out calls \`resetCartSync\` (clears the cart and the snapshot, makes answers still
 * in flight stale). Failures are silent: the browser cart keeps working and the next refresh tries again.
 */
type Locale = 'en' | 'hi';
interface SkuLine {
  sku: string;
  qty: number;
}
interface SyncRecord {
  uid: string;
  /** Version of the last server cart this browser adopted (the \`since\` of the next refresh). */
  version: number;
  /** What this browser last saw of the server cart; edits are sent relative to it. */
  lines: SkuLine[];
}

const SYNC_KEY = 'mechdost-cart-sync';
const CART_OR_SAME = CartDto.or(CartUnchangedDto);
const DEBOUNCE_MS = 800;
const MAX_ROUNDS = 3;

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
/** Bumped by every reset: an answer from an earlier generation is dropped. */
let generation = 0;

const skuLines = (lines: readonly CartLine[]): SkuLine[] =>
  lines.flatMap((l) => (l.sku ? [{ sku: l.sku, qty: l.qty }] : [])).slice(0, CART_MAX_LINES);
const fingerprint = (lines: readonly SkuLine[]): string =>
  lines
    .map((l) => `${l.sku}:${String(l.qty)}`)
    .sort()
    .join(',');
const toLocal = (cart: ServerCart): CartLine[] =>
  cart.lines.map((l) => ({ slug: l.slug, sku: l.sku, qty: l.qty }));

function readRecord(): SyncRecord | null {
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Partial<SyncRecord>;
    if (typeof r.uid !== 'string' || typeof r.version !== 'number' || !Array.isArray(r.lines)) return null;
    return { uid: r.uid, version: r.version, lines: r.lines };
  } catch {
    return null;
  }
}
function writeRecord(record: SyncRecord | null): void {
  try {
    if (record === null) window.localStorage.removeItem(SYNC_KEY);
    else window.localStorage.setItem(SYNC_KEY, JSON.stringify(record));
  } catch {
    // Private mode: nothing is remembered, and the next refresh simply reads the server cart.
  }
}
async function uidNow(locale: Locale): Promise<string | null> {
  const { currentUid } = await import('./auth/firebase-client');
  return currentUid(locale).catch(() => null);
}

/** The browser cart becomes the server's cart (only rewritten when it differs) and the snapshot moves with it. */
function adopt(cart: ServerCart, uid: string): void {
  const lines = cart.lines.map((l) => ({ sku: l.sku, qty: l.qty }));
  if (fingerprint(skuLines(cartNow())) !== fingerprint(lines)) replaceCart(toLocal(cart));
  writeRecord({ uid, version: cart.version, lines });
}

type Op = { kind: 'add' | 'set'; sku: string; qty: number } | { kind: 'remove'; sku: string };

/** This browser's own pending edits: the cart now against the last server snapshot it saw. */
function pendingOps(local: readonly SkuLine[], base: readonly SkuLine[]): Op[] {
  const was = new Map(base.map((l) => [l.sku, l.qty]));
  const now = new Map(local.map((l) => [l.sku, l.qty]));
  const ops: Op[] = [];
  for (const [sku] of was) if (!now.has(sku)) ops.push({ kind: 'remove', sku });
  for (const [sku, qty] of now) {
    const had = was.get(sku);
    if (had === undefined) ops.push({ kind: 'add', sku, qty });
    else if (qty < had) ops.push({ kind: 'set', sku, qty });
    else if (qty > had) ops.push({ kind: 'add', sku, qty: qty - had });
  }
  return ops;
}

async function sendOp(locale: Locale, op: Op): Promise<ServerCart | null> {
  const path = `/me/cart/lines/${encodeURIComponent(op.sku)}`;
  const q = `?locale=${locale}`;
  const res =
    op.kind === 'remove'
      ? await authed(locale, `${path}${q}`, CartDto, { method: 'DELETE' })
      : op.kind === 'set'
        ? await authed(locale, `${path}${q}`, CartDto, { method: 'PUT', body: { qty: op.qty } })
        : await authed(locale, `${path}/add${q}`, CartDto, { method: 'POST', body: { qty: op.qty } });
  return res.ok ? res.data : null;
}

/** After an op the snapshot says what this browser now believes the server holds for that line. */
function applyToBase(base: SkuLine[], op: Op, localQty: number | undefined): SkuLine[] {
  const rest = base.filter((l) => l.sku !== op.sku);
  return op.kind === 'remove' || localQty === undefined ? rest : [...rest, { sku: op.sku, qty: localQty }];
}

async function run(locale: Locale, gen: number): Promise<boolean> {
  const uid = await uidNow(locale);
  if (gen !== generation) return true;
  if (!uid) return true; // signed out: nothing to sync
  let record = readRecord();
  if (record !== null && record.uid !== uid) {
    // A cart saved for another account is never merged or sent.
    replaceCart([]);
    writeRecord(null);
    record = null;
  }
  if (record === null) {
    // Never synced on this device (a session older than this feature): the server cart wins when it has lines.
    const first = await authed(locale, `/me/cart?locale=${locale}`, CartDto);
    if (gen !== generation) return true;
    if (!first.ok) return false;
    if (first.data.lines.length > 0) {
      adopt(first.data, uid);
      return true;
    }
    record = { uid, version: first.data.version, lines: [] };
    writeRecord(record);
  }
  let base = record.lines;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const local = skuLines(cartNow());
    const ops = pendingOps(local, base);
    if (ops.length === 0) {
      const res = await authed(
        locale,
        `/me/cart?locale=${locale}&since=${String(record.version)}`,
        CART_OR_SAME,
      );
      if (gen !== generation) return true;
      if (!res.ok) return false;
      if ('unchanged' in res.data) return true;
      adopt(res.data, uid);
      return true;
    }
    let last: ServerCart | null = null;
    for (const op of ops) {
      last = await sendOp(locale, op);
      if (gen !== generation) return true;
      if (!last) {
        writeRecord({ ...record, lines: base });
        return false;
      }
      base = applyToBase(base, op, local.find((l) => l.sku === op.sku)?.qty);
    }
    writeRecord({ ...record, lines: base });
    // No edit was made while the ops were on their way: the server's answer (other devices included) is the cart now.
    if (last && fingerprint(skuLines(cartNow())) === fingerprint(local)) {
      adopt(last, uid);
      return true;
    }
    record = { ...record, lines: base };
  }
  return true;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Bring the browser cart and the server cart together: send this browser's pending edits, adopt the server's cart.
 * Resolves to false when the network or the API failed (the poller then backs off).
 */
export function refreshCart(locale: Locale): Promise<boolean> {
  const gen = generation;
  return enqueue(() => run(locale, gen)).catch(() => false);
}

/**
 * After sign-in or sign-up. A genuine guest cart (this browser's cart belongs to nobody yet) is folded into the server
 * cart (the larger quantity wins; safe to repeat). A cart this browser already knows for this account is just
 * refreshed (a stale copy must not bring back what another device removed); one that belongs to another account is
 * dropped first.
 */
export function mergeAtSignIn(locale: Locale): Promise<void> {
  started = true;
  const gen = generation;
  return enqueue(async () => {
    const uid = await uidNow(locale);
    if (gen !== generation || !uid) return;
    const record = readRecord();
    if (record !== null && record.uid === uid) {
      await run(locale, gen);
      return;
    }
    if (record !== null) {
      replaceCart([]);
      writeRecord(null);
    }
    const res = await authed(locale, `/me/cart/merge?locale=${locale}`, CartDto, {
      method: 'POST',
      body: { lines: skuLines(cartNow()) },
    });
    if (gen !== generation) return;
    if (res.ok) adopt(res.data, uid);
  }).catch(() => undefined);
}

/**
 * Called whenever the browser cart changes while a customer is signed in, and once when a page loads. The first call of
 * a page load refreshes at once (it reads the server cart); later calls send the change after a short pause.
 */
export function syncCart(locale: Locale): void {
  if (!started) {
    started = true;
    void refreshCart(locale);
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    void refreshCart(locale);
  }, DEBOUNCE_MS);
}

/** Sign-out: this browser's cart is no longer anyone's. Clears it and every piece of sync state. */
export function resetCartSync(): Promise<void> {
  generation += 1;
  started = false;
  clearTimeout(timer);
  timer = undefined;
  queue = Promise.resolve();
  writeRecord(null);
  replaceCart([]);
  return Promise.resolve();
}
