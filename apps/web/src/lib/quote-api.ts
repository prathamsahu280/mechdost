import {
  QuoteAcceptedDto,
  QuoteChangedDto,
  QuoteCreatedDto,
  QuoteDetailDto,
  QuoteOfferSentDto,
  QuotePayDto,
  QuotePaymentVerifiedDto,
  QuoteReadDto,
  QuotePageDto,
  QuoteRulesDto,
  type AdminQuoteView,
  type QuoteDetail,
  type QuotePage,
  type QuoteRules,
} from '@mechdost/shared/quote-api';
import type { QuoteDeclineReason } from '@mechdost/shared/state';
import { adminApi } from './admin-api';
import { authed, type ApiResult } from './orders-api';
import { quoteRulesPath } from './quote-views';

/**
 * Bulk quotes on the MechDost API (real data mode; spec 19). Customer calls use the signed-in customer's token
 * (`authed`), the quote desk uses `adminApi`; every answer is validated with the shared response schemas (hard
 * rule 4) and errors come back as the API's code for the screen to translate (`quoteErrorKey`). Loaded only by the
 * real-mode quote screens (lazy imports), never by the demo pages or /shop and /cart.
 */
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');
const path = (code: string) => `/quotes/${encodeURIComponent(code)}`;
const adminPath = (code: string) => `/admin/quotes/${encodeURIComponent(code)}`;

export function fetchQuoteRules(
  locale: string,
  pincode: string | null = null,
): Promise<ApiResult<QuoteRules>> {
  return authed(locale, quoteRulesPath(pincode), QuoteRulesDto);
}

export interface NewQuote {
  lines: { slug: string; sku: string | null; qty: number }[];
  address: {
    contactName: string;
    contactPhone: string;
    line1: string;
    landmark: string | null;
    pincode: string;
  };
  note: string | null;
}

/** Ask for a bulk price. The same key for a retry of the same attempt returns the same quote (200 replay). */
export function createQuote(locale: string, input: NewQuote, idempotencyKey: string) {
  return authed(locale, '/quotes', QuoteCreatedDto, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      lines: input.lines.map((l) => (l.sku ? l : { slug: l.slug, qty: l.qty })),
      address: input.address,
      ...(input.note ? { note: input.note } : {}),
      locale: loc(locale),
    },
  });
}

export function fetchMyQuotes(locale: string, cursor?: string): Promise<ApiResult<QuotePage>> {
  const q = new URLSearchParams({ limit: '20', locale: loc(locale) });
  if (cursor) q.set('cursor', cursor);
  return authed(locale, `/quotes?${q.toString()}`, QuotePageDto);
}

export function fetchMyQuote(locale: string, code: string): Promise<ApiResult<QuoteDetail>> {
  return authed(locale, `${path(code)}?locale=${loc(locale)}`, QuoteDetailDto);
}

export function postQuoteMessage(locale: string, code: string, body: string) {
  return authed(locale, `${path(code)}/messages`, QuoteChangedDto, { method: 'POST', body: { body } });
}

/** The thread has been seen by this side (the newest message it shows). Quiet: a failure changes nothing on screen. */
export function markQuoteRead(locale: string, code: string, staff = false) {
  return staff
    ? adminApi(locale, `${adminPath(code)}/read`, QuoteReadDto, { method: 'POST' })
    : authed(locale, `${path(code)}/read`, QuoteReadDto, { method: 'POST' });
}

const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * A message with photos (multipart: text + up to four images). The same token and shared answer schema as the other
 * calls; the API decides types by their bytes, so the checks in `quotePhotoProblem` only save a round trip.
 */
export async function sendQuotePhotoMessage(
  locale: string,
  code: string,
  body: string,
  files: readonly File[],
  staff = false,
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!API) return { ok: false, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('./auth/firebase-client');
  const token = await currentIdToken(locale);
  if (!token) return { ok: false, code: 'AUTH_REQUIRED' };
  const form = new FormData();
  form.set('body', body);
  for (const file of files) form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API}/v1${staff ? adminPath(code) : path(code)}/photo-messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, code: 'NETWORK' };
  }
  const answer: unknown = await res.json().catch(() => null);
  if (res.ok)
    return QuoteChangedDto.safeParse(answer).success ? { ok: true } : { ok: false, code: 'BAD_RESPONSE' };
  const error = (answer as { error?: { code?: unknown } } | null)?.error;
  return { ok: false, code: typeof error?.code === 'string' ? error.code : `HTTP_${String(res.status)}` };
}

/** Accept exactly this offer version. The same key for a retry never places a second order. */
export function acceptQuote(
  locale: string,
  code: string,
  offerVersion: number,
  idempotencyKey: string,
  paymentMethod: 'cod' | 'online' = 'cod',
) {
  return authed(locale, `${path(code)}/accept`, QuoteAcceptedDto, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: { offerVersion, paymentMethod, locale: loc(locale) },
  });
}

/** "Pay now": the Razorpay handle of the accepted quote's unpaid online order (the same order every time). */
export function fetchQuotePay(locale: string, code: string) {
  return authed(locale, `${path(code)}/pay`, QuotePayDto, { method: 'POST' });
}

/** After Razorpay Checkout: the API checks the signature and fetches the payment before the order counts as paid. */
export function verifyQuotePayment(
  locale: string,
  input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
) {
  return authed(locale, '/payments/razorpay/verify', QuotePaymentVerifiedDto, {
    method: 'POST',
    body: input,
  });
}

export function declineQuote(locale: string, code: string, reasonCode: QuoteDeclineReason) {
  return authed(locale, `${path(code)}/decline`, QuoteChangedDto, { method: 'POST', body: { reasonCode } });
}

// ── quote desk (staff) ────────────────────────────────────────────────────────────────────────────────────────

export function fetchAdminQuotes(locale: string, view: AdminQuoteView, cursor?: string) {
  const q = new URLSearchParams({ view, limit: '30', locale: loc(locale) });
  if (cursor) q.set('cursor', cursor);
  return adminApi(locale, `/admin/quotes?${q.toString()}`, QuotePageDto);
}

export function fetchAdminQuote(locale: string, code: string) {
  return adminApi(locale, `${adminPath(code)}?locale=${loc(locale)}`, QuoteDetailDto);
}

export function postAdminQuoteMessage(locale: string, code: string, body: string) {
  return adminApi(locale, `${adminPath(code)}/messages`, QuoteChangedDto, { method: 'POST', body: { body } });
}

export interface OfferInput {
  version: number;
  lines: { lineNo: number; unitPaise: number }[];
  deliveryPaise: number;
  validDays: number;
  terms: string | null;
  /** Staff ticked the confirmation for prices below the shop price or under a tenth of list (review I2). */
  confirmLowPrices: boolean;
}

export function sendAdminOffer(locale: string, code: string, offer: OfferInput) {
  return adminApi(locale, `${adminPath(code)}/offer`, QuoteOfferSentDto, {
    method: 'POST',
    body: offer,
  });
}

export function withdrawAdminQuote(
  locale: string,
  code: string,
  input: { version: number; reasonCode: string; message: string },
) {
  return adminApi(locale, `${adminPath(code)}/withdraw`, QuoteChangedDto, { method: 'POST', body: input });
}
