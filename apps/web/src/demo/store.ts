/**
 * DEMO STORE — browser-only cart, orders and service requests for the partner demo (decision 2026-11-01).
 * Real flows go through the API with server-side pricing, idempotency keys and state machines (specs 03/04/06/14);
 * nothing here is trusted or persisted on a server. One localStorage key per collection, validated on read.
 */
import { publicCode } from '@mechdost/shared/ids';
import {
  ASSIGNMENT_DECLINE_REASONS,
  ORDER_CANCEL_REASONS,
  ORDER_REJECT_REASONS,
  SERVICE_CANCEL_REASONS,
  type AssignmentDeclineReason,
  type OrderCancelReason,
  type OrderRejectReason,
  type ServiceCancelReason,
} from '@mechdost/shared/state';
import { useSyncExternalStore } from 'react';
import { deliveryFeePaise, findProduct } from './catalogue';
import { takesNewWork } from './partner-status';
import { siteSettings } from './site-config';

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
  /** Shop the order is offered to / accepted by (spec 04 assignment). Absent = needs routing. */
  shop?: { slug: string; status: 'offered' | 'accepted'; offeredAt: string; expiresAt: string } | null;
  /** Shops that declined (or let the timer run out), newest last. */
  declined?: { slug: string; reason: string; at: string }[];
  /** Admin rejected the order with a reason code and a message to the customer (refund for prepaid orders). */
  rejection?: { message: string; at: string; reasonCode?: OrderRejectReason } | null;
  /** Cancelled before delivery, by the customer (until confirmed) or staff (until packed), with a reason code. */
  cancellation?: {
    by: 'customer' | 'staff';
    reasonCode: OrderCancelReason;
    actor: string;
    at: string;
  } | null;
  /** MechDost Coins used on this order (spec 20): part of the discount, restored if the order is rejected. */
  coins?: { accountId: string; coins: number; discountPaise: number } | null;
  /** Proof of delivery (spec 04): code issued when the order goes out for delivery. */
  delivery?: DeliveryProof | null;
}

/**
 * Delivery code (decision 2026-11-01, "like any e-commerce site"): 4 digits shown to the customer when the order
 * is out for delivery; the shop enters it to mark the order delivered. 5 wrong codes lock it (support takes
 * over); an admin may confirm without the code only with a reason. Production stores the code encrypted.
 */
export interface DeliveryProof {
  code: string;
  attempts: number;
  confirmedAt: string | null;
  method: 'code' | 'override' | null;
  overrideReason?: string;
  overrideBy?: string;
}

export const DELIVERY_CODE_MAX_ATTEMPTS = 5;
const STAGE_OUT_FOR_DELIVERY = ORDER_STAGES.indexOf('shipped');
const STAGE_DELIVERED = ORDER_STAGES.indexOf('delivered');

/** Uniform random 4-digit code (rejection sampling, no modulo bias). */
function newDeliveryCode(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0] ?? 0;
  } while (n >= 4_294_960_000); // largest multiple of 10,000 below 2^32
  return String(n % 10_000).padStart(4, '0');
}

const issueDelivery = (): DeliveryProof => ({
  code: newDeliveryCode(),
  attempts: 0,
  confirmedAt: null,
  method: null,
});

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
  /** The workshop's proposal (slot + expected cost), set when it proposes (stage 1). */
  proposal?: {
    date: string;
    slot: 'morning' | 'afternoon' | 'evening';
    minPaise: number;
    maxPaise: number;
    note: string;
  };
  /** The workshop declined: the request goes back to MechDost to find another workshop. */
  declinedBy?: string[];
  /** The customer cancelled before the vehicle reached the workshop (spec 06), with a reason code. */
  cancellation?: { reasonCode: ServiceCancelReason; at: string } | null;
}

export type PartnerKind = 'seller' | 'garage' | 'mechanic';
export const APPLICATION_STAGES = ['received', 'review', 'verification', 'onboarded'] as const;

export interface DemoApplication {
  code: string;
  createdAt: string;
  kind: PartnerKind;
  name: string;
  phone: string;
  business: string;
  pincode: string;
  vehicles: string[];
  details: string;
  stage: number;
  rejected: boolean;
}

export type ReviewTarget = 'product' | 'workshop';
export type ReviewStatus = 'pending' | 'approved' | 'hidden';

export interface DemoReview {
  id: string;
  createdAt: string;
  target: ReviewTarget;
  slug: string;
  name: string;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
}

export type QuoteStatus = 'open' | 'offered' | 'accepted' | 'declined';

