import { QUOTE_ATTACH_MAX } from '@mechdost/shared/quote-rules';
import { PHOTO_MAX_BYTES } from '@mechdost/shared/service-photos';
import type { QuoteStatus } from '@mechdost/shared/state';
import { parseRupees, type RupeeError } from './money-input';

/**
 * Pure helpers for the real-mode bulk quote screens (spec 19): API error codes and quote states → `quote` locale
 * keys (no raw code ever reaches the screen), and the staff offer builder's input parsing (integer paise).
 */
/** Where the request form reads the rules: the PIN code's city value once the PIN is complete, else the global one. */
export function quoteRulesPath(pincode: string | null): string {
  const pin = pincode?.trim() ?? '';
  return /^[1-9]\d{5}$/.test(pin) ? `/quotes/rules?pincode=${pin}` : '/quotes/rules';
}

/** Photos the API would refuse, refused here first (count, size, type) so the message shows without a round trip. */
export function quotePhotoProblem(
  files: readonly File[],
): 'ATTACHMENT_LIMIT' | 'PHOTO_TOO_LARGE' | 'PHOTO_TYPE' | null {
  if (files.length > QUOTE_ATTACH_MAX) return 'ATTACHMENT_LIMIT';
  if (files.some((f) => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) return 'PHOTO_TYPE';
  return files.some((f) => f.size > PHOTO_MAX_BYTES) ? 'PHOTO_TOO_LARGE' : null;
}

export type QuoteMessageKey =
  | 'api_err_min'
  | 'api_err_openLimit'
  | 'api_err_product'
  | 'api_err_pincode'
  | 'api_err_duplicate'
  | 'api_err_closed'
  | 'api_err_stock'
  | 'api_err_cod'
  | 'api_err_staleQuote'
  | 'api_err_verify'
  | 'api_err_auth'
  | 'api_err_rate'
  | 'api_err_network'
  | 'api_err_notFound'
  | 'api_err_generic'
  | 'api_err_codCap'
  | 'api_err_codBlocked'
  | 'api_err_payUnavailable'
  | 'api_err_attachLimit'
  | 'api_err_photoLarge'
  | 'api_err_photoType'
  | 'api_err_photoHeic'
  | 'api_err_photosUnavailable'
  | 'api_err_photoNote'
  | 'api_err_notPayable'
  | 'api_admin_confirmLowNeeded'
  | 'stale'
  | 'expired'
  | 'blockedOrders';

const BY_CODE: Record<string, QuoteMessageKey> = {
  QUOTE_MIN_UNITS: 'api_err_min',
  QUOTE_OPEN_LIMIT: 'api_err_openLimit',
  QUOTE_PRODUCT_UNAVAILABLE: 'api_err_product',
  PINCODE_NOT_SERVICEABLE: 'api_err_pincode',
  DUPLICATE_LINE: 'api_err_duplicate',
  QUOTE_CLOSED: 'api_err_closed',
  QUOTE_OFFER_STALE: 'stale',
  QUOTE_OFFER_EXPIRED: 'expired',
  CHECKOUT_UNAVAILABLE: 'api_err_stock',
  OUT_OF_STOCK: 'api_err_stock',
  ORDERS_BLOCKED: 'blockedOrders',
  COD_NOT_ALLOWED: 'api_err_cod',
  STALE_QUOTE: 'api_err_staleQuote',
  VERIFICATION_REQUIRED: 'api_err_verify',
  AUTH_REQUIRED: 'api_err_auth',
  HTTP_401: 'api_err_auth',
  QUOTE_MESSAGE_LIMIT: 'api_err_rate',
  QUOTE_COD_CAP: 'api_err_codCap',
  QUOTE_COD_BLOCKED: 'api_err_codBlocked',
  PAYMENT_METHOD_UNAVAILABLE: 'api_err_payUnavailable',
  ATTACHMENT_LIMIT: 'api_err_attachLimit',
  PHOTO_TOO_LARGE: 'api_err_photoLarge',
  HTTP_413: 'api_err_photoLarge',
  PHOTO_TYPE: 'api_err_photoType',
  PHOTO_UNREADABLE: 'api_err_photoType',
  PHOTO_HEIC: 'api_err_photoHeic',
  PHOTOS_UNAVAILABLE: 'api_err_photosUnavailable',
  QUOTE_NOT_PAYABLE: 'api_err_notPayable',
  QUOTE_OFFER_CONFIRM_LOW: 'api_admin_confirmLowNeeded',
  RATE_LIMITED: 'api_err_rate',
  HTTP_429: 'api_err_rate',
  NOT_FOUND: 'api_err_notFound',
  HTTP_404: 'api_err_notFound',
  NETWORK: 'api_err_network',
  UNAVAILABLE: 'api_err_network',
};

export function quoteErrorKey(code: string): QuoteMessageKey {
  const known = BY_CODE[code];
  if (known) return known;
  if (/^HTTP_5\d\d$/.test(code)) return 'api_err_network';
  return 'api_err_generic';
}

const STATUS_KEY = {
  open: 'status_open',
  negotiating: 'api_status_negotiating',
  offered: 'status_offered',
  accepted: 'status_accepted',
  declined: 'status_declined',
  expired: 'api_status_expired',
  withdrawn: 'api_status_withdrawn',
} as const satisfies Record<QuoteStatus, string>;

export type QuoteStatusKey = (typeof STATUS_KEY)[QuoteStatus];

export function quoteStatusKey(status: QuoteStatus): QuoteStatusKey {
  return STATUS_KEY[status];
}

/** A fresh Idempotency-Key (32 hex characters): one per attempt, reused for its retries. */
export function newQuoteKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** An offer waits for the customer's decision (account badge). */
export function quoteWaitsForCustomer(q: {
  status: QuoteStatus;
  offer: { expired: boolean } | null;
}): boolean {
  return q.status === 'offered' && q.offer !== null && !q.offer.expired;
}

export type OfferField = `price-${string}` | 'delivery' | 'days';
export type OfferDraft =
  | {
      ok: true;
      lines: { lineNo: number; unitPaise: number }[];
      deliveryPaise: number;
      validDays: number;
      totalPaise: number;
    }
  | { ok: false; errors: Partial<Record<OfferField, RupeeError | 'range'>> };

/** The offer builder's typed values → an offer (integer paise), or the error of each wrong field. */
export function offerDraft(
  lines: readonly { lineNo: number; qty: number }[],
  prices: Readonly<Record<number, string>>,
  delivery: string,
  days: string,
): OfferDraft {
  const errors: Partial<Record<OfferField, RupeeError | 'range'>> = {};
  const priced: { lineNo: number; unitPaise: number }[] = [];
  let subtotal = 0;
  for (const l of lines) {
    const r = parseRupees(prices[l.lineNo] ?? '');
    if (r.ok) {
      priced.push({ lineNo: l.lineNo, unitPaise: r.paise });
      subtotal += r.paise * l.qty;
    } else errors[`price-${String(l.lineNo)}`] = r.error;
  }
  const d = parseRupees(delivery, { allowZero: true });
  if (!d.ok) errors.delivery = d.error;
  const daysValue = /^\d{1,2}$/.test(days.trim()) ? Number(days.trim()) : 0;
  if (daysValue < 1 || daysValue > 30) errors.days = 'range';
  if (Object.keys(errors).length > 0 || !d.ok) return { ok: false, errors };
  return {
    ok: true,
    lines: priced,
    deliveryPaise: d.paise,
    validDays: daysValue,
    totalPaise: subtotal + d.paise,
  };
}

/**
 * Offer lines that need the staff's explicit confirmation (review I2; the API refuses them without it): a unit price
 * below the shop price that can supply the line, or under a tenth of the list price (rupees typed as paise).
 */
export function lowPriceLines(
  lines: readonly { lineNo: number; costPaise: number | null; listUnitPaise: number | null }[],
  offer: readonly { lineNo: number; unitPaise: number }[],
): { belowCost: number[]; belowTenthOfList: number[] } {
  const belowCost: number[] = [];
  const belowTenthOfList: number[] = [];
  for (const o of offer) {
    const line = lines.find((l) => l.lineNo === o.lineNo);
    if (!line) continue;
    if (line.costPaise !== null && o.unitPaise < line.costPaise) belowCost.push(o.lineNo);
    if (line.listUnitPaise !== null && o.unitPaise * 10 < line.listUnitPaise) belowTenthOfList.push(o.lineNo);
  }
  return { belowCost, belowTenthOfList };
}
