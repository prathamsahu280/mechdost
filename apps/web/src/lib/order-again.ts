import { ReorderDto } from '@mechdost/shared/cart-api';
import { DATA_MODE } from './data-mode';
import { foldDemoCart, type ReorderOutcome } from './order-again-core';

/**
 * "Order again" (audience entry 2026-11-22, item 4), run when the button is pressed. This module (zod schema, the API
 * client, the cart sync, the demo store) is fetched with `import()` from the button, so none of it rides in the first
 * load of the layout, home, /shop or /cart (spec 16 budget incident).
 *
 * Real data mode: one `POST /v1/me/cart/reorder` (the server folds the order into the saved cart, re-priced by the
 * checkout quote later, and answers with what was added and what was not), then the browser cart adopts the server's
 * cart through the usual sync. Demo mode: the same rules on the browser cart. Resolves to `null` when it failed.
 */
export async function orderAgain(locale: string, code: string): Promise<ReorderOutcome | null> {
  if (DATA_MODE === 'api') return viaApi(locale, code);
  return viaDemo(locale, code);
}

async function viaApi(locale: string, code: string): Promise<ReorderOutcome | null> {
  const { authed } = await import('./orders-api');
  const res = await authed(locale, `/me/cart/reorder?locale=${locale === 'hi' ? 'hi' : 'en'}`, ReorderDto, {
    method: 'POST',
    body: { orderCode: code },
  });
  if (!res.ok) return null;
  const { refreshCart } = await import('./cart-sync');
  void refreshCart(locale === 'hi' ? 'hi' : 'en');
  const { added, already, missing } = res.data;
  return { added, already, missing: missing.map((m) => ({ name: m.name, reason: m.reason })) };
}

async function viaDemo(locale: string, code: string): Promise<ReorderOutcome | null> {
  const [{ cartNow, storeCore, replaceCart }, { findProduct }, { productNameFor }] = await Promise.all([
    import('@/demo/store'),
    import('@/demo/catalogue'),
    import('@/demo/i18n/localize'),
  ]);
  // storeCore, not a new store export: a new export keeps its code in /shop's first load (JS budget 2026-11-22).
  const order = storeCore.ordersSnapshot().find((o) => o.code === code);
  if (!order) return null;
  const folded = foldDemoCart(
    cartNow(),
    order.lines.map((l) => ({ slug: l.slug, name: productNameFor(l.slug, l.name, locale), qty: l.qty })),
    (slug) => findProduct(slug) !== undefined,
  );
  if (folded.added > 0 && !replaceCart(folded.cart)) return null;
  return { added: folded.added, already: folded.already, missing: folded.missing };
}
