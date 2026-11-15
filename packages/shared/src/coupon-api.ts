/**
 * Coupon request and response shapes (spec 03 "Coupons", spec 07 shop offers, spec 08 admin): one definition for the
 * API and the web in real mode. Loaded by the coupon screens only (lazy imports), never by the always-loaded modules
 * (JS budget). The maths lives in the Zod-free `./coupon`.
 */
import { z } from 'zod';
import { COUPON_FUNDERS, COUPON_KINDS, COUPON_LIMITS, COUPON_REASONS } from './coupon';

const Text = (min: number, max: number) => z.string().trim().min(min).max(max);
/** `YYYY-MM-DDTHH:mm` as typed into the form: India time (IST), converted on the server. */
const IstLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/**
 * What staff enter. Mirrors the database CHECKs so a bad form is a 422 with the field, not a 500. Hindi is required
 * for what the customer reads (hard rule 10): the name, and the conditions text when there is one.
 */
export const CouponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{4,20}$/),
    title: Text(2, 80),
    titleHi: Text(2, 120),
    terms: Text(1, 400).nullable(),
    termsHi: Text(1, 600).nullable(),
    kind: z.enum(COUPON_KINDS),
    /** Percent (1..90) for `percent`, rupees in paise for `flat`, 0 for free delivery. */
    value: z.number().int().min(0).max(COUPON_LIMITS.valueMaxPaise),
    minSubtotalPaise: z.number().int().min(0).max(COUPON_LIMITS.valueMaxPaise),
    maxDiscountPaise: z.number().int().min(1).max(COUPON_LIMITS.valueMaxPaise).nullable(),
    startsAtIst: IstLocal,
    endsAtIst: IstLocal.nullable(),
    usageLimitTotal: z.number().int().min(1).max(COUPON_LIMITS.totalUseMax).nullable(),
    usageLimitPerUser: z.number().int().min(1).max(COUPON_LIMITS.perUserMax),
    firstOrderOnly: z.boolean(),
    /** City code (e.g. RPR) or null for every city (all-cities staff only). */
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    funder: z.enum(COUPON_FUNDERS),
    shopId: z.uuid().nullable(),
    /** Listed on the public offers page (admin chooses; never by default). */
    isPublic: z.boolean(),
    /** Applied at checkout without a code (the code is then only a name for staff). MechDost-funded only. */
    autoApply: z.boolean(),
    /** Category offer: only the lines of this category count. */
    categorySlug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,119}$/)
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const bad = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (v.kind === 'percent' && (v.value < 1 || v.value > COUPON_LIMITS.percentMax))
      bad('value', `Percent must be 1 to ${String(COUPON_LIMITS.percentMax)}`);
    if (v.kind === 'flat' && v.value < 1) bad('value', 'Flat amount must be more than 0');
    if (v.kind === 'free_shipping' && v.value !== 0) bad('value', 'Free delivery has no amount');
    if (v.maxDiscountPaise !== null && v.kind !== 'percent')
      bad('maxDiscountPaise', 'A cap is for percent only');
    if (v.endsAtIst !== null && v.endsAtIst <= v.startsAtIst)
      bad('endsAtIst', 'The end must be after the start');
    if (v.funder === 'shop' && v.shopId === null) bad('shopId', 'A shop-funded coupon names its shop');
    if (v.funder === 'mechdost' && v.shopId !== null) bad('shopId', 'A MechDost-funded coupon has no shop');
    if (v.funder === 'shop' && v.kind === 'free_shipping') bad('kind', 'A shop cannot fund free delivery');
    if (v.autoApply && v.funder !== 'mechdost') bad('autoApply', 'An automatic offer is funded by MechDost');
    if (v.categorySlug !== null && v.kind === 'free_shipping')
      bad('categorySlug', 'Free delivery does not depend on a category');
    if (v.firstOrderOnly && v.usageLimitPerUser !== 1)
      bad('usageLimitPerUser', 'First order only means once each');
    if ((v.terms === null) !== (v.termsHi === null))
      bad('termsHi', 'Write the conditions in English and Hindi');
  });
export type CouponInput = z.infer<typeof CouponInputSchema>;

