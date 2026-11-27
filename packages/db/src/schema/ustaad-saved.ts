/**
 * Saved beyond posts (spec 23 § 5 Saved, § 6 data model; design 2026-11-28-mechanic-network-saved-design.md).
 * Posts keep `ustaad_saves` (counters and ranking read it); questions, answers, jobs and lessons are rows here. A
 * member's own named collections hold any saved kind. Targets are polymorphic (`kind` + `target_id`, no FK): every
 * read joins the live row and leaves out what the member may no longer see, and an unsave removes the item from the
 * member's collections in the same transaction. Private to the member; the API is the only reader (RLS on, no grants).
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  USTAAD_SAVE_COLLECTION_NAME_MAX,
  USTAAD_SAVE_ITEM_KINDS,
  USTAAD_SAVE_KINDS,
} from '@mechdost/shared/ustaad/saved';
import { createdAt, id, updatedAt, version } from './_common';
import { oneOf } from './ustaad-common';
import { ustaadMembers } from './ustaad-members';

const owner = () =>
  uuid()
    .notNull()
    .references(() => ustaadMembers.id, { onDelete: 'cascade' });

export const ustaadSavedItems = pgTable(
  'ustaad_saved_items',
  {
    memberId: owner(),
    kind: text().notNull(),
    targetId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.kind, t.targetId] }),
    index().on(t.memberId, t.createdAt.desc()),
    check('ustaad_saved_items_kind_valid', oneOf(t.kind, USTAAD_SAVE_ITEM_KINDS)),
  ],
);

export const ustaadSaveCollections = pgTable(
  'ustaad_save_collections',
  {
    id: id(),
    memberId: owner(),
    name: text().notNull(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ustaad_save_collections_member_name_uq').on(t.memberId, sql`lower(${t.name})`),
    check(
      'ustaad_save_collections_name_len',
      sql`char_length(btrim(${t.name})) between 1 and ${sql.raw(String(USTAAD_SAVE_COLLECTION_NAME_MAX))}`,
    ),
  ],
);

export const ustaadSaveCollectionItems = pgTable(
  'ustaad_save_collection_items',
  {
    collectionId: uuid()
      .notNull()
      .references(() => ustaadSaveCollections.id, { onDelete: 'cascade' }),
    memberId: owner(),
    kind: text().notNull(),
    targetId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.kind, t.targetId] }),
    index().on(t.memberId, t.kind, t.targetId),
    check('ustaad_save_collection_items_kind_valid', oneOf(t.kind, USTAAD_SAVE_KINDS)),
  ],
);