export interface QuoteMessage {
  id: string;
  from: 'customer' | 'admin';
  text: string;
  at: string;
}

export interface QuoteOffer {
  version: number;
  lines: { slug: string; unitPaise: number }[];
  deliveryPaise: number;
  totalPaise: number;
  validUntil: string;
  note: string;
  at: string;
}

export interface DemoQuote {
  code: string;
  createdAt: string;
  customer: { name: string; phone: string };
  pincode: string;
  lines: { slug: string; name: string; brand: string; qty: number; listPaise: number }[];
  status: QuoteStatus;
  messages: QuoteMessage[];
  offers: QuoteOffer[];
  orderCode: string | null;
}

const KEYS = {
  cart: 'mechdost-cart',
  orders: 'mechdost-demo-orders',
  requests: 'mechdost-demo-requests',
  applications: 'mechdost-demo-applications',
  reviews: 'mechdost-demo-reviews',
  quotes: 'mechdost-demo-quotes',
  accounts: 'mechdost-demo-accounts',
  session: 'mechdost-demo-session',
  loginFailures: 'mechdost-demo-login-failures',
  resetLinks: 'mechdost-demo-reset-links',
  coins: 'mechdost-demo-coins',
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

const isApplication = (v: unknown): v is DemoApplication =>
  isRecord(v) && typeof v.code === 'string' && typeof v.kind === 'string';
const isReview = (v: unknown): v is DemoReview =>
  isRecord(v) && typeof v.id === 'string' && typeof v.rating === 'number';
const isQuote = (v: unknown): v is DemoQuote =>
  isRecord(v) && typeof v.code === 'string' && Array.isArray(v.messages) && Array.isArray(v.offers);

const cartSnapshot = () => read(KEYS.cart, isCartLine);
const ordersSnapshot = () => read(KEYS.orders, isOrder);
const requestsSnapshot = () => read(KEYS.requests, isRequest);
const applicationsSnapshot = () => read(KEYS.applications, isApplication);
const reviewsSnapshot = () => read(KEYS.reviews, isReview);
const quotesSnapshot = () => read(KEYS.quotes, isQuote);
const serverSnapshot = () => EMPTY;

export function useApplications(): readonly DemoApplication[] {
  return useSyncExternalStore(subscribe, applicationsSnapshot, serverSnapshot);
}

export function useReviews(): readonly DemoReview[] {
  return useSyncExternalStore(subscribe, reviewsSnapshot, serverSnapshot);
}

export function useQuotes(): readonly DemoQuote[] {
  return useSyncExternalStore(subscribe, quotesSnapshot, serverSnapshot);
}

const newId = () => globalThis.crypto.randomUUID();

export function createApplication(
  input: Omit<DemoApplication, 'code' | 'createdAt' | 'stage' | 'rejected'>,
): DemoApplication {
  const app: DemoApplication = {
    ...input,
    code: publicCode('PA', 'RPR'),
    createdAt: new Date().toISOString(),
    stage: 0,
    rejected: false,
  };
  write(KEYS.applications, [app, ...applicationsSnapshot()].slice(0, 100));
  return app;
}

/** Admin action (demo): move an application forward, or reject it. */
export function updateApplication(code: string, change: { stage?: number; rejected?: boolean }) {
  write(
    KEYS.applications,
    applicationsSnapshot().map((a) =>
      a.code === code
        ? {
            ...a,
            stage: Math.min(change.stage ?? a.stage, APPLICATION_STAGES.length - 1),
            rejected: change.rejected ?? a.rejected,
          }
        : a,
    ),
  );
}

/** Customer review: starts `pending`; only admin-approved reviews are published (decision 2026-10-31). */
export function submitReview(input: Omit<DemoReview, 'id' | 'createdAt' | 'status'>): DemoReview {
  const review: DemoReview = {
    ...input,
    rating: Math.min(5, Math.max(1, Math.round(input.rating))),
    id: newId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  write(KEYS.reviews, [review, ...reviewsSnapshot()].slice(0, 200));
  return review;
}

export function moderateReview(id: string, status: ReviewStatus) {
  write(
    KEYS.reviews,
    reviewsSnapshot().map((r) => (r.id === id ? { ...r, status } : r)),
  );
}

/** Bulk quote request (spec 19): customer + lines; negotiation happens in the message thread. */
export function createQuote(input: {
  customer: DemoQuote['customer'];
  pincode: string;
  lines: DemoQuote['lines'];
  note: string;
}): DemoQuote {
  const now = new Date().toISOString();
  const quote: DemoQuote = {
    code: publicCode('QT', 'RPR'),
    createdAt: now,
    customer: input.customer,
    pincode: input.pincode,
    lines: input.lines,
    status: 'open',
    messages: input.note ? [{ id: newId(), from: 'customer', text: input.note, at: now }] : [],
    offers: [],
    orderCode: null,
  };
  write(KEYS.quotes, [quote, ...quotesSnapshot()].slice(0, 50));
  return quote;
}

function updateQuote(code: string, change: (q: DemoQuote) => DemoQuote) {
  write(
    KEYS.quotes,
    quotesSnapshot().map((q) => (q.code === code ? change(q) : q)),
  );
}

export function postQuoteMessage(code: string, from: QuoteMessage['from'], text: string) {
  const clean = text.trim().slice(0, 1000);
  if (!clean) return;
  updateQuote(code, (q) =>
    q.status === 'accepted' || q.status === 'declined'
      ? q
      : { ...q, messages: [...q.messages, { id: newId(), from, text: clean, at: new Date().toISOString() }] },
  );
}

/** Admin sets the final price. A new offer supersedes the previous one (only the latest can be accepted). */
export function sendOffer(
  code: string,
  offer: { lines: QuoteOffer['lines']; deliveryPaise: number; validDays: number; note: string },
) {
  updateQuote(code, (q) => {
    if (q.status === 'accepted' || q.status === 'declined') return q;
    const subtotal = offer.lines.reduce((sum, l) => {
      const qty = q.lines.find((x) => x.slug === l.slug)?.qty ?? 0;
      return sum + l.unitPaise * qty;
    }, 0);
    const now = new Date();
    const next: QuoteOffer = {
      version: (q.offers.at(-1)?.version ?? 0) + 1,
      lines: offer.lines,
      deliveryPaise: offer.deliveryPaise,
      totalPaise: subtotal + offer.deliveryPaise,
      validUntil: new Date(now.getTime() + offer.validDays * 86_400_000).toISOString(),
      note: offer.note.trim().slice(0, 500),
      at: now.toISOString(),
    };
    return { ...q, status: 'offered', offers: [...q.offers, next] };
  });
}

export type AcceptResult =
  { ok: true; orderCode: string } | { ok: false; reason: 'stale' | 'expired' | 'closed' };

/**
 * Accept exactly the offer version the customer saw. A superseded or expired offer is refused, and a quote can
 * create only one order (mirrors spec 19's conditional UPDATE + UNIQUE orders.quote_offer_id).
 */
export function acceptOffer(code: string, version: number): AcceptResult {
  const quote = quotesSnapshot().find((q) => q.code === code);
  if (quote?.status !== 'offered') return { ok: false, reason: 'closed' };
  const latest = quote.offers.at(-1);
  if (latest?.version !== version) return { ok: false, reason: 'stale' };
  if (new Date(latest.validUntil).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const lines = quote.lines.map((l) => ({
    slug: l.slug,
    name: l.name,
    brand: l.brand,
    qty: l.qty,
    unitPaise: latest.lines.find((x) => x.slug === l.slug)?.unitPaise ?? l.listPaise,
  }));
  const subtotalPaise = lines.reduce((s, l) => s + l.unitPaise * l.qty, 0);
  const order: DemoOrder = {
    code: publicCode('MD', 'RPR'),
    createdAt: new Date().toISOString(),
    lines,
    subtotalPaise,
    deliveryPaise: latest.deliveryPaise,
    totalPaise: subtotalPaise + latest.deliveryPaise,
    customer: {
      name: quote.customer.name,
      phone: quote.customer.phone,
      address: '—',
      pincode: quote.pincode,
    },
    payment: 'cod',
    stage: 1, // the normal order workflow continues: admin routes it to a shop
  };
  write(KEYS.orders, [order, ...ordersSnapshot()].slice(0, 50));
  updateQuote(code, (q) => ({ ...q, status: 'accepted', orderCode: order.code }));
  return { ok: true, orderCode: order.code };
}

export function declineQuote(code: string) {
  updateQuote(code, (q) => (q.status === 'accepted' ? q : { ...q, status: 'declined' }));
}

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
  // Admin-set fee and threshold; placed orders keep the values snapshotted at placement.
  const deliveryPaise = deliveryFeePaise(subtotalPaise, siteSettings());
  return { priced, subtotalPaise, deliveryPaise, totalPaise: subtotalPaise + deliveryPaise };
}

export function placeDemoOrder(customer: DemoOrder['customer'], coins: DemoOrder['coins'] = null): DemoOrder {
  const { priced, subtotalPaise, deliveryPaise } = priceCart(cartSnapshot());
  // Coins pay part of the products only, never delivery; the caller checked the balance and the cap.
  const coinDiscount = coins ? Math.min(coins.discountPaise, subtotalPaise) : 0;
  const totalPaise = subtotalPaise - coinDiscount + deliveryPaise;
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
    coins: coins && coinDiscount > 0 ? { ...coins, discountPaise: coinDiscount } : null,
    stage: 1, // placed → immediately "confirming with a shop" (admin routing queue)
  };
  write(KEYS.orders, [order, ...ordersSnapshot()].slice(0, 50));
  write(KEYS.cart, []);
  return order;
}

export function createDemoRequest(
  input: Omit<DemoServiceRequest, 'code' | 'createdAt' | 'stage'>,
): DemoServiceRequest | null {
  // A paused or suspended workshop takes no new bookings (admin control, decision 2026-11-01).
  if (!takesNewWork('workshop', input.workshopSlug)) return null;
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
    ordersSnapshot().map((o) => {
      if (o.code !== code || isClosed(o)) return o;
      const stage = Math.min(o.stage + 1, ORDER_STAGES.length - 1);
      // Simulates the real steps: a code is issued when it goes out; "delivered" means the code was given.
      if (stage === STAGE_OUT_FOR_DELIVERY && !o.delivery) return { ...o, stage, delivery: issueDelivery() };
      if (stage === STAGE_DELIVERED && o.delivery && !o.delivery.confirmedAt) {
        return {
          ...o,
          stage,
          delivery: { ...o.delivery, confirmedAt: new Date().toISOString(), method: 'code' },
        };
      }
      return { ...o, stage };
    }),
  );
}

