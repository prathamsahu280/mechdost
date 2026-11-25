import { sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_SEARCH_VOCAB,
  SEARCH_WEIGHTS as W,
  compactAlnum,
  matchWords,
  parseSearchQuery,
  tyreSizeKeys,
  type ParsedQuery,
  type SearchVocabEntry,
  type SearchVocabKind,
  type SearchVocabLocale,
} from '@mechdost/shared/search';
import { rowsOf } from './sql-rows';
import type { Tx } from './orders';

/**
 * The SQL of the smart search (spec 02 "Smart search", design 2026-11-22). Shared by the catalogue listing, the
 * suggestions and the admin analytics ("does any product match this search?"). Aliases the caller must provide:
 * `p` products, `b` brands, `c` categories.
 *
 * Match: every query word must be found — in the English or Hindi text vector (the word or any synonym of it, the
 * last word as a prefix while typing) or as a typo of the product or brand name (`<%` word similarity, GIN trigram
 * indexes) — or a part number / SKU must match exactly. With no words left (a bare "900ml", "bike") the parsed
 * attributes and vehicle intent are the filter instead.
 * Rank: the `SEARCH_WEIGHTS` table (viscosity, pack size, Ah, voltage, tyre size, part number, vehicle and category
 * intent, in stock) on top of `ts_rank` and the best name similarity.
 */

/** Words that mean something to the vector get these lexemes; everything else is dropped (injection-safe by shape). */
const LEXEME = /^[\p{L}\p{M}\p{N}]+$/u;

function tsqueryText(
  words: readonly string[],
  expansions: Readonly<Record<string, string[]>>,
  prefixLast: boolean,
): string {
  return words
    .map((w, i) => {
      const group = [w, ...(expansions[w] ?? [])].filter((x) => LEXEME.test(x));
      const suffix = prefixLast && i === words.length - 1 ? ':*' : '';
      return `(${group.map((g) => `'${g}'${suffix}`).join(' | ')})`;
    })
    .join(' & ');
}

const likeCompact = (value: string): SQL => sql`p.search_compact like ${`%${compactAlnum(value)}%`}`;

function partMatch(part: string, raw: string): SQL {
  return sql`exists (select 1 from product_variants v2 left join part_numbers pn on pn.variant_id = v2.id
    where v2.product_id = p.id and (pn.normalised = ${part} or v2.sku = ${raw.trim().toUpperCase()}))`;
}

/**
 * "This size of the product is what was searched" for the variant alias `v` (spec 02 "Search by size"): a tyre
 * size against `size_compact` (trigram index, every spelling of the size) or the pack size against `net_qty` /
 * `net_unit`. Null when the query names no size. Only active variants count.
 */
export function sizeMatchCondition(parsed: ParsedQuery, v: string): SQL | null {
  const col = sql.raw(`${v}.size_compact`);
  const own = sql.raw(v);
  const forms: SQL[] = [];
  if (parsed.tyreSize)
    forms.push(
      sql`(${sql.join(
        tyreSizeKeys(parsed.tyreSize).map((k) => sql`${col} like ${`%${k}%`}`),
        sql` or `,
      )})`,
    );
  if (parsed.netQty)
    forms.push(sql`(${own}.net_qty = ${parsed.netQty.qty} and ${own}.net_unit = ${parsed.netQty.unit})`);
  return forms.length > 0 ? sql`(${own}.status = 'active' and (${sql.join(forms, sql` or `)}))` : null;
}

export interface SearchSql {
  /** The WHERE condition (a whole expression). */
  match: SQL;
  /** The relevance number; `hasOffer` is the caller's "this row has a buyable price" condition. */
  rank: (hasOffer: SQL) => SQL;
  /** True when the query had nothing the search can use (punctuation only). */
  empty: boolean;
  parsed: ParsedQuery;
}

