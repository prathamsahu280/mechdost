/**
 * Shop portal, next tier part 2 (design `docs/superpowers/specs/2026-11-15-shops-next-tier-design.md`, items 4 to 7):
 * the stock and price CSV, the packing slip, the performance page and the public application status lookup. Wire
 * shapes shared by the API and the web; the pure rules live in `shop-csv.ts`, `shop-performance.ts` and `qr.ts`.
 */
import { z } from 'zod';
import { SHOP_CSV_COLUMNS, SHOP_CSV_ERROR_CODES } from './shop-csv';

const ChangeFlag = <T extends z.ZodType>(t: T) => z.object({ from: t, to: t }).nullable();

export const ShopCsvPreview = z.object({
  rows: z.number().int(),
  unchanged: z.number().int(),
  errors: z.array(
    z.object({
      line: z.number().int(),
      column: z.enum(SHOP_CSV_COLUMNS),
      code: z.enum(SHOP_CSV_ERROR_CODES),
    }),
  ),
  /** At most the first 200 changes are listed; the counts below are complete. */
  changes: z.array(
    z.object({
      line: z.number().int(),
      sku: z.string(),
      stock: ChangeFlag(z.number().int()),
      active: ChangeFlag(z.boolean()),
      price: z
        .object({
          requestedPaise: z.number().int(),
          currentPaise: z.number().int().nullable(),
          onHand: z.number().int(),
        })
        .nullable(),
    }),
  ),
  counts: z.object({
    stock: z.number().int(),
    active: z.number().int(),
    priceRequests: z.number().int(),
  }),
});
export type ShopCsvPreviewDto = z.infer<typeof ShopCsvPreview>;

export const ShopCsvApplied = z.object({
  stock: z.number().int(),
  active: z.number().int(),
  priceRequests: z.number().int(),
});
export type ShopCsvAppliedDto = z.infer<typeof ShopCsvApplied>;

/** The packing slip: what to pack and where it goes. No prices (the customer copy is not an invoice, Q97). */
export const PackingSlip = z.object({
  code: z.string(),
  placedAt: z.string(),
  shopName: z.string(),
  shopNameHi: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string(),
      titleHi: z.string().nullable(),
      sku: z.string(),
      qty: z.number().int(),
    }),
  ),
  pincode: z.string(),
  /** Area name of the PIN (null when the PIN has none on file). */
  area: z.string().nullable(),
  areaHi: z.string().nullable(),
  /** First name only, and the phone with all but the last four digits hidden (Q99: masked by default). */
  firstName: z.string(),
  phoneMasked: z.string(),
});
export type PackingSlipDto = z.infer<typeof PackingSlip>;

const Bp = z.number().int().nullable();
export const MetricsDto = z.object({
  offers: z.number().int(),
  acceptanceBp: Bp,
  medianAcceptSeconds: z.number().int().nullable(),
  giveUps: z.number().int(),
  giveUpBp: Bp,
  onTimeBp: Bp,
  ratingX100: z.number().int().nullable(),
  ratingCount: z.number().int(),
});
export const BenchmarkDto = z.object({
  acceptanceBp: Bp,
  medianAcceptSeconds: z.number().int().nullable(),
  giveUpBp: Bp,
  onTimeBp: Bp,
  ratingX100: z.number().int().nullable(),
});
export const ShopPerformance = z.object({
  shopId: z.string(),
  onTimeHours: z.number().int(),
  windows: z.array(
    z.object({
      days: z.number().int(),
      mine: MetricsDto,
      /** The anonymous city median; null when the owner's shops span cities or too few other shops exist. */
      city: BenchmarkDto.nullable(),
    }),
  ),
});
export type ShopPerformanceDto = z.infer<typeof ShopPerformance>;

/** Public status lookup: reference + a signed-in phone proof. Only the stage comes back (design 2026-11-15, item 7). */
export const ApplicationStatusBody = z
  .object({ code: z.string().regex(/^PA-[A-Z]{3}-\d{4}-[0-9A-Z]{6}$/) })
  .strict();
export const ApplicationStatusDto = z.object({
  code: z.string(),
  kind: z.enum(['seller', 'garage', 'mechanic']),
  stage: z.enum(['new', 'in_review', 'approved', 'rejected']),
  /** When the application was last updated (UTC); no reviewer, note or reason is ever shown here. */
  updatedAt: z.string(),
});
export type ApplicationStatusView = z.infer<typeof ApplicationStatusDto>;
