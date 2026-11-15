/**
 * Customer storefront state kept on the server (spec 03 "Server cart", spec 02 "Wishlist", design 2026-11-15).
 * - `carts` / `cart_items`: one active cart per customer (partial unique index), lines are a pack (variant) and a
 *   quantity only; never a price, so a client cannot name its own price. Written only by `repo/cart.ts`.
 * - `wishlist_items`: products a customer saved, at most `WISHLIST_MAX` per customer (held by the repository under the
 *   user-row lock). Written only by `repo/wishlist.ts`.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CART_MAX_QTY } from '@mechdost/shared/cart-api';
import { createdAt, id, updatedAt, version } from './_common';
import { productVariants, products } from './catalogue';
import { users } from './identity';

export const CART_STATUSES = ['active', 'closed'] as const;

export const carts = pgTable(
  'carts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull().default('active'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('carts_status_valid', sql`${t.status} in ('active','closed')`),
    uniqueIndex('carts_one_active_per_user')
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: id(),
    cartId: uuid()
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: 'restrict' }),
    qty: smallint().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('cart_items_qty_range', sql`${t.qty} between 1 and ${sql.raw(String(CART_MAX_QTY))}`),
    unique('cart_items_cart_variant_uq').on(t.cartId, t.variantId),
    index().on(t.variantId),
  ],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [unique('wishlist_items_user_product_uq').on(t.userId, t.productId), index().on(t.productId)],
);
