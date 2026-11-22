import { CART_MAX_LINES, CART_MAX_QTY, type CartDropReason } from '@mechdost/shared/cart-api';

/**
 * "Order again" (audience entry 2026-11-22, item 4): what one press did, the same shape in demo and real mode. Lines
 * that could not be added are named (the name the customer saw on the order) and carry a reason code, never dropped
 * silently.
 */
export interface ReorderOutcome {
  /** Lines put in the cart or raised to the ordered quantity. */
  added: number;
  /** Lines the cart already held with at least the ordered quantity. */
  already: number;
  missing: { name: string; reason: CartDropReason }[];
}

interface CartRow {
  slug: string;
  qty: number;
  sku?: string;
}

/**
 * The browser cart (demo mode) with an old order folded in, by the same rules as the server: the larger quantity wins
 * (so a second press changes nothing), at most 20 products and 99 of each, and a product no longer sold is reported.
 * Pure: the caller saves `cart`.
 */
export function foldDemoCart(
  cart: readonly CartRow[],
  wanted: readonly { slug: string; name: string; qty: number }[],
  isSold: (slug: string) => boolean,
): ReorderOutcome & { cart: CartRow[] } {
  const next = cart.map((l) => ({ ...l }));
  const out: ReorderOutcome = { added: 0, already: 0, missing: [] };
  for (const w of wanted) {
    const qty = Math.min(CART_MAX_QTY, w.qty);
    if (!isSold(w.slug)) {
      out.missing.push({ name: w.name, reason: 'not_for_sale' });
      continue;
    }
    const have = next.find((l) => l.slug === w.slug);
    if (have) {
      if (qty > have.qty) {
        have.qty = qty;
        out.added += 1;
      } else out.already += 1;
      continue;
    }
    if (next.length >= CART_MAX_LINES) {
      out.missing.push({ name: w.name, reason: 'too_many_lines' });
      continue;
    }
    next.push({ slug: w.slug, qty });
    out.added += 1;
  }
  return { ...out, cart: next };
}

/**
 * The sentences of the "order again" status line joined into one, each ending in exactly one full stop (a message may
 * already end with one, as "Nothing was added to your cart." does: joining blindly gave "cart.. 1 product"). Hindi
 * ends with the danda.
 */
export function joinSentences(parts: readonly string[], locale: string): string {
  const stop = locale === 'hi' ? '।' : '.';
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.।!?]$/.test(p) ? p : `${p}${stop}`))
    .join(' ');
}
