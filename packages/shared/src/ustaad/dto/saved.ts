/**
 * Saved items and collections (spec 23 § 5 Saved; design docs/superpowers/specs/2026-11-28-mechanic-network-saved-design.md).
 * Posts keep their own `…/posts/{id}/save` routes; these DTOs cover every kind, the collections and the Saved page.
 */
import { z } from 'zod';
import { USTAAD_SAVE_COLLECTION_NAME_MAX, USTAAD_SAVE_ITEM_KINDS, USTAAD_SAVE_KINDS } from '../saved';

export const SaveKindDto = z.enum(USTAAD_SAVE_KINDS);
export const SaveItemKindDto = z.enum(USTAAD_SAVE_ITEM_KINDS);

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const NAME_FORBIDDEN = /[\u0000-\u001f\u007f<>]/;

/** A collection name: trimmed, 1–40 characters, no control characters or angle brackets. */
export const CollectionNameDto = z
  .string()
  .trim()
  .min(1)
  .max(USTAAD_SAVE_COLLECTION_NAME_MAX)
  .refine((v) => !NAME_FORBIDDEN.test(v), 'NAME_INVALID');

export const SaveTargetDto = z.strictObject({ kind: SaveKindDto, id: z.uuid() });
export type SaveTarget = z.infer<typeof SaveTargetDto>;

export const SavedQueryDto = z.strictObject({
  kind: SaveKindDto.optional(),
  collectionId: z.uuid().optional(),
  q: z.string().trim().min(1).max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SavedQuery = z.infer<typeof SavedQueryDto>;

export const SavedItemDto = z.object({
  kind: SaveKindDto,
  id: z.uuid(),
  savedAt: z.string(),
  /** Up to 160 characters of the item's own words (member text as written; a lesson's English title). */
  text: z.string(),
  /** A lesson's Hindi title; null for member-written kinds. */
  textHi: z.string().nullable(),
  /** Public code: the question's `UQ-…` (also for an answer), the job's `UJ-…`; null for posts and lessons. */
  code: z.string().nullable(),
  collectionIds: z.array(z.uuid()),
});
export type SavedItem = z.infer<typeof SavedItemDto>;

export const SavedPageDto = z.object({ items: z.array(SavedItemDto), nextCursor: z.string().nullable() });
export type SavedPage = z.infer<typeof SavedPageDto>;

export const SaveCollectionDto = z.object({
  id: z.uuid(),
  name: z.string(),
  count: z.number().int(),
  version: z.number().int(),
});
export type SaveCollection = z.infer<typeof SaveCollectionDto>;

export const SavedSummaryDto = z.object({
  total: z.number().int(),
  counts: z.record(SaveKindDto, z.number().int()),
  collections: z.array(SaveCollectionDto),
});
export type SavedSummary = z.infer<typeof SavedSummaryDto>;

/** The 204 answers (collection changes): no body. */
export const NoContentDto = z.null();

export const SaveStateDto = z.object({ saved: z.boolean() });

export const CreateCollectionDto = z.strictObject({ name: CollectionNameDto });
export const RenameCollectionDto = z.strictObject({
  name: CollectionNameDto,
  version: z.number().int().min(1),
});
export const CollectionItemDto = SaveTargetDto;
