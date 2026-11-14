/**
 * Bulk quote rules (spec 19) shared by the database layer, the API and the website. Zod-free on purpose: the db
 * package imports it at runtime (L101/L102 — a Zod-building module loaded before `@hono/zod-openapi` breaks the
 * API's schemas). Request and response schemas live in `quote-api.ts`.
 */

/** Public quote code: QT-{CITY}-{YYYY}-{6 base32}. */
export const QUOTE_CODE_RE = /^QT-[A-Z]{3}-[0-9]{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

/** Products per quote and units per product (an accepted quote becomes a normal order: 1–99 units per line). */
export const QUOTE_MAX_LINES = 20;
export const QUOTE_LINE_MAX_QTY = 99;

/** Quotes a customer may have open (open, negotiating or offered) at once. */
export const QUOTE_OPEN_LIMIT = 3;

/** One chat message, and how many a customer may send per quote in an hour. */
export const QUOTE_MESSAGE_MAX = 1000;
export const QUOTE_CUSTOMER_MESSAGES_PER_HOUR = 30;

/** A thread returns its newest messages (no unbounded reads); older ones stay in the database. */
export const QUOTE_THREAD_LIMIT = 200;

/** Offer limits: validity in days, per-unit price and delivery charge (integer paise), the terms text. */
export const QUOTE_OFFER_MIN_DAYS = 1;
export const QUOTE_OFFER_MAX_DAYS = 30;
export const QUOTE_OFFER_MAX_UNIT_PAISE = 10_000_000;
export const QUOTE_OFFER_MAX_DELIVERY_PAISE = 1_000_000;
export const QUOTE_TERMS_MAX = 500;

/** Staff message shown to the customer when withdrawing a quote. */
export const QUOTE_WITHDRAW_MESSAGE_MIN = 10;
export const QUOTE_WITHDRAW_MESSAGE_MAX = 500;

/** A quote nobody wrote on for this many days closes as `expired` (reason `inactive`). */
export const QUOTE_INACTIVE_DAYS = 30;

/** Offer total from per-line unit prices and quantities plus delivery (integer paise). */
export function quoteOfferTotal(
  lines: readonly { qty: number; unitPaise: number }[],
  deliveryPaise: number,
): { subtotalPaise: number; totalPaise: number } {
  const subtotalPaise = lines.reduce((sum, l) => sum + l.unitPaise * l.qty, 0);
  return { subtotalPaise, totalPaise: subtotalPaise + deliveryPaise };
}
