/**
 * Response shapes of the shop portal and admin routing routes (`apps/api/src/routes/shop-orders.ts`,
 * `admin-orders.ts`, `shop-inventory.ts`, `partner-onboarding.ts` price requests), mirroring their OpenAPI
 * schemas, for the web screens to validate what they receive (hard rule 4). Loaded only by the real-API portal
 * screens (dynamic import), never by shop pages or demo builds.
 */
import { z } from 'zod';

// ── Shop portal (/v1/shop/*) ──────────────────────────────────────────────────────────────────────────────────

const ShopOrderItem = z.object({
  title: z.string(),
  titleHi: z.string().nullable(),
  sku: z.string(),
  qty: z.number().int(),
  unitPaise: z.number().int(),
});

export const ShopOrder = z.object({
  code: z.string(),
  status: z.string(),
  version: z.number().int(),
  /** The customer's total for this sub-order. */
  totalPaise: z.number().int(),
  /** What the shop is paid: its own price × qty (review I1, 2026-11-14). */
  payoutPaise: z.number().int(),
  /** Cash to collect at delivery (cash-on-delivery orders), else null. */
  collectPaise: z.number().int().nullable(),
  /** MechDost Coins discount on this part, paid by MechDost (spec 20); optional so older API answers still parse. */
  coinDiscountPaise: z.number().int().optional(),
  pincode: z.string(),
  /** `unitPaise` is the shop's own price. */
  items: z.array(ShopOrderItem),
  assignmentId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** Only while the shop fulfils the order (`active` view); the customer is hidden on offers. */
  address: z.record(z.string(), z.unknown()).nullable(),
  /** History only: the reason code when this row is an order the shop accepted and gave up (status `given_up`). */
  givenUpReason: z.string().nullable().optional(),
});
export type ShopOrderDto = z.infer<typeof ShopOrder>;

export const ShopOrderList = z.object({ orders: z.array(ShopOrder), nextCursor: z.string().nullable() });

/** Accept, decline and advance answer with the new status and version. */
export const OrderChanged = z.object({ status: z.string(), version: z.number().int() });

export const DeliveryCheck = z.object({
  ok: z.boolean(),
  reason: z.enum(['wrong', 'locked']).optional(),
  attemptsLeft: z.number().int().optional(),
  version: z.number().int().optional(),
});
export type DeliveryCheckDto = z.infer<typeof DeliveryCheck>;

// ── Shop prices (/v1/shops/{shopId}/inventory, /v1/shop-onboarding/{shopId}/price-requests) ───────────────────

export const ShopOffer = z.object({
  sku: z.string(),
  product: z.string(),
  productSlug: z.string(),
  mrpPaise: z.number().int(),
  sellingPaise: z.number().int(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  free: z.number().int(),
  leadDays: z.number().int().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});
export type ShopOfferDto = z.infer<typeof ShopOffer>;
export const ShopOfferList = z.object({ offers: z.array(ShopOffer) });

/** One row of a shop's own price requests (the API pages them as loose records; these fields are used). */
export const ShopPriceRequest = z.object({
  id: z.string(),
  status: z.string(),
  sku: z.string(),
  product: z.string(),
  mrpPaise: z.number().int(),
  requestedPaise: z.number().int(),
  reasonCode: z.string().nullable(),
});
export type ShopPriceRequestDto = z.infer<typeof ShopPriceRequest>;
export const ShopPriceRequestPage = z.object({
  items: z.array(ShopPriceRequest),
  nextCursor: z.string().nullable(),
});
export const PriceRequestCreated = z.object({ id: z.string() });

// ── Admin routing (/v1/admin/orders*) ─────────────────────────────────────────────────────────────────────────

export const RoutingQueueItem = z.object({
  code: z.string(),
  status: z.string(),
  pincode: z.string(),
  placedAt: z.string(),
  totalPaise: z.number().int(),
  items: z.number().int(),
  version: z.number().int(),
  attempts: z.number().int(),
  /** Set when the latest attempt was a shop giving the order up after accepting it. */
  gaveUpReason: z.string().nullable(),
  offer: z.object({ shop: z.string(), expiresAt: z.string() }).nullable(),
});
export type RoutingQueueItemDto = z.infer<typeof RoutingQueueItem>;
export const RoutingQueue = z.object({ items: z.array(RoutingQueueItem), nextCursor: z.string().nullable() });

export const RankedShop = z.object({
  shopId: z.string(),
  name: z.string(),
  distanceKm: z.number().nullable(),
  stockedItems: z.number().int(),
  totalItems: z.number().int(),
  acceptanceRate: z.number().nullable(),
  rating: z.number().nullable(),
  pricePaise: z.number().int().nullable(),
  triedBefore: z.boolean(),
  /** This shop accepted the order and gave it up before. */
  gaveUpBefore: z.boolean(),
  eligible: z.boolean(),
  /** Inside its working hours now (IST); a closed shop's offer waits until `opensAt` + the grace setting. */
  openNow: z.boolean(),
  opensAt: z.string().nullable(),
});
export type RankedShopDto = z.infer<typeof RankedShop>;

export const RoutingOrder = z.object({
  code: z.string(),
  status: z.string(),
  version: z.number().int(),
  pincode: z.string(),
  totalPaise: z.number().int(),
  items: z.array(
    z.object({ sku: z.string(), title: z.string(), qty: z.number().int(), unitPaise: z.number().int() }),
  ),
  history: z.array(
    z.object({
      shop: z.string(),
      status: z.string(),
      offeredAt: z.string(),
      respondedAt: z.string().nullable(),
      declineReason: z.string().nullable(),
      giveUpReason: z.string().nullable(),
    }),
  ),
  shops: z.array(RankedShop),
});
export type RoutingOrderDto = z.infer<typeof RoutingOrder>;

export const OrderRouted = z.object({
  assignmentId: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
