import {
  CancelledDto,
  CheckoutQuoteDto,
  MyOrderDto,
  MyOrdersDto,
  PlacedOrderDto,
  type CheckoutQuote,
  type MyOrder,
  type MyOrders,
} from '@mechdost/shared/checkout-api';

/**
 * The customer's cart, checkout and orders on the MechDost API (real data mode; spec 03/04). Every answer is
 * validated with the shared schemas (hard rule 4); errors come back as the API's code for the screen to translate.
 * Loaded only by the real-mode screens (dynamic imports).
 */
const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function errorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const { error } = body;
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

async function token(locale: string, refresh = false): Promise<string | null> {
  const { currentIdToken } = await import('./auth/firebase-client');
  return currentIdToken(locale, refresh).catch(() => null);
}

export async function call<T>(
  path: string,
  schema: Schema<T>,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    bearer?: string | null;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  if (!API) return { ok: false, status: 0, code: 'UNAVAILABLE' };
  let res: Response;
  try {
    res = await fetch(`${API}/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok)
    return { ok: false, status: res.status, code: errorCode(body) ?? `HTTP_${String(res.status)}` };
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: res.status, code: 'BAD_RESPONSE' };
}

/** Signed-in call; refreshes the token once when the API says the verification facts changed. */
export async function authed<T>(
  locale: string,
  path: string,
  schema: Schema<T>,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  const first = await token(locale);
  if (!first) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  const res = await call(path, schema, { ...init, bearer: first });
  if (res.ok || res.code !== 'VERIFICATION_REQUIRED') return res;
  const fresh = await token(locale, true);
  return fresh ? call(path, schema, { ...init, bearer: fresh }) : res;
}

export interface QuoteLine {
  sku: string;
  qty: number;
}

/** Server prices for the cart at a PIN: per-shop groups, delivery, GST, COD eligibility, line issues. */
export function quoteCart(locale: string, pincode: string, lines: readonly QuoteLine[]) {
  return call<CheckoutQuote>('/checkout/quote', CheckoutQuoteDto, {
    method: 'POST',
    body: { pincode, lines, locale: locale === 'hi' ? 'hi' : 'en' },
  });
}

export interface PlaceInput {
  address: { contactName: string; contactPhone: string; line1: string; pincode: string };
  lines: readonly QuoteLine[];
  expectedTotalPaise: number;
  business: { gstin: string; businessName: string } | null;
  /** MechDost Coins to use (spec 20); `expectedTotalPaise` already has their discount taken off. */
  coins?: number;
}

/** Cash on delivery. The same idempotency key for a retry of the same attempt never makes a second order. */
export function placeCodOrder(locale: string, input: PlaceInput, idempotencyKey: string) {
  return authed(locale, '/orders', PlacedOrderDto, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: {
      address: input.address,
      lines: input.lines,
      expectedTotalPaise: input.expectedTotalPaise,
      paymentMethod: 'cod',
      ...(input.business ? { business: input.business } : {}),
      ...(input.coins ? { coins: input.coins } : {}),
      locale: locale === 'hi' ? 'hi' : 'en',
    },
  });
}

export function fetchMyOrder(locale: string, code: string): Promise<ApiResult<MyOrder>> {
  return authed(
    locale,
    `/orders/${encodeURIComponent(code)}?locale=${locale === 'hi' ? 'hi' : 'en'}`,
    MyOrderDto,
  );
}

export function fetchMyOrders(locale: string, cursor?: string): Promise<ApiResult<MyOrders>> {
  const q = new URLSearchParams({ limit: '20' });
  if (cursor) q.set('cursor', cursor);
  return authed(locale, `/orders?${q.toString()}`, MyOrdersDto);
}

export function cancelMyOrder(locale: string, subCode: string, reasonCode: string, version: number) {
  return authed(locale, `/orders/${encodeURIComponent(subCode)}/cancel`, CancelledDto, {
    method: 'POST',
    body: { reasonCode, version },
  });
}
