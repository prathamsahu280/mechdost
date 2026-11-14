/**
 * Shop management on the real API (decision 2026-11-14 "Shop management"; specs 07/08): request bodies the API
 * validates (strict, no mass assignment) and the response shapes the web screens check (hard rule 4). Routes:
 * `apps/api/src/routes/admin-shops.ts`; repositories `packages/db/src/repo/shops-admin.ts`, `partners.ts`.
 * Loaded only by the API and by dynamically imported real-mode screens (JS budget, spec 16).
 */
import { z } from 'zod';
import { STAFF_STANDING_REASONS, PARTNER_STANDING_REASONS } from './partner-codes';
import { isShopHours } from './shop-hours';

const PINCODE_RE = /^[1-9][0-9]{5}$/;
const PHONE_RE = /^\+91[6-9][0-9]{9}$/;
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** Up to ₹1,00,000 for a free-delivery threshold; 0 = always free. */
const FREE_DELIVERY_MAX_PAISE = 10_000_000;
/** A delivery charge per PIN: up to ₹10,000. */
const SHIPPING_MAX_PAISE = 1_000_000;

export const SHOP_STATUSES = ['pending', 'approved', 'paused', 'suspended'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

/** Working hours `{open, close, days}` in IST (`@mechdost/shared/shop-hours`; close may be 24:00). */
export const ShopHoursSchema = z
  .object({
    open: z.string(),
    close: z.string(),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .strict()
  .refine((h) => isShopHours(h), { message: 'one window, close after open, distinct weekdays' });

/** Staff: edit a shop's profile. Only the fields sent change; `version` is the compare-and-set. */
export const ShopProfilePatchSchema = z
  .object({
    version: z.number().int().min(1),
    name: text(2, 120).optional(),
    nameHi: text(2, 120).nullable().optional(),
    legalName: text(2, 160).nullable().optional(),
    addressLine: text(5, 300).optional(),
    addressLineHi: text(5, 300).nullable().optional(),
    phone: z.string().regex(PHONE_RE).optional(),
    email: z.email().max(254).nullable().optional(),
    gstin: z.string().regex(GSTIN_SHAPE).optional(),
    acceptanceTimeoutMin: z.number().int().min(5).max(120).nullable().optional(),
    freeDeliveryMinPaise: z.number().int().min(0).max(FREE_DELIVERY_MAX_PAISE).nullable().optional(),
    hours: ShopHoursSchema.optional(),
  })
  .strict();

export const ShopCoverageRowSchema = z
  .object({
    pincode: z.string().regex(PINCODE_RE),
    shippingPaise: z.number().int().min(0).max(SHIPPING_MAX_PAISE),
    leadDays: z.number().int().min(0).max(60),
    active: z.boolean(),
  })
  .strict();

/** Staff: add or change PIN codes and remove others in one change (`version` = the shop's). */
export const ShopCoverageSchema = z
  .object({
    version: z.number().int().min(1),
    upsert: z.array(ShopCoverageRowSchema).max(200),
    remove: z.array(z.string().regex(PINCODE_RE)).max(200),
  })
  .strict()
  .refine((b) => b.upsert.length + b.remove.length > 0, { message: 'nothing to change', path: ['upsert'] });

/** Staff: pause, suspend or reactivate with a reason code and the note the shop reads. */
export const ShopStandingSchema = z
  .object({
    status: z.enum(['approved', 'paused', 'suspended']),
    reasonCode: z.enum(STAFF_STANDING_REASONS),
    note: text(5, 300),
    /** A pause may end by itself (Q28); ISO date-time, in the future. */
    pausedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((b) => b.status === 'paused' || !b.pausedUntil, {
    message: 'only a pause can have an end date',
    path: ['pausedUntil'],
  });

/** Staff: give a signed-up person (by phone) owner or staff access to the shop portal. */
export const ShopMemberSchema = z
  .object({
    phone: z.string().regex(PHONE_RE),
    role: z.enum(['seller_owner', 'seller_staff']),
  })
  .strict();

/** The owner: set the shop's working hours. */
export const OwnShopHoursSchema = z
  .object({ version: z.number().int().min(1), hours: ShopHoursSchema })
  .strict();

/* ─────────────── Responses ─────────────── */

const ShopHoursDto = z.object({ open: z.string(), close: z.string(), days: z.array(z.number().int()) });

export const AdminShopRow = z.object({
  id: z.string(),
  cityId: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  addressLine: z.string(),
  addressLineHi: z.string().nullable(),
  pincode: z.string(),
  status: z.enum(SHOP_STATUSES),
  gstStatus: z.string(),
  busy: z.boolean(),
  coveragePincodes: z.number().int(),
  offersOnSale: z.number().int(),
  freeDeliveryMinPaise: z.number().int().nullable(),
  hours: ShopHoursDto,
  openNow: z.boolean(),
  version: z.number().int(),
  missingHindi: z.array(z.string()),
});
export type AdminShopRowDto = z.infer<typeof AdminShopRow>;

export const AdminShopList = z.object({ items: z.array(AdminShopRow), nextCursor: z.string().nullable() });

export const AdminShopDetail = AdminShopRow.extend({
  legalName: z.string().nullable(),
  gstin: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  acceptanceTimeoutMin: z.number().int().nullable(),
  statusReason: z.string().nullable(),
  statusReasonCode: z.enum(PARTNER_STANDING_REASONS).nullable(),
  statusChangedAt: z.string().nullable(),
  pausedUntil: z.string().nullable(),
  coverage: z.array(
    z.object({
      pincode: z.string(),
      shippingPaise: z.number().int(),
      leadDays: z.number().int(),
      active: z.boolean(),
    }),
  ),
  history: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      reasonCode: z.enum(PARTNER_STANDING_REASONS).nullable(),
      reason: z.string(),
      endsAt: z.string().nullable(),
      at: z.string(),
    }),
  ),
  members: z.array(
    z.object({
      userId: z.string(),
      role: z.enum(['seller_owner', 'seller_staff']),
      phoneLast4: z.string().nullable(),
    }),
  ),
});
export type AdminShopDetailDto = z.infer<typeof AdminShopDetail>;

export const ShopVersion = z.object({ version: z.number().int() });
export const ShopStandingSaved = z.object({ status: z.string(), version: z.number().int() });
export const ShopMemberAdded = z.object({ userId: z.string() });

export const MyShop = z.object({
  id: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  addressLine: z.string(),
  addressLineHi: z.string().nullable(),
  pincode: z.string(),
  status: z.enum(SHOP_STATUSES),
  standing: z
    .object({
      reasonCode: z.enum(PARTNER_STANDING_REASONS).nullable(),
      note: z.string().nullable(),
      until: z.string().nullable(),
      since: z.string().nullable(),
    })
    .nullable(),
  busy: z.boolean(),
  coverage: z.object({
    pincodes: z.number().int(),
    minShippingPaise: z.number().int().nullable(),
    maxShippingPaise: z.number().int().nullable(),
  }),
  freeDeliveryMinPaise: z.number().int().nullable(),
  hours: ShopHoursDto,
  openNow: z.boolean(),
  version: z.number().int(),
  offersOnSale: z.number().int(),
  offers30d: z.object({ accepted: z.number().int(), answered: z.number().int() }),
  /** True when the signed-in person owns this shop (only owners edit the hours). */
  isOwner: z.boolean(),
});
export type MyShopDto = z.infer<typeof MyShop>;
export const MyShops = z.object({ shops: z.array(MyShop) });
