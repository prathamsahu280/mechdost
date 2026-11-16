import {
  ASSIGNMENT_DECLINE_REASONS,
  orderMachine,
  ORDER_STATES,
  type OrderStatus,
} from '@mechdost/shared/state';

/**
 * View helpers for the real-API shop portal and admin routing (spec 04, 07, 08). Pure functions, so the screens
 * stay thin and the rules are unit-tested (apps/web/test/order-views.test.ts). Shapes mirror
 * `@mechdost/shared/order-views` without importing Zod into the web app.
 */

export const asOrderStatus = (s: string): OrderStatus | null => ORDER_STATES.find((x) => x === s) ?? null;

/** Whole minutes left on an offer timer, never negative. */
export function minutesLeft(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.ceil((at - now) / 60_000));
}

/** Hindi title when the order snapshot has one and the page is Hindi (brand/model names stay as written). */
export function itemTitle(item: { title: string; titleHi: string | null }, locale: string): string {
  return locale === 'hi' && item.titleHi ? item.titleHi : item.title;
}

/** Label key in the `order` namespace for a sub-order status the shop sees (the demo's `stage_*` texts). */
export function shopStageKey(
  status: string,
): 'stage_confirmed' | 'stage_packed' | 'stage_shipped' | 'stage_delivered' {
  switch (status) {
    case 'packed':
      return 'stage_packed';
    case 'shipped':
    case 'out_for_delivery':
      return 'stage_shipped';
    case 'delivered':
      return 'stage_delivered';
    default:
      return 'stage_confirmed';
  }
}

export type ShopStep = 'packed' | 'shipped' | 'out_for_delivery';

/**
 * The shop's next action: one button per stage, as in the demo. "Mark out for delivery" from `packed` is ONE API
 * call with `handOver` (the API hands over for own delivery and goes out for delivery together — the customer gets
 * the code; QA pass 4, bug 3); from `shipped` (handed over, code not sent yet) the plain second step.
 * `code` = ask for the customer's delivery code.
 */
export function nextShopAction(
  status: string,
):
  | { kind: 'advance'; label: 'markPacked' | 'markShipped'; steps: ShopStep[]; handOver?: true }
  | { kind: 'code' }
  | null {
  switch (status) {
    case 'confirmed':
      return { kind: 'advance', label: 'markPacked', steps: ['packed'] };
    case 'packed':
      return { kind: 'advance', label: 'markShipped', steps: ['out_for_delivery'], handOver: true };
    case 'shipped':
      return { kind: 'advance', label: 'markShipped', steps: ['out_for_delivery'] };
    case 'out_for_delivery':
      return { kind: 'code' };
    default:
      return null;
  }
}

/** Request body for one advance step (own delivery; courier hand-over with AWB is not offered on this screen). */
export function advanceBody(step: ShopStep, version: number, handOver = false) {
  if (step === 'shipped') return { to: step, version, mode: 'own' as const };
  return step === 'out_for_delivery' && handOver
    ? { to: step, version, handOverOwn: true as const }
    : { to: step, version };
}

export interface AddressLines {
  name: string | null;
  phone: string | null;
  lines: string[];
}

