import { sql, type SQL } from 'drizzle-orm';
import { productVisible } from './visibility';
import {
  SEARCH_VOCAB_KINDS,
  SEARCH_VOCAB_LOCALES,
  tokenise,
  type SearchVocabKind,
  type SearchVocabLocale,
} from '@mechdost/shared/search';
import {
  SUGGEST_KINDS,
  SUGGEST_MAX,
  SUGGEST_QUERY_MAX,
  SUGGEST_QUERY_MIN,
} from '@mechdost/shared/search-api';
import { VEHICLE_SEGMENTS } from '@mechdost/shared/vehicle-segments';
import { VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { auditLog } from '../schema';
import { listCatalogue, type CatalogueLocale } from './catalogue';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { invalidateSearchVocab, parseCatalogueQuery } from './search-sql';
import { rowsOf } from './sql-rows';
import type { Tx } from './orders';

/**
 * Suggestions, "did you mean" and the synonym editor (spec 02 "Smart search", design 2026-11-22).
 * The query-to-SQL part lives in `search-sql.ts`; the catalogue listing imports that, this file imports the listing.
 */

export { SUGGEST_MAX, SUGGEST_QUERY_MAX, SUGGEST_QUERY_MIN, SUGGEST_KINDS };
export type SuggestKind = (typeof SUGGEST_KINDS)[number];

export interface SuggestItem {
  kind: SuggestKind;
  /** The text to show (localised for categories and products). */
  label: string;
  /** Slug of the brand, range, category or product: the web builds the link from kind + slug. */
  slug: string;
  /** Second line: the brand of a product, the parent brand of a range. */
  subtitle: string | null;
  photo: { path: string; alt: string; width: number; height: number } | null;
  /** A product suggestion found by a size ("90/90-12"): the size that matched, so the list can say so. */
  matchedSize: { label: string; sku: string } | null;
}

/**
 * Seam for the brand/range work (design 2026-11-22 items 1-2): returns up to `limit` range suggestions for the
 * words typed. Not set until `product_ranges` exists; the coordinator passes it from the route.
 */
export type RangeSuggester = (
  db: Tx,
  q: string,
  limit: number,
  locale: CatalogueLocale,
) => Promise<SuggestItem[]>;

/** `%`, `_` and `\` have a meaning in LIKE patterns. */
const likeEscape = (q: string) => q.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * A brand is suggested only while at least one of its products is visible to customers (the one visibility rule,
 * `visibility.ts`: live, brand and range not hidden, category and parent neither hidden nor archived).
 */
const brandVisible = (brand: SQL): SQL =>
  sql`exists (select 1 from products pb where pb.brand_id = ${brand} and ${productVisible('pb')})`;

/**
 * Up to 8 suggestions for what is being typed: brands (≤ 2), ranges (≤ 2, when the seam is wired), categories
 * (≤ 2), then the best products to fill the rest. Same understanding and ranking as the listing (the products come
 * from it), so a suggestion never leads to an empty page.
 */
export async function suggestCatalogue(
  db: Tx,
  input: { q: string; locale: CatalogueLocale; cityCode: string; ranges?: RangeSuggester },
): Promise<SuggestItem[]> {
  const q = input.q.trim().slice(0, SUGGEST_QUERY_MAX);
  if (Array.from(q).length < SUGGEST_QUERY_MIN) return [];
  const parsed = await parseCatalogueQuery(db, q);
  const word = tokenise(q).join(' ');
  if (word === '') return [];
  const prefix = `${likeEscape(word)}%`;
  const contains = `%${likeEscape(word)}%`;
  const out: SuggestItem[] = [];

  const brands = rowsOf<{ slug: string; name: string }>(
    await db.execute(sql`select b.slug, b.name from brands b
      where ${brandVisible(sql`b.id`)} and (lower(b.name) like ${prefix} or ${word} <% b.name)
      order by (lower(b.name) like ${prefix}) desc, word_similarity(${word}, b.name) desc, b.name limit 2`),
  );
  for (const b of brands)
    out.push({ kind: 'brand', label: b.name, slug: b.slug, subtitle: null, photo: null, matchedSize: null });

  if (input.ranges) out.push(...(await input.ranges(db, q, 2, input.locale)).slice(0, 2));

  const categories = rowsOf<{ slug: string; name: string; name_hi: string | null }>(
    await db.execute(sql`select c.slug, c.name, c.name_hi from categories c
      where c.archived_at is null and not c.hidden
        and (lower(c.name) like ${contains} or lower(coalesce(c.name_hi, '')) like ${contains}
          ${parsed.categorySlug ? sql`or c.slug = ${parsed.categorySlug}` : sql``})
      order by (lower(c.name) like ${prefix}) desc, c.sort, c.name limit 2`),
  );
  for (const c of categories)
    out.push({
      kind: 'category',
      label: input.locale === 'hi' && c.name_hi ? c.name_hi : c.name,
      slug: c.slug,
      subtitle: null,
      photo: null,
      matchedSize: null,
    });

  const room = SUGGEST_MAX - out.length;
  if (room > 0) {
    const page = await listCatalogue(db, {
      cityCode: input.cityCode,
      q,
      limit: room,
      sort: 'relevance',
      locale: input.locale,
    });
    for (const card of page.items)
      out.push({
        kind: 'product',
        label: card.name,
        slug: card.slug,
        subtitle: card.brand.name,
        matchedSize: card.matchedSizes[0] ?? null,
        photo: card.photo
          ? { path: card.photo.path, alt: card.photo.alt, width: card.photo.width, height: card.photo.height }
          : null,
      });
  }
  return out.slice(0, SUGGEST_MAX);
}

/**
 * "Did you mean" for a search that found nothing: the closest live brand, category or product name by trigram
 * similarity (≥ 0.35), or null. Runs only on the zero-result path (a few thousand rows, no index needed).
 */
export async function didYouMeanCatalogue(db: Tx, q: string): Promise<string | null> {
  const word = tokenise(q).join(' ').slice(0, SUGGEST_QUERY_MAX);
  if (Array.from(word).length < 3) return null;
  const rows = rowsOf<{ name: string; score: number }>(
    await db.execute(sql`
      select name, score from (
        select b.name as name, similarity(lower(b.name), ${word}) as score from brands b
          where ${brandVisible(sql`b.id`)}
        union all
        select c.name, similarity(lower(c.name), ${word}) from categories c where c.archived_at is null and not c.hidden
        union all
        select p.name, word_similarity(${word}, lower(p.name)) * 0.85 from products p
          where ${productVisible('p')}
      ) t where score >= 0.35 and lower(name) <> ${word} order by score desc, length(name) limit 1`),
  );
  return rows[0]?.name ?? null;
}

// ---- the synonym editor (Admin → Catalogue → Search synonyms; `products:write`, audited) -----------------

export interface SearchSynonymRow {
  id: string;
  term: string;
  locale: SearchVocabLocale;
  kind: SearchVocabKind;
  expandsTo: string[];
  active: boolean;
  version: number;
}

export async function listSearchSynonyms(db: Tx): Promise<SearchSynonymRow[]> {
  return rowsOf<{
    id: string;
    term: string;
    locale: SearchVocabLocale;
    kind: SearchVocabKind;
    expands_to: string[];
    active: boolean;
    version: number;
  }>(
    await db.execute(
      sql`select id, term, locale, kind, expands_to, active, version from search_synonyms order by kind, term`,
    ),
  ).map((r) => ({
    id: r.id,
    term: r.term,
    locale: r.locale,
    kind: r.kind,
    expandsTo: r.expands_to,
    active: r.active,
    version: r.version,
  }));
}

/** NFKC, lower case, single spaces: the form terms are stored and matched in. */
export function normaliseTerm(term: string): string {
  return tokenise(term).join(' ');
}

async function checkExpansion(
  tx: Tx,
  kind: SearchVocabKind,
  expandsTo: readonly string[],
): Promise<string[]> {
  const list = [...new Set(expandsTo.map(normaliseTerm).filter(Boolean))];
  if (list.length < 1 || list.length > 10) throw new ValidationError('Give 1 to 10 words', 'SYNONYM_EXPANDS');
  if (kind === 'category') {
    const found = rowsOf<{ n: number }>(
      await tx.execute(sql`select count(*)::int as n from categories where slug = ${list[0] ?? ''}`),
    );
    if (found[0]?.n !== 1) throw new ValidationError('Unknown category slug', 'SYNONYM_CATEGORY');
    return [list[0] ?? ''];
  }
  if (kind === 'segment') {
    const first = expandsTo[0]?.trim() ?? '';
    if (!(VEHICLE_SEGMENTS as readonly string[]).includes(first))
      throw new ValidationError('Unknown vehicle segment', 'SYNONYM_SEGMENT');
    return [first];
  }
  if (kind === 'vehicle') {
    const first = expandsTo[0]?.trim() ?? '';
    const type = (VEHICLE_TYPES as readonly string[]).includes(first);
    return type ? [first] : [list[0] ?? ''];
  }
  return list;
}

export async function addSearchSynonym(
  db: Tx,
  input: {
    term: string;
    locale: SearchVocabLocale;
    kind: SearchVocabKind;
    expandsTo: readonly string[];
    staffUserId: string;
  },
): Promise<SearchSynonymRow> {
  const term = normaliseTerm(input.term);
  if (!term || term.length > 60) throw new ValidationError('Term is 1 to 60 characters', 'SYNONYM_TERM');
  if (!(SEARCH_VOCAB_KINDS as readonly string[]).includes(input.kind))
    throw new ValidationError('Unknown kind', 'SYNONYM_KIND');
  if (!(SEARCH_VOCAB_LOCALES as readonly string[]).includes(input.locale))
    throw new ValidationError('Unknown language', 'SYNONYM_LOCALE');
  const row = await db.transaction(async (tx) => {
    const expandsTo = await checkExpansion(tx, input.kind, input.expandsTo);
    const inserted = rowsOf<{ id: string; version: number }>(
      await tx.execute(sql`insert into search_synonyms (term, locale, kind, expands_to, created_by)
        values (${term}, ${input.locale}, ${input.kind}, array[${sql.join(
          expandsTo.map((x) => sql`${x}`),
          sql`, `,
        )}]::text[], ${input.staffUserId})
        on conflict (kind, term) do nothing returning id, version`),
    );
    const created = inserted[0];
    if (!created) throw new ConflictError('That word is already in the list', 'SYNONYM_EXISTS');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'search_synonym.created',
      entity: 'search_synonym',
      entityId: created.id,
      before: null,
      after: { term, kind: input.kind, locale: input.locale, expandsTo },
    });
    return {
      id: created.id,
      term,
      locale: input.locale,
      kind: input.kind,
      expandsTo,
      active: true,
      version: created.version,
    } satisfies SearchSynonymRow;
  });
  invalidateSearchVocab();
  return row;
}

/** Switch one entry on or off (history kept). Optimistic `version`; audited. */
export async function setSearchSynonymActive(
  db: Tx,
  input: { id: string; expectedVersion: number; active: boolean; staffUserId: string },
): Promise<{ version: number; active: boolean }> {
  const result = await db.transaction(async (tx) => {
    const rows = rowsOf<{ version: number }>(
      await tx.execute(sql`update search_synonyms set active = ${input.active}
        where id = ${input.id} and version = ${input.expectedVersion} returning version`),
    );
    const row = rows[0];
    if (!row) {
      const exists = rowsOf<{ id: string }>(
        await tx.execute(sql`select id from search_synonyms where id = ${input.id}`),
      );
      if (exists.length === 0) throw new NotFoundError('Search synonym not found');
      throw new ConflictError('Someone else changed this word; reload', 'STALE_SYNONYM');
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: input.active ? 'search_synonym.enabled' : 'search_synonym.disabled',
      entity: 'search_synonym',
      entityId: input.id,
      before: { active: !input.active },
      after: { active: input.active },
    });
    return { version: row.version, active: input.active };
  });
  invalidateSearchVocab();
  return result;
}