export function advanceRequest(code: string) {
  write(
    KEYS.requests,
    requestsSnapshot().map((r) =>
      r.code === code && !r.cancellation
        ? { ...r, stage: Math.min(r.stage + 1, REQUEST_STAGES.length - 1) }
        : r,
    ),
  );
}

const noopSubscribe = () => () => undefined;
/** False during server render and hydration, true after: lets pages show a skeleton instead of "not found". */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Storage primitives for sibling demo modules (session.ts). Same cache, listeners and cross-tab sync. */
type SharedKey = (typeof KEYS)['accounts' | 'session' | 'loginFailures' | 'resetLinks' | 'coins'];

export const demoStorage = {
  read: read as <T>(key: SharedKey, isItem: (v: unknown) => v is T) => readonly T[],
  write: write as (key: SharedKey, value: readonly unknown[]) => void,
  subscribe,
  empty: EMPTY,
};

// ── Routing & partner actions (spec 04 / 06). Each transition checks the current state first, like the
// conditional UPDATEs in packages/db (a stale or repeated action is a no-op that returns false).

export type RoutingState =
  'needs_routing' | 'awaiting_shop' | 'expired' | 'rejected' | 'cancelled' | 'confirmed';

export function routingState(order: DemoOrder, now = Date.now()): RoutingState {
  if (order.cancellation) return 'cancelled';
  if (order.rejection) return 'rejected';
  if (order.stage >= 2) return 'confirmed';
  if (!order.shop) return 'needs_routing';
  if (order.shop.status === 'offered' && new Date(order.shop.expiresAt).getTime() < now) return 'expired';
  return 'awaiting_shop';
}

