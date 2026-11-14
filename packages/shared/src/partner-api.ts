/**
 * Response shapes of the seller onboarding routes (`apps/api/src/routes/partner-onboarding.ts`, `shop-inventory.ts`)
 * for the web screens in real sign-in builds (Stream D, 2026-11-14) to validate what they receive (hard rule 4).
 * The API declares several of these as loose records; the shapes here follow the repositories that fill them
 * (`packages/db/src/repo/partner-applications.ts`, `partner-invites.ts`, `price-requests.ts`, `agreements.ts`).
 * Loaded only by dynamically imported API screens, never by demo pages (JS budget, spec 16).
 */
import { z } from 'zod';
import { APPLICATION_STATES, INVITE_STATES, PRICE_REQUEST_STATES } from './state';

const Iso = z.string();
const Paise = z.number().int();

/** `POST /v1/partner-applications`, `POST /v1/partner-invites/{token}/application`. */
export const ApplicationReceived = z.object({ code: z.string(), status: z.string() });

/** `GET /v1/partner-invites/{token}` (the phone is masked to its last 4 digits). */
export const OpenInvite = z.object({
  name: z.string(),
  email: z.string(),
  phoneLast4: z.string(),
  expiresAt: Iso,
});
export type OpenInviteDto = z.infer<typeof OpenInvite>;

const ApplicationRow = z.object({
  code: z.string(),
  kind: z.string(),
  status: z.enum(APPLICATION_STATES),
  source: z.string(),
  name: z.string(),
  shopName: z.string().nullable(),
  pincode: z.string(),
  gstStatus: z.string().nullable(),
  createdAt: Iso,
});
export type ApplicationRowDto = z.infer<typeof ApplicationRow>;

/** `GET /v1/admin/partner-applications`. */
export const ApplicationPage = z.object({
  items: z.array(ApplicationRow),
  nextCursor: z.string().nullable(),
});

/** `GET /v1/admin/partner-applications/{code}`. */
export const ApplicationDetail = z.object({
  code: z.string(),
  status: z.enum(APPLICATION_STATES),
  version: z.number().int(),
  source: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  businessName: z.string().nullable(),
  shopName: z.string().nullable(),
  gstStatus: z.string().nullable(),
  gstNumber: z.string().nullable(),
  duplicateGstin: z.boolean(),
  addressLine: z.string().nullable(),
  landmark: z.string().nullable(),
  pincode: z.string(),
  location: z
    .object({
      lat: z.number(),
      lng: z.number(),
      accuracyM: z.number().nullable(),
      source: z.string().nullable(),
    })
    .nullable(),
  products: z.number().int(),
  productSlugs: z.array(z.string()),
  reasonCode: z.string().nullable(),
  createdAt: Iso,
});
export type ApplicationDetailDto = z.infer<typeof ApplicationDetail>;

export const ApplicationApproved = z.object({ shopId: z.string() });
export const StatusAnswer = z.object({ status: z.string() });

/** `POST /v1/admin/partner-invites` (the link is shown once). */
export const InviteCreated = z.object({
  id: z.string(),
  token: z.string(),
  link: z.string(),
  expiresAt: Iso,
});

const InviteRow = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  status: z.enum(INVITE_STATES),
  expiresAt: Iso,
  usedAt: Iso.nullable(),
  createdAt: Iso,
});
export type InviteRowDto = z.infer<typeof InviteRow>;

/** `GET /v1/admin/partner-invites`. */
export const InvitePage = z.object({ items: z.array(InviteRow), nextCursor: z.string().nullable() });

const PriceRequestRow = z.object({
  id: z.string(),
  version: z.number().int(),
  status: z.enum(PRICE_REQUEST_STATES),
  shopId: z.string(),
  shopName: z.string(),
  sku: z.string(),
  product: z.string(),
  mrpPaise: Paise,
  requestedPaise: Paise,
  previousPaise: Paise.nullable(),
  onHand: z.number().int(),
  reasonCode: z.string().nullable(),
  createdAt: Iso,
  decidedAt: Iso.nullable(),
});
export type PriceRequestRowDto = z.infer<typeof PriceRequestRow>;

/** `GET /v1/admin/price-requests`, `GET /v1/shop-onboarding/{shopId}/price-requests`. */
export const PriceRequestPage = z.object({
  items: z.array(PriceRequestRow),
  nextCursor: z.string().nullable(),
});
export const PriceRequested = z.object({ id: z.string() });

const Agreement = z.object({
  version: z.number().int(),
  textEn: z.string(),
  textHi: z.string(),
  publishedAt: Iso,
});

/** `GET /v1/admin/agreements/current`. */
export const CurrentAgreement = z.object({ agreement: Agreement.nullable() });
export const AgreementPublished = z.object({ version: z.number().int() });

/** `GET /v1/shop-onboarding/{shopId}/agreement`. */
export const ShopAgreement = z.object({
  current: Agreement.nullable(),
  acceptedVersions: z.array(z.number().int()),
});
export type ShopAgreementDto = z.infer<typeof ShopAgreement>;
export const AgreementAccepted = z.object({ live: z.boolean() });

const ShopOffer = z.object({
  sku: z.string(),
  product: z.string(),
  productSlug: z.string(),
  mrpPaise: Paise,
  sellingPaise: Paise,
  onHand: z.number().int(),
  reserved: z.number().int(),
  free: z.number().int(),
  leadDays: z.number().int().nullable(),
  active: z.boolean(),
  version: z.number().int(),
});
export type ShopOfferDto = z.infer<typeof ShopOffer>;

/** `GET /v1/shops/{shopId}/inventory`. */
export const ShopOffers = z.object({ offers: z.array(ShopOffer) });

/** The roles part of `GET /v1/me`: which shop a partner account manages. */
export const MeRoles = z.object({
  roles: z.array(
    z.object({ role: z.string(), shopId: z.string().nullable(), workshopId: z.string().nullable() }),
  ),
});

/** The API's error body: `{ error: { code, message, details? } }` (`apps/api/src/errors.ts`). */
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    details: z.unknown().optional(),
  }),
});

/** `details` of `APPLICATION_INVALID`: the top-level fields that failed. */
export const FieldsDetails = z.object({ fields: z.array(z.string()) });
