/**
 * Response shapes of the admin catalogue and price routes (`apps/api/src/routes/admin-catalogue.ts`,
 * `admin-prices.ts`), for the web admin screen to validate what it receives (hard rule 4). Loaded only by the
 * admin catalogue editor (dynamic import), never by shop pages.
 */
import { z } from 'zod';
import { CATALOGUE_SLUG_RE, CatalogueCategorySchema } from './catalogue';
import { IMPORT_COLUMNS, IMPORT_ERROR_CODES, PRODUCT_GST_RATES_BP, SKU_RE } from './catalogue-import';
import { NET_QTY_MAX, NET_UNITS } from './product-attributes';
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
    z.object({ sku: z.string(), mrpPaise: z.number().int().nullable(), netQuantity: NetQuantity.nullable() }),
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
      mrpPaise: z.number().int().nullable(),
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

/**
 * Adding products (plan 2026-11-14 Stream B). The body of `POST /v1/admin/catalogue/products` and of every CSV
 * import row (the import maps its columns onto these fields first, `csvImportRows`). Strict: no status, shop or
 * price fields (the status comes from `publish` plus the caller's `products:publish`).
 */
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const Highlights = z.array(z.string().trim().max(120)).max(8).optional();

export const NewProductFields = z
  .object({
    categorySlug: z.string().regex(CATALOGUE_SLUG_RE),
    brand: z.string().trim().min(1).max(60),
    name: z.string().trim().min(3).max(160),
    nameHi: optText(160),
    slug: z.string().regex(CATALOGUE_SLUG_RE).nullable().optional(),
    specSummary: optText(200),
    specSummaryHi: optText(200),
    compatibility: optText(300),
    compatibilityHi: optText(300),
    description: optText(4000),
    descriptionHi: optText(4000),
    highlights: Highlights,
    highlightsHi: Highlights,
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(VEHICLE_TYPES.length).optional(),
    attributes: z
      .record(z.string().max(40), z.union([z.string().max(40), z.number(), z.boolean()]))
      .refine((a) => Object.keys(a).length <= 20, 'At most 20 attributes')
      .optional(),
    sku: z.string().trim().toUpperCase().regex(SKU_RE),
    /** MRP of the pack in integer paise (₹0.01 to ₹10,00,000). */
    mrpPaise: z.number().int().min(1).max(100_000_000),
    hsn: z.string().regex(/^[0-9]{4,8}$/),
    gstRateBp: z
      .number()
      .int()
      .refine((n) => (PRODUCT_GST_RATES_BP as readonly number[]).includes(n), 'A GST slab'),
    netQuantity: z
      .object({ qty: z.number().int().min(1).max(NET_QTY_MAX), unit: z.enum(NET_UNITS) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type NewProductInput = z.infer<typeof NewProductFields>;

export const AdminProductCreated = z.object({
  slug: z.string(),
  sku: z.string(),
  status: z.string(),
  version: z.number().int(),
});

const ImportRowErrorSchema = z.object({
  row: z.number().int(),
  field: z.enum(IMPORT_COLUMNS),
  code: z.enum(IMPORT_ERROR_CODES),
});
const SkippedSchema = z.object({ row: z.number().int(), sku: z.string(), reason: z.literal('SKU_EXISTS') });

/** 200 of `POST /v1/admin/catalogue/import`: what was (or, on a dry run, would be) added and what was skipped. */
export const AdminImportReport = z.object({
  dryRun: z.boolean(),
  status: z.string(),
  created: z.array(z.object({ row: z.number().int(), slug: z.string(), sku: z.string() })),
  skipped: z.array(SkippedSchema),
});
export type AdminImportReportDto = z.infer<typeof AdminImportReport>;

/** `error.details` of a 422 `IMPORT_ROWS_INVALID`: every problem by row and column; nothing was written. */
export const AdminImportProblems = z.object({
  errors: z.array(ImportRowErrorSchema),
  skipped: z.array(SkippedSchema),
});
export type AdminImportProblemsDto = z.infer<typeof AdminImportProblems>;

/** `error.details` of a 422 `IMPORT_FILE`: the file itself could not be read (header, size, quotes). */
export const AdminImportFileProblem = z.object({
  reason: z.enum(['MALFORMED', 'EMPTY', 'TOO_MANY_ROWS', 'HEADER']),
  missing: z.array(z.string()).optional(),
  unknown: z.array(z.string()).optional(),
});

/** `GET /v1/catalogue/categories`: the add form's category list (names in the screen's language). */
export const AdminCategoryList = z.object({ categories: z.array(CatalogueCategorySchema) });

/** `GET /v1/admin/catalogue/groups` and the switch / bulk answers (design 2026-11-22). */
const GroupBase = z.object({
  slug: z.string(),
  name: z.string(),
  hidden: z.boolean(),
  hiddenReason: z.string().nullable(),
  version: z.number().int(),
  products: z.number().int(),
  liveProducts: z.number().int(),
  missingMrpPacks: z.number().int(),
});
export const AdminGroups = z.object({
  brands: z.array(GroupBase.extend({ ranges: z.array(GroupBase.extend({ nameHi: z.string().nullable() })) })),
});
export type AdminGroupsDto = z.infer<typeof AdminGroups>;
export type AdminBrandGroup = AdminGroupsDto['brands'][number];
export type AdminRangeGroup = AdminBrandGroup['ranges'][number];
const RunCounts = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  skipped: z.number().int(),
});
export const AdminImportStatus = z.object({
  run: z
    .object({
      at: z.string(),
      brands: z.record(z.string(), RunCounts),
      reasons: z.record(z.string(), z.number().int()),
      totals: RunCounts.extend({ products: z.number().int() }),
    })
    .nullable(),
});
export const AdminGroupSwitched = z.object({
  version: z.number().int(),
  hidden: z.boolean(),
  hiddenReason: z.string().nullable(),
  productsAffected: z.number().int(),
});
export const AdminBulkStatusResult = z.object({
  changed: z.array(z.string()),
  skipped: z.array(z.object({ slug: z.string(), reason: z.string() })),
});
export const AdminBulkMrpResult = z.object({
  updated: z.array(z.string()),
  skipped: z.array(z.object({ sku: z.string(), reason: z.string() })),
});