function updateOrder(code: string, change: (o: DemoOrder) => DemoOrder | null): boolean {
  let changed = false;
  write(
    KEYS.orders,
    ordersSnapshot().map((o) => {
      if (o.code !== code) return o;
      const next = change(o);
      if (!next) return o;
      changed = true;
      return next;
    }),
  );
  return changed;
}

/** Admin routes (or reroutes) an order to one shop. Only one active assignment per order. */
export function routeOrder(code: string, shopSlug: string): boolean {
  if (!takesNewWork('shop', shopSlug)) return false; // paused/suspended shops get no new orders
  return updateOrder(code, (o) => {
    const state = routingState(o);
    if (state !== 'needs_routing' && state !== 'expired') return null;
    const declined =
      state === 'expired' && o.shop
        ? [...(o.declined ?? []), { slug: o.shop.slug, reason: 'timeout', at: new Date().toISOString() }]
        : o.declined;
    const now = new Date();
    return {
      ...o,
      stage: 1,
      declined,
      shop: {
        slug: shopSlug,
        status: 'offered',
        offeredAt: now.toISOString(),
        // Admin-set acceptance timer (/admin/settings); fixed at offer time, so a later change never moves
        // the deadline of an order already offered.
        expiresAt: new Date(now.getTime() + siteSettings().acceptMinutes * 60_000).toISOString(),
      },
    };
  });
}

