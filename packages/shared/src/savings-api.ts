/**
 * Response shapes of the "Your savings" routes (`apps/api/src/routes/savings.ts`; decision 2026-11-26) for the API's
 * OpenAPI and the website in real data mode (hard rule 4). Loaded only by lazy savings chunks, never by first-load
 * code. The maths lives in the Zod-free `./savings`.
 */
import { z } from 'zod';
import { SAVINGS_PERIODS } from './savings';

/** Checkout code (`MD-RPR-2026-XXXXXX`) or one part's code (`…-1`). */
export const SavingsOrderCode = z.string().regex(/^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}(-\d{1,2})?$/);

const Totals = {
  /** Printed-MRP saving: (MRP − price paid) × qty, lines with a recorded MRP only. */
  mrpPaise: z.number().int(),
  couponPaise: z.number().int(),
  coinsPaise: z.number().int(),
  /** Delivery fee waived by the free-delivery threshold. */
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  /** Lines left out because no printed MRP was recorded. */
  excludedLines: z.number().int(),
};

export const MySavingsDto = z.object({
  /** False when the admin switched the feature off: show nothing (totals are 0). */
  enabled: z.boolean(),
  period: z.enum(SAVINGS_PERIODS),
  /** YYYY-MM or YYYY (IST). */
  label: z.string(),
  from: z.string(),
  to: z.string(),
  ...Totals,
  /** Delivered orders counted. */
  orders: z.number().int(),
});
export type MySavingsView = z.infer<typeof MySavingsDto>;

export const OrderSavingsDto = z.object({
  enabled: z.boolean(),
  /** `final` after delivery (net of refunds), `estimate` while a part is on its way, `none` (cancelled or off). */
  status: z.enum(['final', 'estimate', 'none']),
  ...Totals,
  refunded: z.boolean(),
});
export type OrderSavingsViewDto = z.infer<typeof OrderSavingsDto>;

/** The cart quote's estimate (`POST /checkout/quote` → `savingsEstimate`); null when the feature is off. */
export const SavingsEstimateDto = z.object({
  mrpPaise: z.number().int(),
  deliveryPaise: z.number().int(),
  totalPaise: z.number().int(),
  excludedLines: z.number().int(),
});
export type SavingsEstimateView = z.infer<typeof SavingsEstimateDto>;
