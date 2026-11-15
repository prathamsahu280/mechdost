import { and, eq, sql } from 'drizzle-orm';
import {
  CART_MAX_LINES,
  CART_MAX_QTY,
  type CartDropReason,
  type CartLineInput,
  type ServerCart,
} from '@mechdost/shared/cart-api';
import { auditLog, cartItems, carts, users } from '../schema';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * The signed-in customer's server cart (spec 03 "Server cart", design 2026-11-15 item 3). Every function takes the
 * session's `userId` and touches only that customer's one active cart (partial unique index), so another customer's
 * cart cannot be named at all. The cart is a pack (SKU) and a quantity, never a price: prices, delivery and stock
 * come from the checkout quote when the cart is priced, so a client cannot make up a price (hard rule 3). Writes lock
 * the customer's user row first, so two devices writing together queue up instead of racing past the 20-line limit.
 * Lines whose pack stopped being sold are removed when the cart is read, and reported (`not_for_sale`).
 */
export type CartLocale = 'en' | 'hi';
export interface MergeResult {
  cart: ServerCart;
  /** Lines the cart already had, and lines this merge added to it. */
  kept: number;
  added: number;
}

interface Resolved {
  sku: string;
  variantId: string | null;
  sellable: boolean;
}

/** The customer's active cart id, created on first use; the user row is locked, so this cannot race. */
async function lockedCart(tx: Tx, userId: string): Promise<string> {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  if (!u) throw new NotFoundError('User not found');
  const [existing] = await tx
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
  if (existing) return existing.id;
  const [created] = await tx.insert(carts).values({ userId }).returning({ id: carts.id });
  if (!created) throw new NotFoundError('Cart not found');
  return created.id;
}

/** Which of these SKUs exist, and which of those are on sale (active pack of a live product). */
async function resolve(tx: Tx, skus: readonly string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>(skus.map((sku) => [sku, { sku, variantId: null, sellable: false }]));
  if (skus.length === 0) return out;
  const rows = rowsOf<{ sku: string; id: string; sellable: boolean }>(
    await tx.execute(sql`
      select v.sku, v.id, (v.status = 'active' and p.status = 'live') as sellable
      from product_variants v join products p on p.id = v.product_id
      where v.sku in (select jsonb_array_elements_text(${JSON.stringify(skus)}::jsonb))`),
  );
  for (const r of rows) out.set(r.sku, { sku: r.sku, variantId: r.id, sellable: r.sellable });
  return out;
}

const reasonOf = (r: Resolved): CartDropReason => (r.variantId === null ? 'unknown_sku' : 'not_for_sale');

async function readLines(tx: Tx, cartId: string, locale: CartLocale): Promise<ServerCart['lines']> {
  const rows = rowsOf<{
    sku: string;
    slug: string;
    name: string;
    name_hi: string | null;
    brand: string;
    qty: number;
  }>(
    await tx.execute(sql`
      select v.sku, p.slug, p.name, p.name_hi, b.name as brand, ci.qty
      from cart_items ci
      join product_variants v on v.id = ci.variant_id
      join products p on p.id = v.product_id
      join brands b on b.id = p.brand_id
      where ci.cart_id = ${cartId}
      order by ci.created_at, v.sku`),
  );
  return rows.map((r) => ({
    sku: r.sku,
    slug: r.slug,
    name: localized(r.name, r.name_hi, locale),
    brand: r.brand,
    qty: Number(r.qty),
  }));
}

/** Delete lines whose pack is no longer sold; returns what was removed. */
async function pruneUnsellable(tx: Tx, cartId: string): Promise<ServerCart['dropped']> {
  const gone = rowsOf<{ sku: string }>(
    await tx.execute(sql`
      delete from cart_items ci using product_variants v, products p
      where ci.cart_id = ${cartId} and v.id = ci.variant_id and p.id = v.product_id
        and (v.status <> 'active' or p.status <> 'live')
      returning v.sku`),
  );
  return gone.map((g) => ({ sku: g.sku, reason: 'not_for_sale' as const }));
}

