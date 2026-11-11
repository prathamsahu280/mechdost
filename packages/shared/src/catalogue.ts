import { z } from 'zod';

/**
 * Catalogue response DTOs (spec 02): the single definition used by the API (OpenAPI names are added there) and
 * by the web, which parses every response with them. Money is integer paise; texts arrive already localised
 * (Hindi with the English fallback, hard rule 10).
 */
export const CATALOGUE_LOCALES = ['en', 'hi'] as const;

/** Product and category slugs as the API accepts them (anything else can never exist). */
export const CATALOGUE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;

export const CatalogueOfferSchema = z.object({
  pricePaise: z.number().int(),
  mrpPaise: z.number().int(),
  shippingPaise: z.number().int().nullable(),
  leadDays: z.number().int().nullable(),
});

export const CataloguePhotoSchema = z.object({
  path: z.string(),
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  blurhash: z.string().nullable(),
});

export const CataloguePlaceSchema = z.object({
  cityCode: z.string(),
  pincode: z.string().nullable(),
  pincodeKnown: z.boolean().nullable(),
});

const cardFields = {
  slug: z.string(),
  name: z.string(),
  brand: z.object({ slug: z.string(), name: z.string() }),
  category: z.object({ slug: z.string(), name: z.string() }),
  specSummary: z.string().nullable(),
  highlights: z.array(z.string()),
  rating: z.object({ avg: z.number(), count: z.number().int() }).nullable(),
};

export const CatalogueCardSchema = z.object({
  ...cardFields,
  offer: CatalogueOfferSchema.nullable(),
  photo: CataloguePhotoSchema.nullable(),
});

export const CataloguePageSchema = z.object({
  place: CataloguePlaceSchema,
  items: z.array(CatalogueCardSchema),
  nextCursor: z.string().nullable(),
});

export const CatalogueProductSchema = z.object({
  ...cardFields,
  description: z.string().nullable(),
  compatibility: z.string().nullable(),
  spec: z.record(z.string(), z.unknown()),
  countryOfOrigin: z.string(),
  warranty: z.string().nullable(),
  gstRateBp: z.number().int(),
  partNumbers: z.array(z.object({ kind: z.string(), value: z.string() })),
  photos: z.array(CataloguePhotoSchema),
  variants: z.array(
    z.object({
      sku: z.string(),
      options: z.record(z.string(), z.unknown()),
      mrpPaise: z.number().int(),
      offer: CatalogueOfferSchema.extend({ seller: z.string() }).nullable(),
    }),
  ),
  place: CataloguePlaceSchema,
});

export const CatalogueCategorySchema = z.object({
  slug: z.string(),
  parentSlug: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  liveProducts: z.number().int(),
});

export type CatalogueOffer = z.infer<typeof CatalogueOfferSchema>;
export type CataloguePhoto = z.infer<typeof CataloguePhotoSchema>;
export type CatalogueCard = z.infer<typeof CatalogueCardSchema>;
export type CataloguePage = z.infer<typeof CataloguePageSchema>;
export type CatalogueProduct = z.infer<typeof CatalogueProductSchema>;
export type CatalogueCategory = z.infer<typeof CatalogueCategorySchema>;