/** The offered shop accepts (customer + admin see "Confirmed — will be shipped") or declines (back to admin). */
export function respondToOrder(
  code: string,
  shopSlug: string,
  accept: boolean,
  reason?: AssignmentDeclineReason,
): boolean {
  if (!accept && !(reason && ASSIGNMENT_DECLINE_REASONS.includes(reason))) return false;
  return updateOrder(code, (o) => {
    if (routingState(o) !== 'awaiting_shop' || o.shop?.slug !== shopSlug) return null;
    if (accept && !takesNewWork('shop', shopSlug)) return null;
    if (accept) return { ...o, stage: 2, shop: { ...o.shop, status: 'accepted' } };
    return {
      ...o,
      shop: null,
      declined: [
        ...(o.declined ?? []),
        { slug: shopSlug, reason: reason ?? 'other', at: new Date().toISOString() },
      ],
    };
  });
}

/** A rejected or cancelled order is closed: nothing moves it forward again. */
export const isClosed = (o: DemoOrder) => Boolean(o.rejection ?? o.cancellation);

/** Admin rejects an unfulfillable order with a reason code and a message to the customer (same rules as the API). */
export function rejectOrder(code: string, message: string, reasonCode: OrderRejectReason): boolean {
  const clean = message.trim().slice(0, 500);
  if (clean.length < 10 || !ORDER_REJECT_REASONS.includes(reasonCode)) return false;
  return updateOrder(code, (o) => {
    const state = routingState(o);
    if (state === 'confirmed' || state === 'rejected' || state === 'cancelled') return null;
    return { ...o, shop: null, rejection: { message: clean, reasonCode, at: new Date().toISOString() } };
  });
}

const STAGE_CONFIRMED = ORDER_STAGES.indexOf('confirmed');
const STAGE_PACKED = ORDER_STAGES.indexOf('packed');

/** The customer may cancel until the shop has packed the order (spec 05, same as the API). */
export const customerMayCancel = (o: DemoOrder) => !isClosed(o) && o.stage <= STAGE_CONFIRMED;
/** Staff may also cancel a packed order. */
export const staffMayCancel = (o: DemoOrder) => !isClosed(o) && o.stage <= STAGE_PACKED;

/**
 * Cancel with a reason code: an open shop offer is withdrawn (the shop no longer sees it), the order closes,
 * coins used on it come back (caller restores them). Returns false when this actor may not cancel now.
 */
export function cancelDemoOrder(
  code: string,
  by: 'customer' | 'staff',
  reasonCode: OrderCancelReason,
  actor: string,
): boolean {
  if (!ORDER_CANCEL_REASONS.includes(reasonCode)) return false;
  return updateOrder(code, (o) => {
    if (!(by === 'customer' ? customerMayCancel(o) : staffMayCancel(o))) return null;
    return {
      ...o,
      shop: o.shop?.status === 'offered' ? null : o.shop,
      cancellation: { by, reasonCode, actor, at: new Date().toISOString() },
    };
  });
}

/**
 * The accepted shop moves its order forward: confirmed → packed → out for delivery (a delivery code is issued to
 * the customer). "Delivered" is never a plain step: it needs `confirmDeliveryWithCode` or an admin override.
 */
export function shopAdvanceOrder(code: string, shopSlug: string): boolean {
  return updateOrder(code, (o) => {
    if (o.shop?.slug !== shopSlug || o.shop.status !== 'accepted' || isClosed(o)) return null;
    if (o.stage >= STAGE_OUT_FOR_DELIVERY) return null;
    const stage = o.stage + 1;
    return stage === STAGE_OUT_FOR_DELIVERY ? { ...o, stage, delivery: issueDelivery() } : { ...o, stage };
  });
}

export type DeliveryCheck =
  | { ok: true }
  | { ok: false; reason: 'wrong'; attemptsLeft: number }
  | { ok: false; reason: 'locked' | 'not_out' };

