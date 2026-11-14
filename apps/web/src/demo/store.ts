/**
 * DEMO STORE — browser-only cart, orders and service requests for the partner demo (decision 2026-11-01).
 * Real flows go through the API with server-side pricing, idempotency keys and state machines (specs 03/04/06/14);
 * nothing here is trusted or persisted on a server. One localStorage key per collection, validated on read.
 */
import { orderRules } from './order-rules';
import { publicCode } from '@mechdost/shared/ids';
import type { VehicleType } from '@mechdost/shared/vehicles';
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
import type { PricedCart } from './cart-pricing';
import type { CategoryKey } from './categories';
import { takesNewWork } from './partner-status';
import type { ApplicationRejectReason } from '@mechdost/shared/partner-codes';
import { siteSettings } from './site-config';
import type { EstimateLine, ServiceBill } from '@mechdost/shared/service-bill';

export const MAX_LINES = 20;
export const MAX_QTY = 99;

export interface CartLine {
  slug: string;
  qty: number;
  /** The pack's SKU when the product came from the API (real data mode): the checkout quote prices by SKU. */
  sku?: string;
}

export const ORDER_STAGES = ['placed', 'routing', 'confirmed', 'packed', 'shipped', 'delivered'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export interface DemoOrder {
  code: string;
  /** Copy of the admin rule at placement (Q25): may the customer cancel it themselves? Missing = no. */
  selfCancel?: boolean;
  createdAt: string;
  lines: { slug: string; name: string; brand: string; qty: number; unitPaise: number }[];
  subtotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  customer: { name: string; phone: string; address: string; pincode: string };
  /** Business purchase (GST invoice), from checkout; snapshot like `order_groups.gstin` / `business_name`. */
  business?: { gstin: string; businessName: string } | null;
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

/**
 * The demo's service request states, a subset of the canonical machine (`serviceRequestMachine`, spec 06):
 * `received` is `vehicle_received`; `billed -> paid -> completed` is one step here (the workshop marks the bill
 * paid and the request completes). Stored as an index, so a stage inserted later needs the read-time remap below.
 */
export const REQUEST_STAGES = [
  'requested',
  'proposed',
  'confirmed',
  'received',
  'estimate_sent',
  'approved',
  'in_progress',
  'ready',
  'billed',
  'completed',
  'no_work_approved',
] as const;
export type RequestStage = (typeof REQUEST_STAGES)[number];
/** 2 = estimates and bills added (2026-11-14). Records without it used the 6-stage list below. */
const REQUEST_FLOW = 2;
const LEGACY_REQUEST_STAGES = [
  'requested',
  'proposed',
  'confirmed',
  'received',
  'in_progress',
  'ready',
] as const;
/** For `service-jobs.ts` (estimates and bills live there so shop pages do not load them; JS budget). */
export const stageAt = (s: RequestStage) => REQUEST_STAGES.indexOf(s);
export const requestStage = (r: DemoServiceRequest): RequestStage => REQUEST_STAGES[r.stage] ?? 'requested';

/** A line on a workshop estimate; `serviceKey` when it came from the requested service (shown localised). */
export type DemoEstimateLine = EstimateLine & { serviceKey?: string };
export interface DemoEstimate {
  version: number;
  sentAt: string;
  lines: DemoEstimateLine[];
  /** When the customer decided (with consent); null while waiting. */
  decidedAt: string | null;
}
/** A snapshot taken when the workshop bills: later edits never change it (spec 06). */
export type DemoServiceBill = Omit<ServiceBill, 'lines'> & {
  lines: (ServiceBill['lines'][number] & { serviceKey?: string })[];
  billedAt: string;
  /** Days of labour promise frozen on the bill (2026-11-15); null/absent = none. */
  labourPromiseDays?: number | null;
  paidAt: string | null;
};

export interface DemoServiceRequest {
  code: string;
  createdAt: string;
  workshopSlug: string;
  workshopName: string;
  vehicleType: VehicleType;
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
  /** Stage-list version (see REQUEST_FLOW); missing on records saved before estimates existed. */
  flow?: number;
  /** Recorded when the workshop receives the vehicle. */
  odometerKm?: number;
  estimate?: DemoEstimate;
  bill?: DemoServiceBill;
  /** The vehicle went back with no work approved (nothing charged). */
  closedAt?: string;
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
  /** Seller applications (design 2026-11-13); older saved rows lack them. */
  email?: string;
  shopName?: string;
  gstStatus?: 'registered' | 'enrolled';
  gstNumber?: string;
  addressLine?: string;
  landmark?: string;
  location?: { lat: number; lng: number; accuracyM: number; source: 'gps' | 'search' | 'pin' };
  productSlugs?: string[];
  /** Categories of the chosen products (set by the seller form); a new shop is routed by them (Q89). */
  categories?: CategoryKey[];
  source?: 'public' | 'invite';
  /** Set by the admin at approval (user 2026-11-13: "admin, at approval"); becomes `shop_pincodes`. */
  coverage?: Coverage;
  rejectReason?: ApplicationRejectReason;
}

/** A new shop's delivery area: PIN codes with one delivery charge and delivery days. */
export interface Coverage {
  pincodes: string[];
  shippingPaise: number;
  leadDays: number;
}

/** An admin's invite to a seller (demo of `partner_invites`): one-time link, 7 days. */
export interface DemoInvite {
  token: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  expiresAt: string;
  status: 'sent' | 'used' | 'revoked';
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
  /** Delivery address given with the request (older saved quotes have none). */
  address?: string;
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
  invites: 'mechdost-demo-invites',
} as const;
type Key = (typeof KEYS)[keyof typeof KEYS];

const listeners = new Set<() => void>();
const cache = new Map<Key, { raw: string | null; value: unknown }>();
const EMPTY: readonly never[] = [];

function read<T>(key: Key, isItem: (v: unknown) => v is T, upgrade?: (v: T) => T): readonly T[] {
  let raw: string | null;
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
    if (Array.isArray(parsed)) value = upgrade ? parsed.filter(isItem).map(upgrade) : parsed.filter(isItem);
  } catch {
    value = EMPTY;
  }
  cache.set(key, { raw, value });
  return value;
}

/** False when the browser refused to save (storage full or blocked): callers tell the user (review B11). */
function write(key: Key, value: readonly unknown[]): boolean {
  let saved = true;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    saved = false;
  }
  for (const l of listeners) l();
  return saved;
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
// Saved data can be old or edited by hand: anything that would mis-price or crash a page is dropped (review B11).
const isCartLine = (v: unknown): v is CartLine =>
  isRecord(v) &&
  typeof v.slug === 'string' &&
  typeof v.qty === 'number' &&
  Number.isInteger(v.qty) &&
  v.qty >= 1 &&
  v.qty <= MAX_QTY &&
  (v.sku === undefined || (typeof v.sku === 'string' && /^[A-Z0-9][A-Z0-9-]{0,63}$/.test(v.sku)));
const isOrder = (v: unknown): v is DemoOrder =>
  isRecord(v) &&
  typeof v.code === 'string' &&
  Array.isArray(v.lines) &&
  typeof v.stage === 'number' &&
  typeof v.totalPaise === 'number' &&
  isRecord(v.customer) &&
  typeof v.customer.name === 'string';
const isRequest = (v: unknown): v is DemoServiceRequest =>
  isRecord(v) && typeof v.code === 'string' && typeof v.workshopSlug === 'string';

const isApplication = (v: unknown): v is DemoApplication =>
  isRecord(v) && typeof v.code === 'string' && typeof v.kind === 'string';

const cartSnapshot = () => read(KEYS.cart, isCartLine);
const ordersSnapshot = () => read(KEYS.orders, isOrder);
/** Records saved before estimates existed keep their meaning: their old stage index is mapped by name. */
function upgradeRequest(r: DemoServiceRequest): DemoServiceRequest {
  if (r.flow === REQUEST_FLOW) return r;
  const old = LEGACY_REQUEST_STAGES[r.stage] ?? 'requested';
  // Old jobs past "received" have no estimate to work or bill from: they continue from "received".
  const stage = old === 'in_progress' || old === 'ready' ? 'received' : old;
  return { ...r, flow: REQUEST_FLOW, stage: stageAt(stage) };
}
export const requestsSnapshot = () => read(KEYS.requests, isRequest, upgradeRequest);
const applicationsSnapshot = () => read(KEYS.applications, isApplication);
/** Current applications outside React (shops derived from approvals, sign-in linking; Q89). */
export const applicationsNow = applicationsSnapshot;
const serverSnapshot = () => EMPTY;

const newId = () => globalThis.crypto.randomUUID();

export function useCart(): readonly CartLine[] {
  return useSyncExternalStore(subscribe, cartSnapshot, serverSnapshot);
}

export function useOrders(): readonly DemoOrder[] {
  return useSyncExternalStore(subscribe, ordersSnapshot, serverSnapshot);
}

export function useRequests(): readonly DemoServiceRequest[] {
  return useSyncExternalStore(subscribe, requestsSnapshot, serverSnapshot);
}

export type AddResult = 'added' | 'max_qty' | 'max_lines' | 'save_failed';

/** Concept limits: at most 20 different products and 99 units of each. */
export function addToCart(slug: string, qty = 1, sku?: string): AddResult {
  const lines = [...cartSnapshot()];
  const existing = lines.find((l) => l.slug === slug);
  if (existing) {
    if (existing.qty >= MAX_QTY) return 'max_qty';
    existing.qty = Math.min(MAX_QTY, existing.qty + qty);
    const saved = write(
      KEYS.cart,
      lines.map((l) => (l.slug === slug ? { ...existing } : l)),
    );
    return saved ? 'added' : 'save_failed';
  }
  if (lines.length >= MAX_LINES) return 'max_lines';
  return write(KEYS.cart, [
    ...lines,
    { slug, qty: Math.min(MAX_QTY, Math.max(1, qty)), ...(sku ? { sku } : {}) },
  ])
    ? 'added'
    : 'save_failed';
}

export function setQuantity(slug: string, qty: number) {
  const clamped = Math.min(MAX_QTY, Math.max(1, Math.trunc(qty)));
  write(
    KEYS.cart,
    cartSnapshot().map((l) => (l.slug === slug ? { ...l, qty: clamped } : l)),
  );
}

/** Empty the cart (after an order paid online on the API). */
export function clearCart(): boolean {
  return write(KEYS.cart, []);
}

export function removeFromCart(slug: string) {
  write(
    KEYS.cart,
    cartSnapshot().filter((l) => l.slug !== slug),
  );
}

/**
 * Place the cart as an order. The caller prices it with `priceCart` (`demo/cart-pricing.ts`): the store stays free
 * of the product catalogue, so the cart pill on every page does not ship it (JS budget, spec 16).
 */
export function placeDemoOrder(
  customer: DemoOrder['customer'],
  cart: PricedCart,
  coins: DemoOrder['coins'] = null,
  business: DemoOrder['business'] = null,
): DemoOrder {
  const { priced, subtotalPaise, deliveryPaise } = cart;
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
    business,
    payment: 'cod',
    coins: coins && coinDiscount > 0 ? { ...coins, discountPaise: coinDiscount } : null,
    stage: 1, // placed → immediately "confirming with a shop" (admin routing queue)
    selfCancel: orderRules().customerSelfCancel,
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
    flow: REQUEST_FLOW,
  };
  write(KEYS.requests, [request, ...requestsSnapshot()].slice(0, 50));
  return request;
}