export function buildSearchSql(parsed: ParsedQuery): SearchSql {
  const words = matchWords(parsed);
  const text = words.join(' ');

  const parts = parsed.partNumbers.map((n) => partMatch(n, parsed.raw));
  const anyPart = parts.length > 0 ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;

  const attrs: { cond: SQL; weight: number }[] = [];
  if (parsed.viscosity) attrs.push({ cond: likeCompact(parsed.viscosity), weight: W.viscosity });
  if (parsed.netQty)
    attrs.push({
      cond: sql`exists (select 1 from product_variants v3 where v3.product_id = p.id and v3.status = 'active'
        and v3.net_qty = ${parsed.netQty.qty} and v3.net_unit = ${parsed.netQty.unit})`,
      weight: W.packSize,
    });
  if (parsed.ah !== null) attrs.push({ cond: likeCompact(`${parsed.ah}AH`), weight: W.batteryAh });
  if (parsed.voltage !== null) attrs.push({ cond: likeCompact(`${parsed.voltage}V`), weight: W.voltage });
  if (parsed.tyreSize) {
    // The name may carry the size, or any active size (variant) of the product may be it.
    const own = sql.join(
      tyreSizeKeys(parsed.tyreSize).map((k) => sql`p.search_compact like ${`%${k}%`}`),
      sql` or `,
    );
    const tyre = sizeMatchCondition({ ...parsed, netQty: null }, 'tv');
    attrs.push({
      cond: sql`(${own} or exists (select 1 from product_variants tv where tv.product_id = p.id and ${tyre ?? sql`false`}))`,
      weight: W.tyreSize,
    });
  }

  const vehicle = parsed.vehicleType ? sql`p.vehicle_types @> array[${parsed.vehicleType}]::text[]` : null;
  const segment = parsed.segment
    ? sql`exists (select 1 from product_vehicle_segments sg where sg.product_id = p.id and sg.segment_code = ${parsed.segment})`
    : null;
  const category = parsed.categorySlug
    ? sql`(c.slug = ${parsed.categorySlug} or c.parent_id = (select id from categories where slug = ${parsed.categorySlug}))`
    : null;

  let match: SQL;
  let textRank: SQL = sql`0`;
  if (words.length > 0) {
    const tsText = tsqueryText(words, parsed.expansions, true);
    const tsq = sql`(to_tsquery('english', ${tsText}) || to_tsquery('simple', ${tsText}))`;
    const perWord = words.map((w, i) => {
      const lex = tsqueryText([w], parsed.expansions, i === words.length - 1);
      const wq = sql`(to_tsquery('english', ${lex}) || to_tsquery('simple', ${lex}))`;
      const typo = Array.from(w).length >= 4 ? sql` or ${w} <% p.name or ${w} <% b.name` : sql``;
      const byCategory = category && parsed.categoryWords.includes(w) ? sql` or ${category}` : sql``;
      const bySegment = segment && parsed.segmentWords.includes(w) ? sql` or ${segment}` : sql``;
      return sql`(p.search_vector @@ ${wq}${typo}${byCategory}${bySegment})`;
    });
    match = sql`((${sql.join(perWord, sql` and `)}) or ${anyPart})`;
    textRank = sql`(coalesce(ts_rank(p.search_vector, ${tsq}), 0)
      + greatest(word_similarity(${text}, p.name), word_similarity(${text}, b.name)))`;
  } else {
    const filters = [
      ...attrs.map((a) => a.cond),
      ...(vehicle ? [vehicle] : []),
      ...(segment ? [segment] : []),
    ];
    match =
      filters.length > 0
        ? sql`(${sql.join(filters, sql` and `)}${parts.length > 0 ? sql` or ${anyPart}` : sql``})`
        : parts.length > 0
          ? anyPart
          : sql`false`;
  }

  const boosts = (hasOffer: SQL): SQL[] => [
    ...attrs.map((a) => sql`(case when ${a.cond} then ${a.weight}::float8 else 0 end)`),
    ...(parts.length > 0 ? [sql`(case when ${anyPart} then ${W.partNumber}::float8 else 0 end)`] : []),
    ...(vehicle ? [sql`(case when ${vehicle} then ${W.vehicleIntent}::float8 else 0 end)`] : []),
    ...(segment ? [sql`(case when ${segment} then ${W.segmentIntent}::float8 else 0 end)`] : []),
    ...(category ? [sql`(case when ${category} then ${W.categoryIntent}::float8 else 0 end)`] : []),
    sql`(case when ${hasOffer} then ${W.inStock}::float8 else 0 end)`,
  ];
  return {
    match,
    rank: (hasOffer) => sql`(${textRank} + ${sql.join(boosts(hasOffer), sql` + `)})::float8`,
    empty: words.length === 0 && attrs.length === 0 && parts.length === 0 && !vehicle && !segment,
    parsed,
  };
}

// ---- vocabulary from the admin-editable table, cached for a short time per instance -------------------------

const VOCAB_TTL_MS = 30_000;
let vocabCache: { at: number; vocab: SearchVocabEntry[] } | null = null;

/** Drop the cached vocabulary (after an admin edit, and in tests). */
export function invalidateSearchVocab(): void {
  vocabCache = null;
}

/** The active vocabulary rows; the built-in list when the table is empty. */
export async function loadSearchVocab(db: Tx, now: number = Date.now()): Promise<SearchVocabEntry[]> {
  if (vocabCache && now - vocabCache.at < VOCAB_TTL_MS) return vocabCache.vocab;
  const rows = rowsOf<{
    term: string;
    locale: SearchVocabLocale;
    kind: SearchVocabKind;
    expands_to: string[];
  }>(await db.execute(sql`select term, locale, kind, expands_to from search_synonyms where active`));
  const vocab =
    rows.length > 0
      ? rows.map((r) => ({ term: r.term, locale: r.locale, kind: r.kind, expandsTo: r.expands_to }))
      : [...DEFAULT_SEARCH_VOCAB];
  vocabCache = { at: now, vocab };
  return vocab;
}

/** Parse `q` with the live vocabulary. */
export async function parseCatalogueQuery(db: Tx, q: string): Promise<ParsedQuery> {
  return parseSearchQuery(q, await loadSearchVocab(db));
}