/** The delivery person enters the customer's code; right code → delivered. */
export function confirmDeliveryWithCode(code: string, shopSlug: string, entered: string): DeliveryCheck {
  let result: DeliveryCheck = { ok: false, reason: 'not_out' };
  updateOrder(code, (o) => {
    const d = o.delivery;
    if (o.shop?.slug !== shopSlug || o.stage !== STAGE_OUT_FOR_DELIVERY || !d || d.confirmedAt || isClosed(o))
      return null;
    if (d.attempts >= DELIVERY_CODE_MAX_ATTEMPTS) {
      result = { ok: false, reason: 'locked' };
      return null;
    }
    if (entered.trim() === d.code) {
      result = { ok: true };
      return {
        ...o,
        stage: STAGE_DELIVERED,
        delivery: { ...d, confirmedAt: new Date().toISOString(), method: 'code' },
      };
    }
    const attempts = d.attempts + 1;
    result =
      attempts >= DELIVERY_CODE_MAX_ATTEMPTS
        ? { ok: false, reason: 'locked' }
        : { ok: false, reason: 'wrong', attemptsLeft: DELIVERY_CODE_MAX_ATTEMPTS - attempts };
    return { ...o, delivery: { ...d, attempts } };
  });
  return result;
}

/** Admin confirms delivery without the code (customer unreachable, code lost); a reason is required and kept. */
export function adminConfirmDelivery(code: string, reason: string, by: string): boolean {
  const why = reason.trim().slice(0, 300);
  if (why.length < 5) return false;
  return updateOrder(code, (o) =>
    o.stage === STAGE_OUT_FOR_DELIVERY && o.delivery && !o.delivery.confirmedAt
      ? {
          ...o,
          stage: STAGE_DELIVERED,
          delivery: {
            ...o.delivery,
            confirmedAt: new Date().toISOString(),
            method: 'override',
            overrideReason: why,
            overrideBy: by,
          },
        }
      : null,
  );
}

function updateRequest(code: string, change: (r: DemoServiceRequest) => DemoServiceRequest | null): boolean {
  let changed = false;
  write(
    KEYS.requests,
    requestsSnapshot().map((r) => {
      // A cancelled request is closed: no proposal, decline, step or reassignment changes it again.
      if (r.code !== code || r.cancellation) return r;
      const next = change(r);
      if (!next) return r;
      changed = true;
      return next;
    }),
  );
  return changed;
}

/** Workshop proposes a slot and expected cost for a new request. */
export function proposeForRequest(
  code: string,
  workshopSlug: string,
  proposal: NonNullable<DemoServiceRequest['proposal']>,
): boolean {
  return updateRequest(code, (r) =>
    r.workshopSlug === workshopSlug && r.stage === 0 && proposal.minPaise <= proposal.maxPaise
      ? { ...r, stage: 1, proposal }
      : null,
  );
}

/** Workshop declines: MechDost finds another workshop (admin routing queue, spec 06). */
export function declineRequest(code: string, workshopSlug: string): boolean {
  return updateRequest(code, (r) =>
    r.workshopSlug === workshopSlug && r.stage === 0
      ? { ...r, declinedBy: [...(r.declinedBy ?? []), workshopSlug] }
      : null,
  );
}

/** Workshop moves an accepted job forward: received → in progress → ready. */
export function workshopAdvanceRequest(code: string, workshopSlug: string): boolean {
  return updateRequest(code, (r) =>
    r.workshopSlug === workshopSlug && r.stage >= 2 && r.stage < REQUEST_STAGES.length - 1
      ? { ...r, stage: r.stage + 1 }
      : null,
  );
}

/** Admin assigns a declined request to another workshop. */
export function reassignRequest(code: string, workshop: { slug: string; name: string }): boolean {
  if (!takesNewWork('workshop', workshop.slug)) return false;
  return updateRequest(code, (r) =>
    r.stage === 0 && (r.declinedBy ?? []).includes(r.workshopSlug)
      ? { ...r, workshopSlug: workshop.slug, workshopName: workshop.name }
      : null,
  );
}

const STAGE_VEHICLE_RECEIVED = REQUEST_STAGES.indexOf('received');

/** The customer may cancel a booking until the workshop has received the vehicle (spec 06). */
export const requestCancellable = (r: DemoServiceRequest) =>
  !r.cancellation && r.stage < STAGE_VEHICLE_RECEIVED;

export function cancelDemoRequest(code: string, reasonCode: ServiceCancelReason): boolean {
  if (!SERVICE_CANCEL_REASONS.includes(reasonCode)) return false;
  return updateRequest(code, (r) =>
    requestCancellable(r) ? { ...r, cancellation: { reasonCode, at: new Date().toISOString() } } : null,
  );
}
