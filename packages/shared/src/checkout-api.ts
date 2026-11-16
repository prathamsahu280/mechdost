/**
 * Response shapes of the customer checkout and order routes (`apps/api/src/routes/checkout.ts`), for the website in
 * real-API mode to validate what it receives (hard rule 4). Loaded only by the real-mode cart, checkout and order
 * screens (dynamic imports), never by the demo pages.
 */
import { z } from 'zod';
import { CustomerRefundDto } from './refunds-api';

export const CheckoutQuoteDto = z.object({
  cityCode: z.string(),
  deliveryStateCode: z.string(),
  pincode: z.string(),
  lines: z.array(
    z.object({
      sku: z.string(),
      qty: z.number().int(),
      name: z.string().nullable(),
      unitPaise: z.number().int().nullable(),
      mrpPaise: z.number().int().nullable(),
      totalPaise: z.number().int().nullable(),
      group: z.number().int().nullable(),
      issue: z.enum(['unavailable', 'insufficient_stock']).nullable(),
      available: z.number().int().nullable(),
    }),
  ),
  groups: z.array(
    z.object({
      seller: z.string(),
      subtotalPaise: z.number().int(),
      shippingPaise: z.number().int(),
      freeDeliveryMinPaise: z.number().int().nullable(),
      taxPaise: z.number().int(),
      totalPaise: z.number().int(),
      leadDays: z.number().int(),
    }),
  ),
  subtotalPaise: z.number().int(),
  shippingPaise: z.number().int(),
  codFeePaise: z.number().int(),
  taxPaise: z.number().int(),
  totalPaise: z.number().int(),
  onlineTotalPaise: z.number().int(),
  ok: z.boolean(),
  cod: z.object({
    allowed: z.boolean(),
    reason: z.enum(['over_cap', 'pincode']).nullable(),
    capPaise: z.number().int(),
  }),
});
export type CheckoutQuote = z.infer<typeof CheckoutQuoteDto>;

export const PlacedOrderDto = z.object({
  code: z.string(),
  paymentMethod: z.enum(['cod', 'online']),
  paymentStatus: z.string(),
  totalPaise: z.number().int(),
  orders: z.array(z.object({ code: z.string(), totalPaise: z.number().int() })),
  replayed: z.boolean(),
});

const Summary = z.object({
  code: z.string(),
  placedAt: z.string(),
  totalPaise: z.number().int(),
  placedTotalPaise: z.number().int(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
});

const TrackedOrder = z.object({
  code: z.string(),
  status: z.string(),
  version: z.number().int(),
  totalPaise: z.number().int(),
  shippingPaise: z.number().int(),
  seller: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      sku: z.string(),
      qty: z.number().int(),
      unitPaise: z.number().int(),
      totalPaise: z.number().int(),
    }),
  ),
  timeline: z.array(z.object({ status: z.string(), at: z.string() })),
  message: z.string().nullable(),
  deliveryCode: z.string().nullable(),
  canCancel: z.boolean(),
  /** Refunds on this part (spec 05); optional so answers from an older API still parse. */
  refunds: z.array(CustomerRefundDto).optional(),
});
export type TrackedOrder = z.infer<typeof TrackedOrder>;

export const MyOrderDto = Summary.loose().extend({
  business: z.object({ gstin: z.string(), businessName: z.string() }).nullable(),
  /** MechDost Coins used at checkout (spec 20); optional so answers from an older API still parse. */
  coins: z.object({ coins: z.number().int(), discountPaise: z.number().int() }).nullable().optional(),
  orders: z.array(TrackedOrder),
});
export type MyOrder = z.infer<typeof MyOrderDto>;

export const MyOrdersDto = z.object({
  orders: z.array(
    Summary.loose().extend({
      orders: z.array(z.object({ code: z.string(), status: z.string(), totalPaise: z.number().int() })),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MyOrders = z.infer<typeof MyOrdersDto>;

/** `POST /orders/{code}/cancel` answers with the order's new state; only success matters to the screen. */
export const CancelledDto = z.looseObject({});
