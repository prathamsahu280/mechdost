import { and, eq, sql } from 'drizzle-orm';
import {
  CART_MAX_LINES,
  CART_MAX_QTY,
  type CartDropReason,
  type CartLineInput,
  type ServerCart,
} from '@mechdost/shared/cart-api';
import { auditLog, cartItems, carts, orderGroups, orderItems, orders, users } from '../schema';
import { uuidv7 } from '../schema/_common';
import { NotFoundError, ValidationError } from './errors';
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
 *
 * Several devices (user 2026-11-15: phone and laptop at the same time, nothing may be lost): the server cart is the
 * source of truth and the browser copy is a cache, so writes are **one line at a time** — add (increment; adds from two
 * devices sum), set (that line's quantity, last write wins for that line only) and remove (idempotent). Each is one
 * conditional statement under the customer's row lock, so the 20-line and 99-quantity limits hold under parallel
 * requests. Every *effective* change touches the cart row, which moves its `version` (a trigger) and writes one live
 * ping (trigger `carts_live`); a no-op changes and pings nothing. The version doubles as the refresh's ETag.
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
    qty: r.qty,
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

/** Moves the cart's version (the bump trigger) and with it writes the live ping. Call only after a real change. */
async function touch(tx: Tx, cartId: string): Promise<void> {
  await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

async function snapshot(
  tx: Tx,
  cartId: string,
  locale: CartLocale,
  dropped: ServerCart['dropped'] = [],
): Promise<ServerCart> {
  const [row] = await tx.select({ version: carts.version }).from(carts).where(eq(carts.id, cartId));
  return { lines: await readLines(tx, cartId, locale), dropped, version: row?.version ?? 0 };
}

/** The cart as it stands, with unsellable lines removed (and reported once). */
export async function getCart(db: Tx, userId: string, locale: CartLocale = 'en'): Promise<ServerCart> {
  return db.transaction(async (tx) => {
    const [cart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
    if (!cart) return { lines: [], dropped: [], version: 0 };
    const dropped = await pruneUnsellable(tx, cart.id);
    if (dropped.length > 0) await touch(tx, cart.id);
    return snapshot(tx, cart.id, locale, dropped);
  });
}

/** The refresh: the cart, or `{ unchanged: true }` when its version is still the one the caller already has. */
export async function getCartIfChanged(
  db: Tx,
  userId: string,
  locale: CartLocale,
  since: number,
): Promise<ServerCart | { unchanged: true; version: number }> {
  const [cart] = await db
    .select({ id: carts.id, version: carts.version })
    .from(carts)
    .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
  if (!cart) return since === 0 ? { unchanged: true, version: 0 } : getCart(db, userId, locale);
  // One indexed read when nothing changed (a pack that stopped being sold is noticed by the next real read).
  if (cart.version === since) return { unchanged: true, version: since };
  return getCart(db, userId, locale);
}

async function sellableVariant(tx: Tx, sku: string): Promise<string> {
  const r = (await resolve(tx, [sku])).get(sku);
  if (!r?.variantId || !r.sellable)
    throw new ValidationError('This product is not available', 'CART_LINE_UNAVAILABLE');
  return r.variantId;
}

/**
 * One conditional statement: insert the line (only while the cart has room, or the line already exists) or update it
 * (`add`: increase, capped at 99; `set`: that quantity). Returns whether a row changed.
 */
async function upsertLine(
  tx: Tx,
  cartId: string,
  variantId: string,
  qty: number,
  mode: 'add' | 'set',
): Promise<boolean> {
  const onConflict =
    mode === 'add'
      ? sql`update set qty = least(cart_items.qty + excluded.qty, ${CART_MAX_QTY}) where cart_items.qty < ${CART_MAX_QTY}`
      : sql`update set qty = excluded.qty where cart_items.qty <> excluded.qty`;
  const rows = rowsOf<{ n: number }>(
    await tx.execute(sql`
      with up as (
        insert into cart_items (id, cart_id, variant_id, qty)
        select ${uuidv7()}::uuid, ${cartId}::uuid, ${variantId}::uuid, least(${qty}::int, ${CART_MAX_QTY})
        where (select count(*) from cart_items where cart_id = ${cartId}::uuid) < ${CART_MAX_LINES}
          or exists (select 1 from cart_items where cart_id = ${cartId}::uuid and variant_id = ${variantId}::uuid)
        on conflict (cart_id, variant_id) do ${onConflict}
        returning 1)
      select count(*)::int as n from up`),
  );
  if ((rows[0]?.n ?? 0) > 0) return true;
  const [exists] = await tx
    .select({ id: cartItems.id })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
  if (!exists)
    throw new ValidationError(`A cart holds up to ${String(CART_MAX_LINES)} products`, 'CART_MAX_LINES');
  return false;
}

async function lineChange(
  db: Tx,
  userId: string,
  sku: string,
  qty: number,
  mode: 'add' | 'set',
  locale: CartLocale,
): Promise<ServerCart> {
  return db.transaction(async (tx) => {
    const cartId = await lockedCart(tx, userId);
    const variantId = await sellableVariant(tx, sku);
    if (await upsertLine(tx, cartId, variantId, qty, mode)) await touch(tx, cartId);
    return snapshot(tx, cartId, locale);
  });
}

/** Add `qty` of a pack (several devices adding the same pack sum; the line stops at 99). */
export const addCartLine = (db: Tx, userId: string, sku: string, qty: number, locale: CartLocale = 'en') =>
  lineChange(db, userId, sku, qty, 'add', locale);

/** Set a pack's quantity (last write wins for this line only; other lines are untouched). */
export const setCartLine = (db: Tx, userId: string, sku: string, qty: number, locale: CartLocale = 'en') =>
  lineChange(db, userId, sku, qty, 'set', locale);

/** Remove a pack. Removing what is not there changes nothing (and never creates a cart). */
export async function removeCartLine(
  db: Tx,
  userId: string,
  sku: string,
  locale: CartLocale = 'en',
): Promise<ServerCart> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) throw new NotFoundError('User not found');
    const [cart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
    if (!cart) return { lines: [], dropped: [], version: 0 };
    const gone = rowsOf<{ id: string }>(
      await tx.execute(sql`
        delete from cart_items ci using product_variants v
        where ci.cart_id = ${cart.id} and v.id = ci.variant_id and v.sku = ${sku}
        returning ci.id`),
    );
    if (gone.length > 0) await touch(tx, cart.id);
    return snapshot(tx, cart.id, locale);
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
    await touch(tx, cartId);
    return snapshot(tx, cartId, locale, dropped);
  });
}

