/**
 * DEMO STORE — browser-only cart, orders and service requests for the partner demo (decision 2026-11-01).
 * Real flows go through the API with server-side pricing, idempotency keys and state machines (specs 03/04/06/14);
 * nothing here is trusted or persisted on a server. One localStorage key per collection, validated on read.
 */
import { publicCode } from '@mechdost/shared/ids';
import { useSyncExternalStore } from 'react';
import { deliveryFeePaise, findProduct } from './catalogue';

export const MAX_LINES = 20;
export const MAX_QTY = 99;

export interface CartLine {
  slug: string;
  qty: number;
}

export const ORDER_STAGES = ['placed', 'routing', 'confirmed', 'packed', 'shipped', 'delivered'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export interface DemoOrder {
  code: string;
  createdAt: string;
  lines: { slug: string; name: string; brand: string; qty: number; unitPaise: number }[];
  subtotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  customer: { name: string; phone: string; address: string; pincode: string };
  payment: 'cod';
  stage: number;
}

export const REQUEST_STAGES = [
  'requested',
  'proposed',
  'confirmed',
  'received',
  'in_progress',
  'ready',
] as const;
export type RequestStage = (typeof REQUEST_STAGES)[number];

export interface DemoServiceRequest {
  code: string;
  createdAt: string;
  workshopSlug: string;
  workshopName: string;
  vehicleType: '2W' | '4W';
  vehicle: string;
  services: { key: string; name: string; minPaise: number; maxPaise: number }[];
  date: string;
  slot: 'morning' | 'afternoon' | 'evening';
  concern: string;
  customer: { name: string; phone: string };
  stage: number;
}

const KEYS = {
  cart: 'mechdost-cart',
  orders: 'mechdost-demo-orders',
  requests: 'mechdost-demo-requests',
} as const;
type Key = (typeof KEYS)[keyof typeof KEYS];

const listeners = new Set<() => void>();
const cache = new Map<Key, { raw: string | null; value: unknown }>();
const EMPTY: readonly never[] = [];

function read<T>(key: Key, isItem: (v: unknown) => v is T): readonly T[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const hit = cache.get(key);
  if (hit?.raw === raw) return hit.value as readonly T[];
  let value: readonly T[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = parsed.filter(isItem);
  } catch {
    value = EMPTY;
  }
  cache.set(key, { raw, value });
  return value;
}

function write(key: Key, value: readonly unknown[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the demo keeps working for this page view only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key && (Object.values(KEYS) as string[]).includes(e.key)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isCartLine = (v: unknown): v is CartLine =>
  isRecord(v) && typeof v.slug === 'string' && typeof v.qty === 'number' && Number.isInteger(v.qty);
const isOrder = (v: unknown): v is DemoOrder =>
  isRecord(v) && typeof v.code === 'string' && Array.isArray(v.lines);
const isRequest = (v: unknown): v is DemoServiceRequest =>
  isRecord(v) && typeof v.code === 'string' && typeof v.workshopSlug === 'string';

const cartSnapshot = () => read(KEYS.cart, isCartLine);
const ordersSnapshot = () => read(KEYS.orders, isOrder);
const requestsSnapshot = () => read(KEYS.requests, isRequest);
const serverSnapshot = () => EMPTY;

export function useCart(): readonly CartLine[] {
  return useSyncExternalStore(subscribe, cartSnapshot, serverSnapshot);
}

export function useOrders(): readonly DemoOrder[] {
  return useSyncExternalStore(subscribe, ordersSnapshot, serverSnapshot);
}

export function useRequests(): readonly DemoServiceRequest[] {
  return useSyncExternalStore(subscribe, requestsSnapshot, serverSnapshot);
}

export type AddResult = 'added' | 'max_qty' | 'max_lines';

/** Concept limits: at most 20 different products and 99 units of each. */
export function addToCart(slug: string, qty = 1): AddResult {
  const lines = [...cartSnapshot()];
  const existing = lines.find((l) => l.slug === slug);
  if (existing) {
    if (existing.qty >= MAX_QTY) return 'max_qty';
    existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    write(
      KEYS.cart,
      lines.map((l) => (l.slug === slug ? { ...existing } : l)),
    );
    return 'added';
  }
  if (lines.length >= MAX_LINES) return 'max_lines';
  write(KEYS.cart, [...lines, { slug, qty: Math.min(MAX_QTY, Math.max(1, qty)) }]);
  return 'added';
}

export function setQuantity(slug: string, qty: number) {
  const clamped = Math.min(MAX_QTY, Math.max(1, Math.trunc(qty)));
  write(
    KEYS.cart,
    cartSnapshot().map((l) => (l.slug === slug ? { ...l, qty: clamped } : l)),
  );
}

export function removeFromCart(slug: string) {
  write(
    KEYS.cart,
    cartSnapshot().filter((l) => l.slug !== slug),
  );
}

/** Cart lines joined with demo prices (unknown slugs from old sessions are dropped). */
export function priceCart(lines: readonly CartLine[]) {
  const priced = lines.flatMap((l) => {
    const p = findProduct(l.slug);
    return p ? [{ product: p, qty: l.qty, linePaise: p.pricePaise * l.qty }] : [];
  });
  const subtotalPaise = priced.reduce((s, l) => s + l.linePaise, 0);
  const deliveryPaise = deliveryFeePaise(subtotalPaise);
  return { priced, subtotalPaise, deliveryPaise, totalPaise: subtotalPaise + deliveryPaise };
}

export function placeDemoOrder(customer: DemoOrder['customer']): DemoOrder {
  const { priced, subtotalPaise, deliveryPaise, totalPaise } = priceCart(cartSnapshot());
  const order: DemoOrder = {
    code: publicCode('MD', 'RPR'),
    createdAt: new Date().toISOString(),
    lines: priced.map(({ product, qty }) => ({
      slug: product.slug,
      name: product.name,
      brand: product.brand,
      qty,
      unitPaise: product.pricePaise,
    })),
    subtotalPaise,
    deliveryPaise,
    totalPaise,
    customer,
    payment: 'cod',
    stage: 1, // placed → immediately "confirming with a shop" (admin routing queue)
  };
  write(KEYS.orders, [order, ...ordersSnapshot()].slice(0, 50));
  write(KEYS.cart, []);
  return order;
}

export function createDemoRequest(
  input: Omit<DemoServiceRequest, 'code' | 'createdAt' | 'stage'>,
): DemoServiceRequest {
  const request: DemoServiceRequest = {
    ...input,
    code: publicCode('SR', 'RPR'),
    createdAt: new Date().toISOString(),
    stage: 0,
  };
  write(KEYS.requests, [request, ...requestsSnapshot()].slice(0, 50));
  return request;
}

/** Demo control: move to the next stage (in production these are shop/workshop/admin actions). */
export function advanceOrder(code: string) {
  write(
    KEYS.orders,
    ordersSnapshot().map((o) =>
      o.code === code ? { ...o, stage: Math.min(o.stage + 1, ORDER_STAGES.length - 1) } : o,
    ),
  );
}

export function advanceRequest(code: string) {
  write(
    KEYS.requests,
    requestsSnapshot().map((r) =>
      r.code === code ? { ...r, stage: Math.min(r.stage + 1, REQUEST_STAGES.length - 1) } : r,
    ),
  );
}
