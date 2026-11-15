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
 */
type Locale = 'en' | 'hi';

const PUSH_DELAY_MS = 800;
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** What the server is known to hold, as `sku:qty` pairs, so a pulled cart is not sent straight back. */
let known = '';
let settled: Promise<void> = Promise.resolve();

const skuLines = (lines: readonly CartLine[]): { sku: string; qty: number }[] =>
  lines.flatMap((l) => (l.sku ? [{ sku: l.sku, qty: l.qty }] : [])).slice(0, CART_MAX_LINES);
const fingerprint = (lines: readonly { sku: string; qty: number }[]): string =>
  lines
    .map((l) => `${l.sku}:${String(l.qty)}`)
    .sort()
    .join(',');
const toLocal = (cart: ServerCart): CartLine[] =>
  cart.lines.map((l) => ({ slug: l.slug, sku: l.sku, qty: l.qty }));

/** Make the browser cart the server's answer, and remember that the two now agree. */
function adopt(cart: ServerCart): void {
  known = fingerprint(cart.lines);
  if (fingerprint(skuLines(cartNow())) !== known) replaceCart(toLocal(cart));
}

/** After sign-in or sign-up: fold the guest cart into the server cart. */
export function mergeAtSignIn(locale: Locale): Promise<void> {
  started = true;
  const lines = skuLines(cartNow());
  // Every later send waits for this one: sending the guest cart as "the cart" first would wipe the saved one.
  settled = authed(locale, `/me/cart/merge?locale=${locale}`, CartDto, {
    method: 'POST',
    body: { lines },
  }).then((res) => {
    if (res.ok) adopt(res.data);
  });
  return settled;
}

async function push(locale: Locale): Promise<void> {
  await settled;
  const lines = skuLines(cartNow());
  if (fingerprint(lines) === known) return;
  const res = await authed(locale, `/me/cart?locale=${locale}`, CartDto, { method: 'PUT', body: { lines } });
  if (res.ok) adopt(res.data);
}

/**
 * Called whenever the browser cart changes while a customer is signed in (and once on load). The first call of a page
 * load reads the server cart; later calls send the change after a pause.
 */
export function syncCart(locale: Locale): void {
  if (!started) {
    started = true;
    void authed(locale, `/me/cart?locale=${locale}`, CartDto).then((res) => {
      if (!res.ok) return;
      if (res.data.lines.length > 0) adopt(res.data);
      else void push(locale);
    });
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => {
    void push(locale);
  }, PUSH_DELAY_MS);
}