interface FoldResult extends MergeResult {
  raised: number;
  dropped: ServerCart['dropped'];
  /** Lines of the request that are on sale (added, raised, or already there with enough). */
  sellable: number;
}

/**
 * Fold lines into the stored cart: the larger quantity wins, never the sum, so doing it twice changes nothing. Lines
 * beyond the 20-line limit and unsellable SKUs are dropped with a reason. Audited under `auditAction`.
 */
async function foldInto(
  tx: Tx,
  userId: string,
  lines: readonly CartLineInput[],
  locale: CartLocale,
  auditAction: string,
): Promise<FoldResult> {
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
  const wanted = distinct(lines);
  const resolved = await resolve(
    tx,
    wanted.map((l) => l.sku),
  );
  const dropped: ServerCart['dropped'] = [];
  let added = 0;
  let raised = 0;
  let sellable = 0;
  let total = existing.size;
  for (const l of wanted) {
    const r = resolved.get(l.sku);
    if (!r?.variantId || !r.sellable) {
      if (r) dropped.push({ sku: l.sku, reason: reasonOf(r) });
      continue;
    }
    const have = existing.get(r.variantId);
    if (have !== undefined) {
      sellable += 1;
      if (l.qty > have) {
        await tx
          .update(cartItems)
          .set({ qty: l.qty })
          .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, r.variantId)));
        raised += 1;
      }
      continue;
    }
    if (total >= CART_MAX_LINES) {
      dropped.push({ sku: l.sku, reason: 'too_many_lines' });
      continue;
    }
    await tx.insert(cartItems).values({ cartId, variantId: r.variantId, qty: l.qty });
    total += 1;
    added += 1;
    sellable += 1;
  }
  const pruned = await pruneUnsellable(tx, cartId);
  if (added + raised + pruned.length > 0) await touch(tx, cartId);
  await tx.insert(auditLog).values({
    actorUserId: userId,
    actorRole: 'customer',
    action: auditAction,
    entity: 'cart',
    entityId: cartId,
    after: { kept, added, dropped: dropped.length },
  });
  return {
    cart: await snapshot(tx, cartId, locale, [...dropped, ...pruned]),
    kept,
    added,
    raised,
    dropped,
    sellable,
  };
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
    const r = await foldInto(tx, userId, lines, locale, 'cart.merge');
    await recordServerEvent(tx, 'cart_merged', {
      userId,
      props: { kept: r.kept, added: r.added, dropped: r.dropped.length },
    });
    return { cart: r.cart, kept: r.kept, added: r.added };
  });
}