const STAGE_CONFIRMED_AT = ORDER_STAGES.indexOf('confirmed');

/** Demo control: move to the next stage (in production these are shop/workshop/admin actions). */
/** `fallbackShopSlug`: the shop the simulation "routes" to when none was offered yet (the caller ranks shops). */
export function advanceOrder(code: string, fallbackShopSlug?: string) {
  write(
    KEYS.orders,
    ordersSnapshot().map((o) => {
      if (o.code !== code || isClosed(o)) return o;
      const stage = Math.min(o.stage + 1, ORDER_STAGES.length - 1);
      // Simulates admin routing + the shop's acceptance, so the shop portal and admin agree (review B12).
      if (stage === STAGE_CONFIRMED_AT) {
        const now = new Date().toISOString();
        const shop =
          o.shop ??
          (fallbackShopSlug
            ? { slug: fallbackShopSlug, status: 'accepted' as const, offeredAt: now, expiresAt: now }
            : null);
        return shop ? { ...o, stage, shop: { ...shop, status: 'accepted' as const } } : o;
      }
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

/** The customer's own next step is never simulated by the demo control (see advanceRequest). */
export const requestAdvanceable = (r: DemoServiceRequest) =>
  !r.cancellation &&
  !(['proposed', 'estimate_sent', 'completed'] as RequestStage[]).includes(requestStage(r));

/** The customer accepts the workshop's slot and expected cost (spec 06: proposed -> confirmed). */
export function acceptProposal(code: string): boolean {
  return updateRequest(code, (r) =>
    requestStage(r) === 'proposed' ? { ...r, stage: stageAt('confirmed') } : null,
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

/**
 * The store's own storage for the split-out demo modules (`quote-store.ts`, `partner-store.ts`): same keys, cache and listeners, so
 * every hook sees every write. Split so pages that never touch quotes do not carry that code (JS budget, spec 16).
 */
export const storeCore = {
  keys: KEYS,
  read,
  write,
  subscribe,
  serverSnapshot,
  isRecord,
  ordersSnapshot,
  applicationsSnapshot,
  newId,
};

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
  // An open offer lapses when its time runs out, or at once when the shop is paused or suspended meanwhile (it
  // stayed stuck until the timer ended: lifecycle QA 2026-11-14, finding 3).
  if (
    order.shop.status === 'offered' &&
    (new Date(order.shop.expiresAt).getTime() < now || !takesNewWork('shop', order.shop.slug))
  )
    return 'expired';
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
        ? [
            ...(o.declined ?? []),
            {
              slug: o.shop.slug,
              // A lapse because the shop was paused or suspended is not a missed timer (review 2026-11-14).
              reason: takesNewWork('shop', o.shop.slug) ? 'timeout' : 'shop_closed',
              at: new Date().toISOString(),
            },
          ]
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
  // Same rule as the API (`repo/routing.ts`, CHECK 10–500): a message the admin writes, with no English default
  // text (QA 2026-11-14, B1); the reason code's sentence is shown in the customer's language as well.
  const clean = message.trim();
  if (clean.length < 10 || clean.length > 500 || !ORDER_REJECT_REASONS.includes(reasonCode)) return false;
  return updateOrder(code, (o) => {
    const state = routingState(o);
    if (state === 'confirmed' || state === 'rejected' || state === 'cancelled') return null;
    return { ...o, shop: null, rejection: { message: clean, reasonCode, at: new Date().toISOString() } };
  });
}

const STAGE_CONFIRMED = ORDER_STAGES.indexOf('confirmed');
const STAGE_PACKED = ORDER_STAGES.indexOf('packed');

/** The customer may cancel until the shop has packed the order (spec 05, same as the API). */
/** Customers cancel themselves only when the order carries the admin's "self-cancel" rule (Q25); else via support. */
export const customerMayCancel = (o: DemoOrder) =>
  o.selfCancel === true && !isClosed(o) && o.stage <= STAGE_CONFIRMED;
/** Still early enough that support can cancel without the shop: shown as "contact support to cancel". */
export const cancelViaSupport = (o: DemoOrder) =>
  !customerMayCancel(o) && !isClosed(o) && o.stage <= STAGE_CONFIRMED;
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

export function updateRequest(
  code: string,
  change: (r: DemoServiceRequest) => DemoServiceRequest | null,
): boolean {
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

/** Admin assigns a declined request to another workshop. */
export function reassignRequest(code: string, workshop: { slug: string; name: string }): boolean {
  if (!takesNewWork('workshop', workshop.slug)) return false;
  return updateRequest(code, (r) =>
    r.stage === 0 && (r.declinedBy ?? []).includes(r.workshopSlug)
      ? { ...r, workshopSlug: workshop.slug, workshopName: workshop.name }
      : null,
  );
}

const STAGE_VEHICLE_RECEIVED = stageAt('received');

/** The customer may cancel a booking until the workshop has received the vehicle (spec 06). */
export const requestCancellable = (r: DemoServiceRequest) =>
  !r.cancellation && r.stage < STAGE_VEHICLE_RECEIVED;

export function cancelDemoRequest(code: string, reasonCode: ServiceCancelReason): boolean {
  if (!SERVICE_CANCEL_REASONS.includes(reasonCode)) return false;
  return updateRequest(code, (r) =>
    requestCancellable(r) ? { ...r, cancellation: { reasonCode, at: new Date().toISOString() } } : null,
  );
}