export const CouponPauseBodySchema = z
  .object({
    paused: z.boolean(),
    reason: Text(3, 300).nullable(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((v) => !v.paused || v.reason !== null, { path: ['reason'], message: 'Say why it is paused' });
export type CouponPauseBody = z.infer<typeof CouponPauseBodySchema>;

export const CouponUpdateBodySchema = z
  .object({ version: z.number().int().min(1), coupon: CouponInputSchema })
  .strict();

export const ShopTermsStatus = z.enum(['pending', 'accepted', 'declined']);

export const AdminCouponDto = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  titleHi: z.string().nullable(),
  terms: z.string().nullable(),
  termsHi: z.string().nullable(),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int(),
  minSubtotalPaise: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  startsAtIst: z.string(),
  endsAtIst: z.string().nullable(),
  usageLimitTotal: z.number().int().nullable(),
  usageLimitPerUser: z.number().int(),
  usedCount: z.number().int(),
  firstOrderOnly: z.boolean(),
  cityCode: z.string().nullable(),
  funder: z.enum(COUPON_FUNDERS),
  shop: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Shop-funded only: has the shop accepted the offer terms (it cannot be used until it has). */
  shopTerms: ShopTermsStatus.nullable(),
  isPublic: z.boolean(),
  autoApply: z.boolean(),
  category: z.object({ slug: z.string(), name: z.string() }).nullable(),
  active: z.boolean(),
  pausedReason: z.string().nullable(),
  /** Live right now: active, started, not ended, uses left and (shop-funded) accepted. */
  live: z.boolean(),
  version: z.number().int(),
});
export type AdminCoupon = z.infer<typeof AdminCouponDto>;

export const AdminCouponListDto = z.object({
  coupons: z.array(AdminCouponDto),
  nextCursor: z.string().nullable(),
});

/** Shop portal: an offer a shop is asked to fund. `version` is the terms row's, sent back with the decision. */
export const ShopOfferDto = z.object({
  couponId: z.string(),
  code: z.string(),
  title: z.string(),
  titleHi: z.string().nullable(),
  terms: z.string().nullable(),
  termsHi: z.string().nullable(),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int(),
  minSubtotalPaise: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  usageLimitTotal: z.number().int().nullable(),
  usageLimitPerUser: z.number().int(),
  usedCount: z.number().int(),
  firstOrderOnly: z.boolean(),
  status: ShopTermsStatus,
  version: z.number().int(),
  decidedAt: z.string().nullable(),
});
export type ShopOffer = z.infer<typeof ShopOfferDto>;
export const ShopOffersDto = z.object({ offers: z.array(ShopOfferDto) });

export const ShopOfferDecisionBodySchema = z
  .object({ decision: z.enum(['accept', 'decline']), version: z.number().int().min(1) })
  .strict();

export const ShopOfferDecidedDto = z.object({
  status: z.enum(['accepted', 'declined']),
  version: z.number().int(),
});

/** The coupon as the customer reads it before applying (`CouponView` in the db layer). */
export const CouponViewDto = z.object({
  code: z.string(),
  title: z.string(),
  terms: z.string().nullable(),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int(),
  minSubtotalPaise: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  funder: z.enum(COUPON_FUNDERS),
  shopName: z.string().nullable(),
  endsAt: z.string().nullable(),
  firstOrderOnly: z.boolean(),
});
export type CouponViewDto = z.infer<typeof CouponViewDto>;

/** Which kind of offer won the order (2026-11-16 ruling: never stacked, the larger discount wins, a tie goes to the code). */
export const OFFER_SOURCES = ['code', 'automatic'] as const;
export type OfferSource = (typeof OFFER_SOURCES)[number];

export const CouponPreviewDto = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    coupon: CouponViewDto,
    /** `automatic` = applied without a code (the code in `coupon` is only its internal name, shown as `title`). */
    source: z.enum(OFFER_SOURCES),
    /** The offer that lost to this one, so the customer sees what they did not get (never stacked). */
    beaten: z
      .object({ source: z.enum(OFFER_SOURCES), title: z.string(), discountPaise: z.number().int() })
      .nullable(),
    discountPaise: z.number().int(),
    productDiscountPaise: z.number().int(),
    shippingDiscountPaise: z.number().int(),
    netSubtotalPaise: z.number().int(),
    totalPaise: z.number().int(),
    onlineTotalPaise: z.number().int(),
    cod: z.object({
      allowed: z.boolean(),
      reason: z.enum(['over_cap', 'pincode']).nullable(),
      capPaise: z.number().int(),
    }),
  }),
  z.object({ ok: z.literal(false), reason: z.enum(COUPON_REASONS), coupon: CouponViewDto.nullable() }),
]);
export type CouponPreview = z.infer<typeof CouponPreviewDto>;

/**
 * One offer on the public offers page (2026-11-16). Only what a customer may read: no usage numbers, no internal
 * codes of automatic offers (`code` is null for them: "applied automatically at checkout"), text in the page language.
 */
export const PublicOfferDto = z.object({
  id: z.string(),
  /** The code to copy; null for an automatic offer. */
  code: z.string().nullable(),
  title: z.string(),
  terms: z.string().nullable(),
  kind: z.enum(COUPON_KINDS),
  value: z.number().int(),
  minSubtotalPaise: z.number().int(),
  maxDiscountPaise: z.number().int().nullable(),
  endsAt: z.string().nullable(),
  firstOrderOnly: z.boolean(),
  automatic: z.boolean(),
  categoryName: z.string().nullable(),
  funder: z.enum(COUPON_FUNDERS),
  shopName: z.string().nullable(),
});
export type PublicOffer = z.infer<typeof PublicOfferDto>;
export const PublicOffersDto = z.object({ offers: z.array(PublicOfferDto) });

/** The category picker of the coupon form reads the public `/catalogue/categories` answer: only what it shows. */
export const CouponCategoryListDto = z.object({
  categories: z.array(z.object({ slug: z.string(), parentSlug: z.string().nullable(), name: z.string() })),
});

/** Admin → Coupons → Usage (2026-11-16). Uses never count a released order (cancelled, rejected or fully refunded). */
export const CouponUsageDayDto = z.object({
  /** IST calendar day, YYYY-MM-DD. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orders: z.number().int(),
  released: z.number().int(),
  discountPaise: z.number().int(),
  uniqueCustomers: z.number().int(),
});
export const CouponUsageReportDto = z.object({
  couponId: z.string(),
  code: z.string(),
  totals: z.object({
    /** Orders placed with the coupon (one per checkout). */
    orders: z.number().int(),
    /** Of those, uses given back. */
    released: z.number().int(),
    /** Net uses = orders - released (matches the coupon's `usedCount`). */
    uses: z.number().int(),
    /** Discount given on the orders that kept the use. */
    discountPaise: z.number().int(),
    uniqueCustomers: z.number().int(),
  }),
  days: z.array(CouponUsageDayDto),
  nextCursor: z.string().nullable(),
});
export type CouponUsageReport = z.infer<typeof CouponUsageReportDto>;
