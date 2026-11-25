import { z } from 'zod';
import { VEHICLE_SEGMENTS } from './vehicle-segments';

/**
 * Vehicle-segment DTOs (design 2026-11-25): the public listing (card tags, facet counts) and the admin console.
 * Texts arrive localised on the public side; the admin sees both languages.
 */
export const SegmentCodeSchema = z.enum(VEHICLE_SEGMENTS);

/** A segment on a product card or page: the code, and its name in the page language. */
export const SegmentRefSchema = z.object({ code: SegmentCodeSchema, name: z.string() });

/** One chip of the shop: the segment, its name and how many products match the current search and category. */
export const SegmentFacetSchema = SegmentRefSchema.extend({ count: z.number().int().min(0) });

export const SegmentFacetsSchema = z.object({ segments: z.array(SegmentFacetSchema) });

/** Comma-separated codes of the `segment` query parameter; unknown codes are an error, not silently dropped. */
export const SegmentListParam = z
  .string()
  .trim()
  .max(200)
  .transform((v) => v.split(',').filter((x) => x !== ''))
  .pipe(z.array(SegmentCodeSchema).max(VEHICLE_SEGMENTS.length));

export const AdminSegmentSchema = z.object({
  code: SegmentCodeSchema,
  nameEn: z.string(),
  nameHi: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionHi: z.string().nullable(),
  sort: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
  /** Live products tagged with it (staff see what switching it off hides). */
  products: z.number().int(),
});

export const AdminSegmentsSchema = z.object({ segments: z.array(AdminSegmentSchema) });

export const AdminSegmentPatchSchema = z
  .object({
    version: z.number().int().min(1),
    nameEn: z.string().trim().min(1).max(60).optional(),
    nameHi: z.string().trim().min(1).max(60).optional(),
    descriptionEn: z.string().trim().max(120).nullable().optional(),
    descriptionHi: z.string().trim().max(120).nullable().optional(),
    sort: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export type SegmentRef = z.infer<typeof SegmentRefSchema>;
export type SegmentFacet = z.infer<typeof SegmentFacetSchema>;
export type AdminSegment = z.infer<typeof AdminSegmentSchema>;