/** The delivery address snapshot (`ShippingAddress` in the checkout repo), read defensively: it is a loose record. */
export function addressLines(address: Record<string, unknown> | null): AddressLines | null {
  if (!address) return null;
  const str = (k: string) => {
    const v = address[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const lines = [str('line1'), str('line2'), str('landmark'), str('pincode')].filter(
    (l): l is string => l !== null,
  );
  const name = str('contactName');
  const phone = str('contactPhone');
  return lines.length === 0 && !name && !phone ? null : { name, phone, lines };
}

// ── Admin routing ───────────────────────────────────────────────────────────────────────────────────────────────

export type AdminGroup = 'needs' | 'awaiting' | 'done' | 'delivered' | 'rejected' | 'cancelled';

/** The API view each group is read from; the closed view is split by status like the demo's lists. */
export const GROUP_VIEW: Record<AdminGroup, 'needs_routing' | 'awaiting_shop' | 'in_progress' | 'closed'> = {
  needs: 'needs_routing',
  awaiting: 'awaiting_shop',
  done: 'in_progress',
  delivered: 'closed',
  rejected: 'closed',
  cancelled: 'closed',
};

export function closedGroup(status: string): 'delivered' | 'rejected' | 'cancelled' | null {
  return status === 'delivered' || status === 'rejected' || status === 'cancelled' ? status : null;
}

/** What staff may do to a sub-order now, from the shared state machine (the API checks the same). */
export function adminActions(status: string): {
  route: boolean;
  reject: boolean;
  cancel: boolean;
  override: boolean;
} {
  const s = asOrderStatus(status);
  if (!s) return { route: false, reject: false, cancel: false, override: false };
  return {
    route: s === 'placed' || s === 'needs_rerouting',
    reject: orderMachine.canActor(s, 'rejected', 'admin'),
    cancel: orderMachine.canActor(s, 'cancelled', 'admin'),
    override: s === 'out_for_delivery',
  };
}

interface Ranked {
  shopId: string;
  eligible: boolean;
  triedBefore: boolean;
}

/**
 * Shops to offer, in the API's ranking order: only eligible ones (the API already drops paused, suspended and
 * busy shops), never one that declined or let this order expire. Top three, the first is "Recommended".
 */
export function routeSuggestions<T extends Ranked>(shops: readonly T[], max = 3): T[] {
  return shops.filter((s) => s.eligible && !s.triedBefore).slice(0, max);
}

/**
 * Why the routing screen has nobody to offer (QA 2026-11-16, bug 8). `shops` are the approved, not-busy shops covering
 * the order's PIN: none at all means nobody serves it (paused, suspended, busy or not delivering there); all already
 * tried means every one declined or timed out; otherwise the rest do not stock every item at the customer's price.
 */
export function routeEmptyReason(
  shops: readonly { triedBefore: boolean }[],
): 'none_cover' | 'all_tried' | 'none_stock' {
  if (shops.length === 0) return 'none_cover';
  if (shops.every((s) => s.triedBefore)) return 'all_tried';
  return 'none_stock';
}

/** `reason_*` key in `portal` for a past offer: expired → timeout, a known decline code, else "declined". */
export function historyReasonKey(h: { status: string; declineReason: string | null }): string {
  if (h.status === 'expired') return 'reason_timeout';
  const code = ASSIGNMENT_DECLINE_REASONS.find((r) => r === h.declineReason);
  return code ? `reason_${code}` : 'reason_declined';
}

/** Error code from the API → `portal.api_err_*` key (unknown codes → a generic "did not work"). */
const KNOWN_ERRORS = new Set([
  'NETWORK',
  'UNAVAILABLE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'VERIFICATION_REQUIRED',
  'STAFF_2FA_REQUIRED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'STALE_ORDER',
  'ASSIGNMENT_UNAVAILABLE',
  'OUT_OF_STOCK',
  'SHOP_NOT_ELIGIBLE',
  'NOT_ROUTABLE',
  'NOT_REJECTABLE',
  'NOT_CANCELLABLE',
  'AWAITING_PAYMENT',
  'WRONG_STEP',
  'DELIVERY_CODES_UNAVAILABLE',
  'PRICE_ABOVE_MRP',
  'PRODUCT_NOT_LIVE',
]);
const ALIASES: Record<string, string> = {
  CONFLICT: 'STALE_ORDER',
  RETRY: 'STALE_ORDER',
  ILLEGAL_TRANSITION: 'STALE_ORDER',
  ACTOR_NOT_ALLOWED: 'FORBIDDEN',
  ALREADY_DELIVERED: 'WRONG_STEP',
  NO_SHIPMENT: 'WRONG_STEP',
  MRP_EXCEEDED: 'PRICE_ABOVE_MRP',
};
export function apiErrorKey(code: string): string {
  const c = ALIASES[code] ?? code;
  return KNOWN_ERRORS.has(c) ? `api_err_${c}` : 'api_err_generic';
}

/** Shop ids from `GET /v1/me` roles (seller owner/staff grants carry the shop). */
export function shopIdsOf(roles: readonly { role: string; shopId: string | null }[]): string[] {
  return [...new Set(roles.flatMap((r) => (r.shopId ? [r.shopId] : [])))];
}

// ── Shop prices ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PriceRow {
  sku: string;
  product: string;
  mrpPaise: number;
  /** The approved price the shop is paid; null when the product is not on sale from this shop yet. */
  livePaise: number | null;
  onHand: number;
  pendingPaise: number | null;
  /** Reason code of the newest request when it was not approved. */
  rejectedReason: string | null;
}

interface OfferIn {
  sku: string;
  product: string;
  mrpPaise: number;
  sellingPaise: number;
  onHand: number;
}
interface RequestIn {
  sku: string;
  product: string;
  mrpPaise: number;
  status: string;
  requestedPaise: number;
  reasonCode: string | null;
}

/**
 * "Your prices" rows: every offer of the shop, plus products that only have a request so far. The newest request per
 * SKU decides what is shown next to the live price (requests arrive newest first).
 */
export function priceRows(offers: readonly OfferIn[], requests: readonly RequestIn[]): PriceRow[] {
  const newest = new Map<string, RequestIn>();
  for (const r of requests) if (!newest.has(r.sku)) newest.set(r.sku, r);
  const row = (base: Omit<PriceRow, 'pendingPaise' | 'rejectedReason'>): PriceRow => {
    const r = newest.get(base.sku);
    return {
      ...base,
      pendingPaise: r?.status === 'pending' ? r.requestedPaise : null,
      rejectedReason: r?.status === 'rejected' ? (r.reasonCode ?? 'other') : null,
    };
  };
  const rows = offers.map((o) =>
    row({
      sku: o.sku,
      product: o.product,
      mrpPaise: o.mrpPaise,
      livePaise: o.sellingPaise,
      onHand: o.onHand,
    }),
  );
  const listed = new Set(offers.map((o) => o.sku));
  for (const r of newest.values())
    if (!listed.has(r.sku) && (r.status === 'pending' || r.status === 'rejected'))
      rows.push(row({ sku: r.sku, product: r.product, mrpPaise: r.mrpPaise, livePaise: null, onHand: 0 }));
  return rows;
}
