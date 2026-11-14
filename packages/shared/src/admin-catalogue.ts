/**
 * Response shapes of the admin catalogue and price routes (`apps/api/src/routes/admin-catalogue.ts`,
 * `admin-prices.ts`), for the web admin screen to validate what it receives (hard rule 4). Loaded only by the
 * admin catalogue editor (dynamic import), never by shop pages.
 */
import { z } from 'zod';
import { NET_UNITS } from './product-attributes';
import { VEHICLE_TYPES } from './vehicles';

const ProductBase = z.object({
  slug: z.string(),
  status: z.string(),
  version: z.number().int(),
  brand: z.string(),
  category: z.string(),
  name: z.string(),
  nameHi: z.string().nullable(),
  specSummary: z.string().nullable(),
  specSummaryHi: z.string().nullable(),
  compatibility: z.string().nullable(),
  compatibilityHi: z.string().nullable(),
  description: z.string().nullable(),
  descriptionHi: z.string().nullable(),
  highlights: z.array(z.string()),
  highlightsHi: z.array(z.string()),
  vehicleTypes: z.array(z.string()),
  rejectionReason: z.string().nullable(),
  missingHindi: z.array(z.string()),
});
export type AdminProductDto = z.infer<typeof ProductBase>;

export const AdminProductList = z.object({ items: z.array(ProductBase), next: z.string().nullable() });

const NetQuantity = z.object({ qty: z.number().int(), unit: z.enum(NET_UNITS) });

export const AdminProductDetail = ProductBase.extend({
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  variants: z.array(
    z.object({ sku: z.string(), mrpPaise: z.number().int(), netQuantity: NetQuantity.nullable() }),
  ),
});
export type AdminProductDetailDto = z.infer<typeof AdminProductDetail>;

export const AdminTextsSaved = z.object({ version: z.number().int(), missingHindi: z.array(z.string()) });
export const AdminVehicleTypesSaved = z.object({
  version: z.number().int(),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPES)),
});
export const AdminNetQuantitySaved = z.object({ sku: z.string(), netQuantity: NetQuantity.nullable() });

const PriceRef = z.object({ pricePaise: z.number().int(), version: z.number().int() });
export const AdminPriceBoard = z.object({
  productSlug: z.string(),
  cityCode: z.string(),
  variants: z.array(
    z.object({
      sku: z.string(),
      mrpPaise: z.number().int(),
      city: PriceRef.nullable(),
      pins: z.array(
        z.object({
          pincode: z.string(),
          override: PriceRef.nullable(),
          nearestShopPaise: z.number().int().nullable(),
          lowestShopPaise: z.number().int().nullable(),
          highestShopPaise: z.number().int().nullable(),
        }),
      ),
    }),
  ),
});
export const AdminPriceSaved = z.object({ version: z.number().int() });
/** `DELETE` answers 204 with no body. */
export const NoContent = z.null();
