'use client';

import { useSyncExternalStore } from 'react';
import { PRICE_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import { PRICE_REQUEST_STATES, priceRequestMachine, type PriceRequestStatus } from '@mechdost/shared/state';

/**
 * Seller prices in the demo (design 2026-11-13 § Prices, mirrors `packages/db/src/repo/price-requests.ts`): every
 * price is a request; one pending per shop and product (a newer one supersedes it); the live price stays until a
 * change is approved; rejecting a change to a live product takes it off sale for that shop ("Take it off sale",
 * user 2026-11-13). Demo store until the portals call `/v1/shop-onboarding/…/price-requests` (data switch).
 */
export type PriceRejectReason = (typeof PRICE_REJECT_REASONS)[number];

export interface DemoPriceRequest {
  id: string;
  shopSlug: string;
  productSlug: string;
  pricePaise: number;
  mrpPaise: number;
  status: PriceRequestStatus;
  reason: PriceRejectReason | null;
  createdAt: string;
  decidedAt: string | null;
}

interface Listing {
  shopSlug: string;
  productSlug: string;
  livePaise: number | null;
  blocked: PriceRejectReason | null;
  rejected: PriceRejectReason | null;
}

export type ListingState =
  | { status: 'none' }
  | { status: 'pending'; pending: number }
  | { status: 'on_sale'; livePaise: number; pending?: number }
  | { status: 'rejected'; reason: PriceRejectReason }
  | { status: 'blocked'; reason: PriceRejectReason };

const REQUESTS_KEY = 'mechdost-demo-price-requests';
const LISTINGS_KEY = 'mechdost-demo-shop-listings';
const MAX = 1000;

const isReason = (v: unknown): v is PriceRejectReason =>
  (PRICE_REJECT_REASONS as readonly unknown[]).includes(v);
const isPaise = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isRequest(v: unknown): v is DemoPriceRequest {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.shopSlug === 'string' &&
    typeof v.productSlug === 'string' &&
    isPaise(v.pricePaise) &&
    isPaise(v.mrpPaise) &&
    (PRICE_REQUEST_STATES as readonly unknown[]).includes(v.status) &&
    (v.reason === null || isReason(v.reason))
  );
}

function isListing(v: unknown): v is Listing {
  return (
    isRecord(v) &&
    typeof v.shopSlug === 'string' &&
    typeof v.productSlug === 'string' &&
    (v.livePaise === null || isPaise(v.livePaise)) &&
    (v.blocked === null || isReason(v.blocked)) &&
    (v.rejected === null || isReason(v.rejected))
  );
}

function read<T>(key: string, guard: (v: unknown) => v is T): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let version = 0;

function write(key: string, value: readonly unknown[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value.slice(0, MAX)));
  } catch {
    // Storage full or blocked: the demo keeps working for this page view.
  }
  version += 1;
  for (const l of listeners) l();
}

const requests = () => read(REQUESTS_KEY, isRequest);
const listings = () => read(LISTINGS_KEY, isListing);
const sameLine = (a: { shopSlug: string; productSlug: string }, shopSlug: string, productSlug: string) =>
  a.shopSlug === shopSlug && a.productSlug === productSlug;

function saveListing(shopSlug: string, productSlug: string, change: Partial<Listing>) {
  const all = listings();
  const current = all.find((l) => sameLine(l, shopSlug, productSlug)) ?? {
    shopSlug,
    productSlug,
    livePaise: null,
    blocked: null,
    rejected: null,
  };
  write(LISTINGS_KEY, [{ ...current, ...change }, ...all.filter((l) => !sameLine(l, shopSlug, productSlug))]);
}

