import { CartDto, CART_MAX_LINES, type ServerCart } from '@mechdost/shared/cart-api';
import { cartNow, replaceCart, type CartLine } from '@/demo/store';
import { authed } from './orders-api';

/**
 * Keeps the browser cart and the signed-in customer's server cart together (spec 03 "Server cart", design 2026-11-15
 * item 3), in real sign-in mode only. The browser copy stays the working copy (the header, cards and cart page read it
 * with no network wait); the server copy lets the cart follow the customer to another device.
 * - Sign-in: the guest cart is merged into the server cart (the larger quantity wins; safe to repeat) and the merged
 *   cart becomes the browser cart.
 * - First visit of a page load while signed in: the server cart wins when it has lines; otherwise the browser cart is
 *   sent up (it may have been built while the network was down).
 * - Every later change in the browser is sent after a short pause as "the cart is exactly these lines". Two devices
 *   editing at the same moment: the last change wins (ruling 2026-11-15, spec 03).
 * Prices are never part of any of this: the cart is SKUs and quantities; prices come from the checkout quote.
 * Failures are silent on purpose: the browser cart keeps working, and the next change tries again. Loaded only by
 * dynamic import from the header and the sign-in screen, never by demo builds.
 *
 * Shared devices (security review 2026-11-15): the browser cart remembers which account it was adopted for
 * (`OWNER_KEY`). A cart that belongs to another account is never merged or sent: it is dropped. Sign-out calls
 * `resetCartSync`, which clears the browser cart, forgets the owner and all sync state, and makes every answer still
 * in flight stale (a generation counter), so nothing of the previous person reaches the next one.
 */
type Locale = 'en' | 'hi';

const PUSH_DELAY_MS = 800;
const OWNER_KEY = 'mechdost-cart-owner';
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** What the server is known to hold, as `sku:qty` pairs, so a pulled cart is not sent straight back. */
let known = '';
let settled: Promise<void> = Promise.resolve();
/** Bumped by every reset: an answer from an earlier generation is dropped. */
let generation = 0;

const skuLines = (lines: readonly CartLine[]): { sku: string; qty: number }[] =>
  lines.flatMap((l) => (l.sku ? [{ sku: l.sku, qty: l.qty }] : [])).slice(0, CART_MAX_LINES);
const fingerprint = (lines: readonly { sku: string; qty: number }[]): string =>
  lines
    .map((l) => `${l.sku}:${String(l.qty)}`)
    .sort()
    .join(',');
const toLocal = (cart: ServerCart): CartLine[] =>
  cart.lines.map((l) => ({ slug: l.slug, sku: l.sku, qty: l.qty }));

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}
function writeOwner(uid: string | null): void {
  try {
    if (uid === null) window.localStorage.removeItem(OWNER_KEY);
    else window.localStorage.setItem(OWNER_KEY, uid);
  } catch {
    // Private mode: the owner is not remembered, and the sign-out reset still clears the cart.
  }
}
async function uidNow(locale: Locale): Promise<string | null> {
  const { currentUid } = await import('./auth/firebase-client');
  return currentUid(locale).catch(() => null);
}

/** Make the browser cart the server's answer, and remember that the two now agree and whose they are. */
function adopt(cart: ServerCart, uid: string): void {
  known = fingerprint(cart.lines);
  writeOwner(uid);
  if (fingerprint(skuLines(cartNow())) !== known) replaceCart(toLocal(cart));
}

/** A browser cart adopted for someone else is dropped: only a genuine guest cart (no owner) or your own is used. */
function dropForeignCart(uid: string): void {
  const owner = readOwner();
  if (owner !== null && owner !== uid) {
    replaceCart([]);
    known = '';
    writeOwner(null);
  }
}

/** After sign-in or sign-up: fold the guest cart into the server cart. */
export function mergeAtSignIn(locale: Locale): Promise<void> {
  started = true;
  const gen = generation;
  // Every later send waits for this one: sending the guest cart as "the cart" first would wipe the saved one.
  settled = (async () => {
    const uid = await uidNow(locale);
    if (gen !== generation || !uid) return;
    dropForeignCart(uid);
    const res = await authed(locale, `/me/cart/merge?locale=${locale}`, CartDto, {
      method: 'POST',
      body: { lines: skuLines(cartNow()) },
    });
    if (gen !== generation) return;
    if (res.ok) adopt(res.data, uid);
  })();
  return settled;
}

async function push(locale: Locale, gen: number): Promise<void> {
  await settled;
  const uid = await uidNow(locale);
  if (gen !== generation || !uid) return;
  dropForeignCart(uid);
  const lines = skuLines(cartNow());
  if (fingerprint(lines) === known) return;
  const res = await authed(locale, `/me/cart?locale=${locale}`, CartDto, { method: 'PUT', body: { lines } });
  if (gen === generation && res.ok) adopt(res.data, uid);
}

/**
 * Called whenever the browser cart changes while a customer is signed in (and once on load). The first call of a page
 * load reads the server cart; later calls send the change after a pause.
 */
export function syncCart(locale: Locale): void {
  const gen = generation;
  if (!started) {
    started = true;
    void (async () => {
      const uid = await uidNow(locale);
      if (gen !== generation || !uid) return;
      dropForeignCart(uid);
      const res = await authed(locale, `/me/cart?locale=${locale}`, CartDto);
      if (gen !== generation || !res.ok) return;
      if (res.data.lines.length > 0) adopt(res.data, uid);
      else await push(locale, gen);
    })();
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    void push(locale, gen);
  }, PUSH_DELAY_MS);
}

/**
 * Sign-out: this browser's cart is no longer anyone's. Clears it, forgets the owner and every piece of sync state, and
 * makes answers still on their way stale.
 */
export function resetCartSync(): Promise<void> {
  generation += 1;
  started = false;
  known = '';
  clearTimeout(timer);
  timer = undefined;
  settled = Promise.resolve();
  writeOwner(null);
  replaceCart([]);
  return Promise.resolve();
}