/** The cart as it stands, with unsellable lines removed (and reported once). */
export async function getCart(db: Tx, userId: string, locale: CartLocale = 'en'): Promise<ServerCart> {
  return db.transaction(async (tx) => {
    const [cart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
    if (!cart) return { lines: [], dropped: [] };
    const dropped = await pruneUnsellable(tx, cart.id);
    return { lines: await readLines(tx, cart.id, locale), dropped };
  });
}

/** Dedupe by SKU keeping the larger quantity (a request that repeats a pack means "at most this many"). */
function distinct(lines: readonly CartLineInput[]): CartLineInput[] {
  const by = new Map<string, number>();
  for (const l of lines) by.set(l.sku, Math.max(by.get(l.sku) ?? 0, Math.min(l.qty, CART_MAX_QTY)));
  return [...by].map(([sku, qty]) => ({ sku, qty }));
}

/** Make the stored cart exactly these lines (unsellable SKUs are left out and reported). */
export async function replaceCart(
  db: Tx,
  userId: string,
  lines: readonly CartLineInput[],
  locale: CartLocale = 'en',
): Promise<ServerCart> {
  return db.transaction(async (tx) => {
    const cartId = await lockedCart(tx, userId);
    const wanted = distinct(lines).slice(0, CART_MAX_LINES);
    const resolved = await resolve(
      tx,
      wanted.map((l) => l.sku),
    );
    const dropped: ServerCart['dropped'] = [];
    const keep: { variantId: string; qty: number }[] = [];
    for (const l of wanted) {
      const r = resolved.get(l.sku);
      if (r?.variantId && r.sellable) keep.push({ variantId: r.variantId, qty: l.qty });
      else if (r) dropped.push({ sku: l.sku, reason: reasonOf(r) });
    }
    await tx.execute(sql`
      delete from cart_items where cart_id = ${cartId}
        and variant_id not in (select (jsonb_array_elements_text(${JSON.stringify(keep.map((k) => k.variantId))}::jsonb))::uuid)`);
    if (keep.length > 0)
      await tx
        .insert(cartItems)
        .values(keep.map((k) => ({ cartId, variantId: k.variantId, qty: k.qty })))
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.variantId],
          set: { qty: sql`excluded.qty` },
          setWhere: sql`${cartItems.qty} <> excluded.qty`,
        });
    await recordServerEvent(tx, 'cart_replaced', {
      userId,
      props: { lines: keep.length, dropped: dropped.length },
    });
    return { lines: await readLines(tx, cartId, locale), dropped };
  });
}

/**
 * Fold a guest cart into the stored one at sign-in. The larger quantity wins, never the sum, so sending the same
 * guest cart twice (a retry, a second tab) changes nothing. Lines beyond the 20-line limit and unsellable SKUs are
 * dropped with a reason. Audited (it is the one moment two carts become one).
 */
export async function mergeCart(
  db: Tx,
  userId: string,
  lines: readonly CartLineInput[],
  locale: CartLocale = 'en',
): Promise<MergeResult> {
  return db.transaction(async (tx) => {
    const cartId = await lockedCart(tx, userId);
    const existing = new Map(
      (
        await tx
          .select({ variantId: cartItems.variantId, qty: cartItems.qty })
          .from(cartItems)
          .where(eq(cartItems.cartId, cartId))
      ).map((r) => [r.variantId, r.qty]),
    );
    const kept = existing.size;
    const guest = distinct(lines);
    const resolved = await resolve(
      tx,
      guest.map((l) => l.sku),
    );
    const dropped: ServerCart['dropped'] = [];
    let added = 0;
    let total = existing.size;
    for (const l of guest) {
      const r = resolved.get(l.sku);
      if (!r?.variantId || !r.sellable) {
        if (r) dropped.push({ sku: l.sku, reason: reasonOf(r) });
        continue;
      }
      const have = existing.get(r.variantId);
      if (have !== undefined) {
        if (l.qty > have)
          await tx
            .update(cartItems)
            .set({ qty: l.qty })
            .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, r.variantId)));
        continue;
      }
      if (total >= CART_MAX_LINES) {
        dropped.push({ sku: l.sku, reason: 'too_many_lines' });
        continue;
      }
      await tx.insert(cartItems).values({ cartId, variantId: r.variantId, qty: l.qty });
      total += 1;
      added += 1;
    }
    const pruned = await pruneUnsellable(tx, cartId);
    await tx.insert(auditLog).values({
      actorUserId: userId,
      actorRole: 'customer',
      action: 'cart.merge',
      entity: 'cart',
      entityId: cartId,
      after: { kept, added, dropped: dropped.length },
    });
    await recordServerEvent(tx, 'cart_merged', {
      userId,
      props: { kept, added, dropped: dropped.length },
    });
    return {
      cart: { lines: await readLines(tx, cartId, locale), dropped: [...dropped, ...pruned] },
      kept,
      added,
    };
  });
}
