/**
 * The server cart (spec 03 "Server cart", design 2026-11-15 item 3). The browser keeps a working copy; the server
 * keeps the signed-in customer's cart so it follows them between devices, and merges the guest cart at sign-in. The
 * cart holds a SKU and a quantity only, never a price: every price the customer sees comes from the checkout quote
 * (spec 03), so a client cannot name its own price. Hard rule 4: one schema, used by the API and the website.
 */
import { z } from 'zod';

export const CART_MAX_LINES = 20;
export const CART_MAX_QTY = 99;
export const CART_SKU_RE = /^[A-Z0-9][A-Z0-9-]{1,47}$/;

export const CartLineIn = z
  .object({
    sku: z.string().regex(CART_SKU_RE),
    qty: z.number().int().min(1).max(CART_MAX_QTY),
  })
  .strict();
export type CartLineInput = z.infer<typeof CartLineIn>;

const Lines = z.array(CartLineIn).max(CART_MAX_LINES);
/** Add to a line (several devices adding the same pack sum) or set a line's quantity (last write wins for that line). */
export const CartLineQtyBody = z.object({ qty: z.number().int().min(1).max(CART_MAX_QTY) }).strict();
/** The pack in the path of the line routes. */
export const CartSkuParam = z.string().regex(CART_SKU_RE);
/** Fold a guest cart into the stored one (idempotent: the larger quantity wins, never the sum). */
export const CartMergeBody = z.object({ lines: Lines }).strict();

export const CART_DROP_REASONS = ['unknown_sku', 'not_for_sale', 'too_many_lines'] as const;
export type CartDropReason = (typeof CART_DROP_REASONS)[number];

export const CartLineDto = z.object({
  sku: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  qty: z.number().int(),
});

export const CartDto = z.object({
  lines: z.array(CartLineDto),
  /** Lines of the request the server did not keep, with a code (the website words it in the locale). */
  dropped: z.array(z.object({ sku: z.string(), reason: z.enum(CART_DROP_REASONS) })),
  /** The cart's version: moves on every effective change; 0 before the first one. The refresh sends it back as `since`. */
  version: z.number().int().min(0),
});
/** The answer to `GET /me/cart?since=` when nothing changed: no body worth sending. */
export const CartUnchangedDto = z.object({ unchanged: z.literal(true), version: z.number().int().min(0) });
export type ServerCart = z.infer<typeof CartDto>;

/** "Order again": the public code of one of the customer's own orders (`MD-{CITY}-{YYYY}-{6 base32}`, no part suffix). */
export const REORDER_CODE_RE = /^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;
export const ReorderBody = z.object({ orderCode: z.string().regex(REORDER_CODE_RE) }).strict();
export const ReorderDto = z.object({
  cart: CartDto,
  /** Lines put in the cart or raised to the ordered quantity. */
  added: z.number().int().min(0),
  /** Lines the cart already held with at least the ordered quantity. */
  already: z.number().int().min(0),
  /** Lines that could not be added, with the name the customer saw on the order and a code for the reason. */
  missing: z.array(z.object({ sku: z.string(), name: z.string(), reason: z.enum(CART_DROP_REASONS) })),
});
export type Reorder = z.infer<typeof ReorderDto>;
