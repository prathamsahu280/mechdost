import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { SEARCH_VOCAB_KINDS, SEARCH_VOCAB_LOCALES } from '@mechdost/shared/search';
import { createdAt, id, updatedAt, version } from './_common';
import { users } from './identity';

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Search vocabulary (spec 02 "Smart search", design 2026-11-22): Hinglish/Hindi synonyms, category intent and
 * vehicle intent words, edited by staff (`catalogue:write`, audited). Seeded from `DEFAULT_SEARCH_VOCAB` by
 * migration 0080. `expands_to` per kind: synonym = the words it also means; category = [category slug];
 * vehicle = ['2W'|'3W'|'4W'] or a plain word. Disabled rows are kept (history) and ignored by the parser.
 */
export const searchSynonyms = pgTable(
  'search_synonyms',
  {
    id: id(),
    /** Lower-case words (any script); a vehicle or category term may be a short phrase. */
    term: text().notNull(),
    locale: text().notNull(),
    kind: text().notNull(),
    expandsTo: text().array().notNull(),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('search_synonyms_kind_term_idx').on(t.kind, t.term),
    check('search_synonyms_kind_valid', sql`${t.kind} in (${inList(SEARCH_VOCAB_KINDS)})`),
    check('search_synonyms_locale_valid', sql`${t.locale} in (${inList(SEARCH_VOCAB_LOCALES)})`),
    check(
      'search_synonyms_term_shape',
      sql`char_length(${t.term}) between 1 and 60 and ${t.term} = lower(${t.term})`,
    ),
    check('search_synonyms_expands', sql`cardinality(${t.expandsTo}) between 1 and 10`),
  ],
);