export function submitPriceRequest(input: {
  shopSlug: string;
  productSlug: string;
  pricePaise: number;
  mrpPaise: number;
  /** The price this shop already sells at (demo catalogue price) when no listing exists yet. */
  currentPaise?: number;
}): DemoPriceRequest | { error: 'PRICE_INVALID' | 'PRICE_ABOVE_MRP' } {
  if (!isPaise(input.pricePaise)) return { error: 'PRICE_INVALID' };
  if (input.pricePaise > input.mrpPaise) return { error: 'PRICE_ABOVE_MRP' };
  const { currentPaise, ...line } = input;
  if (isPaise(currentPaise) && !listings().some((l) => sameLine(l, line.shopSlug, line.productSlug))) {
    saveListing(line.shopSlug, line.productSlug, { livePaise: currentPaise });
  }
  const request: DemoPriceRequest = {
    ...line,
    id: globalThis.crypto.randomUUID(),
    status: 'pending',
    reason: null,
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  const others = requests().map((r) => {
    if (r.status !== 'pending' || !sameLine(r, input.shopSlug, input.productSlug)) return r;
    priceRequestMachine.assert('pending', 'superseded', 'system');
    return { ...r, status: 'superseded' as const };
  });
  write(REQUESTS_KEY, [request, ...others]);
  return request;
}

function settle(
  id: string,
  to: PriceRequestStatus,
  actor: 'admin' | 'shop',
  reason: PriceRejectReason | null,
) {
  const all = requests();
  const r = all.find((x) => x.id === id);
  if (!r || !priceRequestMachine.can(r.status, to)) return null;
  priceRequestMachine.assert(r.status, to, actor);
  const decided = { ...r, status: to, reason, decidedAt: new Date().toISOString() };
  write(
    REQUESTS_KEY,
    all.map((x) => (x.id === id ? decided : x)),
  );
  return decided;
}

/** Admin decision (`prices:approve`). False when the request is no longer pending. */
export function decidePriceRequest(
  id: string,
  d: { decision: 'approved' } | { decision: 'rejected'; reason: PriceRejectReason },
): boolean {
  const reason = d.decision === 'rejected' ? d.reason : null;
  const r = settle(id, d.decision, 'admin', reason);
  if (!r) return false;
  if (d.decision === 'approved') {
    saveListing(r.shopSlug, r.productSlug, { livePaise: r.pricePaise, blocked: null, rejected: null });
  } else {
    const live = listings().find((l) => sameLine(l, r.shopSlug, r.productSlug))?.livePaise ?? null;
    saveListing(
      r.shopSlug,
      r.productSlug,
      live === null ? { rejected: reason } : { livePaise: null, blocked: reason },
    );
  }
  return true;
}

export function withdrawPriceRequest(id: string): boolean {
  return settle(id, 'withdrawn', 'shop', null) !== null;
}

export function pendingPriceRequests(): DemoPriceRequest[] {
  return requests().filter((r) => r.status === 'pending');
}

/** Shops that may not get an order with these products: a change was rejected and the product taken off sale. */
export function shopsOffSale(productSlugs: readonly string[]): string[] {
  return [
    ...new Set(
      listings()
        .filter((l) => l.blocked !== null && productSlugs.includes(l.productSlug))
        .map((l) => l.shopSlug),
    ),
  ];
}

/** What the shop and checkout see for one product of one shop. */
export function listingOf(shopSlug: string, productSlug: string): ListingState {
  const l = listings().find((x) => sameLine(x, shopSlug, productSlug));
  const pending = pendingPriceRequests().find((r) => sameLine(r, shopSlug, productSlug))?.pricePaise;
  if (l?.blocked) return { status: 'blocked', reason: l.blocked };
  if (l && l.livePaise !== null) {
    return pending === undefined
      ? { status: 'on_sale', livePaise: l.livePaise }
      : { status: 'on_sale', livePaise: l.livePaise, pending };
  }
  if (pending !== undefined) return { status: 'pending', pending };
  if (l?.rejected) return { status: 'rejected', reason: l.rejected };
  return { status: 'none' };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === REQUESTS_KEY || e.key === LISTINGS_KEY) {
      version += 1;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-renders when any price request or listing changes (this tab or another). */
export function usePriceRequestsVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

const EMPTY: readonly DemoPriceRequest[] = [];
let pendingCache: { raw: string | null; list: readonly DemoPriceRequest[] } | null = null;

function pendingSnapshot(): readonly DemoPriceRequest[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(REQUESTS_KEY);
  } catch {
    return EMPTY;
  }
  if (pendingCache?.raw !== raw) pendingCache = { raw, list: pendingPriceRequests() };
  return pendingCache.list;
}

/** Pending requests for the admin queue (empty during server render; no hydration mismatch). */
export function usePendingPriceRequests(): readonly DemoPriceRequest[] {
  return useSyncExternalStore(subscribe, pendingSnapshot, () => EMPTY);
}