export interface ReorderResult {
  cart: ServerCart;
  /** Lines put in the cart or raised to the ordered quantity. */
  added: number;
  /** Lines the cart already held with at least the ordered quantity. */
  already: number;
  /** Lines not added, with the name the customer saw on the order. */
  missing: { sku: string; name: string; reason: CartDropReason }[];
}

/**
 * "Order again" (audience entry 2026-11-22, item 4): the SKUs and quantities of one of the customer's own orders go
 * into the cart. No price of the old order is read: the cart holds SKU and quantity, and every price comes from the
 * checkout quote, so the order is re-priced live. Same rules as the guest merge (the larger quantity wins, so a second
 * press changes nothing; the 20-line and 99-quantity limits hold). Packs no longer sold are reported with the name
 * from the order, never dropped silently. Another customer's order code is a 404 (actor-scoped, hard rule 3).
 */
export async function reorderCart(
  db: Tx,
  userId: string,
  groupCode: string,
  locale: CartLocale = 'en',
): Promise<ReorderResult> {
  return db.transaction(async (tx) => {
    const [g] = await tx
      .select({ id: orderGroups.id })
      .from(orderGroups)
      .where(and(eq(orderGroups.userId, userId), eq(orderGroups.code, groupCode)));
    if (!g) throw new NotFoundError('Order not found');
    const items = await tx
      .select({
        sku: orderItems.sku,
        title: orderItems.title,
        titleHi: orderItems.titleHi,
        qty: orderItems.qty,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(eq(orders.groupId, g.id))
      .orderBy(orders.subNo, orderItems.sku);
    const names = new Map(items.map((i) => [i.sku, localized(i.title, i.titleHi, locale)]));
    const qtys = new Map<string, number>();
    for (const i of items) qtys.set(i.sku, Math.min((qtys.get(i.sku) ?? 0) + i.qty, CART_MAX_QTY));
    const r = await foldInto(
      tx,
      userId,
      [...qtys].map(([sku, qty]) => ({ sku, qty })),
      locale,
      'cart.reorder',
    );
    const missing = r.dropped.map((d) => ({
      sku: d.sku,
      name: names.get(d.sku) ?? d.sku,
      reason: d.reason,
    }));
    const changed = r.added + r.raised;
    await recordServerEvent(tx, 'order_again', {
      userId,
      props: { orderId: g.id, added: changed, missing: missing.length },
    });
    return { cart: r.cart, added: changed, already: r.sellable - changed, missing };
  });
}

/**
 * An order was placed (cash on delivery) or paid (online): the packs it contains leave the customer's saved cart in the
 * same transaction, so their other devices show it on the next refresh and a stale browser copy cannot offer them again.
 * Either the SKUs of the order or the order group is given. A cart with nothing of the order is left alone (no version
 * move, no ping).
 */
export async function removeOrderedCartLines(
  tx: Tx,
  userId: string,
  ordered: { skus: readonly string[] } | { groupId: string },
): Promise<void> {
  const [cart] = await tx
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.userId, userId), eq(carts.status, 'active')));
  if (!cart) return;
  const gone =
    'skus' in ordered
      ? rowsOf<{ id: string }>(
          await tx.execute(sql`
            delete from cart_items ci using product_variants v
            where ci.cart_id = ${cart.id} and v.id = ci.variant_id
              and v.sku in (select jsonb_array_elements_text(${JSON.stringify(ordered.skus)}::jsonb))
            returning ci.id`),
        )
      : rowsOf<{ id: string }>(
          await tx.execute(sql`
            delete from cart_items ci
            where ci.cart_id = ${cart.id} and ci.variant_id in (
              select oi.variant_id from order_items oi join orders o on o.id = oi.order_id
              where o.group_id = ${ordered.groupId})
            returning ci.id`),
        );
  if (gone.length > 0) await touch(tx, cart.id);
}
