/**
 * Response shapes of the PIN code routes (`apps/api/src/routes/geo.ts`; spec 15 "PIN codes"), for the web screens
 * in real sign-in builds to validate what they receive (hard rule 4). Loaded only by those screens (dynamic
 * import), never by demo bundles. The API builds its own request schemas from `./geo` constants.
 */
import { z } from 'zod';
import { PINCODE_INACTIVE_REASONS, PINCODE_SOURCES } from './geo';

const Int = z.number().int();

export const AdminPincode = z.object({
  pincode: z.string(),
  areaEn: z.string().nullable(),
  areaHi: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  active: z.boolean(),
  /** A reason added later reads as "other" until the screens know it. */
  inactiveReason: z.enum(PINCODE_INACTIVE_REASONS).catch('other').nullable(),
  inactiveNote: z.string().nullable(),
  source: z.enum(PINCODE_SOURCES).catch('admin'),
  /** Free-delivery threshold for this PIN in paise; null = shop, then city setting (spec 03). */
  freeDeliveryMinPaise: Int.nullable(),
  /** Active delivery-area rows of shops that cover this PIN code. */
  shopsCovering: Int,
  version: Int,
  updatedAt: z.string(),
});
export type AdminPincodeDto = z.infer<typeof AdminPincode>;

export const AdminPincodeList = z.object({
  city: z.object({ code: z.string(), name: z.string(), nameHi: z.string().nullable() }),
  pincodes: z.array(AdminPincode),
});
export type AdminPincodeListDto = z.infer<typeof AdminPincodeList>;

export const PincodeSaved = z.object({ pincode: z.string(), version: Int });

/** Public list: active PIN codes of a live city, the area name in the requested language. */
export const PublicPincode = z.object({
  pincode: z.string(),
  area: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});
export type PublicPincodeDto = z.infer<typeof PublicPincode>;
export const PublicPincodeList = z.object({ city: z.string(), pincodes: z.array(PublicPincode) });
