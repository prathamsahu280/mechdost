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
/** Replace the stored cart with exactly these lines (an empty list empties it). */
export const CartPutBody = z.object({ lines: Lines }).strict();
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
});
export type ServerCart = z.infer<typeof CartDto>;
