import { and, asc, eq, sql } from 'drizzle-orm';
import {
  RECO_MAX,
  RECO_SIMILAR_MAX,
  type RecoAlgo,
  type RecoSurface,
  RECO_MIN_SUPPORT,
  RECO_PAIRS_PER_PRODUCT,
  RECO_RULE_CANDIDATES,
  RECO_RULES_MAX,
} from '@mechdost/shared/recommendation-limits';
import type {
  Recommendation,
  RecoRule,
  RecoRuleInput,
  RecoSuggestKind,
} from '@mechdost/shared/recommendations';
import { auditLog, categories, recommendationRules } from '../schema';
import { BUYABLE_OFFER, listCatalogue, type CatalogueLocale } from './catalogue';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { productVisible } from './visibility';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Recommendations (spec 11, design 2026-11-15 item 4). Rules are admin-written ("oil -> oil filter", both languages);
 * co-purchase counts come from delivered orders, rebuilt nightly by the worker, ids and counts only. Suggestions go
 * through the same card query as the catalogue (`availableOnly`), so nothing that cannot be bought today is offered.
 */

// ── Admin rules ────────────────────────────────────────────────────────────────────────────────────────────

type Ref = { id: string; slug: string; name: string; nameHi: string | null } | null;

interface RuleRow {
  id: string;
  label: string;
  label_hi: string;
  priority: number;
  active: boolean;
  version: number;
  updated_at: Date | string;
  suggest_kind: RecoSuggestKind;
  trigger_category: Ref;
  trigger_product: Ref;
  suggest_category: Ref;
  suggest_product: Ref;
}

// A trigger or suggestion is a category or a product (phase 3); each side is read as a JSON object or null.
const RULE_SELECT = sql`
  select r.id, r.label, r.label_hi, r.priority, r.active, r.version, r.updated_at, r.suggest_kind,
    case when tc.id is null then null else json_build_object('id', tc.id, 'slug', tc.slug, 'name', tc.name, 'nameHi', tc.name_hi) end as trigger_category,
    case when tp.id is null then null else json_build_object('id', tp.id, 'slug', tp.slug, 'name', tp.name, 'nameHi', tp.name_hi) end as trigger_product,
    case when sc.id is null then null else json_build_object('id', sc.id, 'slug', sc.slug, 'name', sc.name, 'nameHi', sc.name_hi) end as suggest_category,
    case when sp.id is null then null else json_build_object('id', sp.id, 'slug', sp.slug, 'name', sp.name, 'nameHi', sp.name_hi) end as suggest_product
  from recommendation_rules r
  left join categories tc on tc.id = r.trigger_category_id
  left join products tp on tp.id = r.trigger_product_id
  left join categories sc on sc.id = r.suggest_category_id
  left join products sp on sp.id = r.suggest_product_id`;

const refOf = (v: Ref): Ref => (v ? { id: v.id, slug: v.slug, name: v.name, nameHi: v.nameHi } : null);

function toRule(r: RuleRow): RecoRule {
  return {
    id: r.id,
    triggerCategory: refOf(r.trigger_category),
    triggerProduct: refOf(r.trigger_product),
    suggestKind: r.suggest_kind,
    suggestCategory: refOf(r.suggest_category),
    suggestProduct: refOf(r.suggest_product),
    label: r.label,
    labelHi: r.label_hi,
    priority: num(r.priority),
    active: r.active,
    version: num(r.version),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

async function ruleById(tx: Tx, id: string): Promise<RecoRule> {
  const rows = rowsOf<RuleRow>(await tx.execute(sql`${RULE_SELECT} where r.id = ${id}::uuid`));
  const row = rows[0];
  if (!row) throw new NotFoundError('Rule not found');
  return toRule(row);
}

/** Every rule, first by priority (the order customers see), for the admin screen. */
export async function listRecoRules(tx: Tx): Promise<RecoRule[]> {
  const rows = rowsOf<RuleRow>(
    await tx.execute(
      sql`${RULE_SELECT} order by r.priority, coalesce(tc.name, tp.name), coalesce(sc.name, sp.name), r.id
        limit ${RECO_RULES_MAX}`,
    ),
  );
  return rows.map(toRule);
}

/** Categories the rule form offers: visible ones, flat, A to Z. */
export async function listRecoCategories(
  tx: Tx,
): Promise<{ id: string; slug: string; name: string; nameHi: string | null }[]> {
  return tx
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      nameHi: categories.nameHi,
    })
    .from(categories)
    .where(and(eq(categories.hidden, false), sql`${categories.archivedAt} is null`))
    .orderBy(asc(categories.name));
}

function mapRuleError(err: unknown): never {
  const code = pgCode(err);
  if (code === '23505') throw new ConflictError('That pair already has a rule', 'DUPLICATE_RULE');
  if (code === '23503')
    throw new ValidationError('That category or product does not exist', 'UNKNOWN_CATEGORY');
  if (code === '23514') throw new ValidationError('The rule is not valid', 'RULE_INVALID');
  throw err;
}

/** The table columns of a rule input; the side not chosen is written as null. */
function ruleColumns(i: RecoRuleInput) {
  return {
    triggerCategoryId: i.triggerCategoryId ?? null,
    triggerProductId: i.triggerProductId ?? null,
    suggestKind: i.suggestKind,
    suggestCategoryId: i.suggestKind === 'category' ? (i.suggestCategoryId ?? null) : null,
    suggestProductId: i.suggestKind === 'product' ? (i.suggestProductId ?? null) : null,
    label: i.label,
    labelHi: i.labelHi,
    priority: i.priority,
    active: i.active,
  };
}

/** What a rule connects, by slug, for the audit row. */
const auditSides = (r: RecoRule) => ({
  trigger: r.triggerCategory?.slug ?? r.triggerProduct?.slug ?? null,
  suggestKind: r.suggestKind,
  suggest: r.suggestCategory?.slug ?? r.suggestProduct?.slug ?? null,
});

export async function createRecoRule(
  db: Tx,
  input: { staffUserId: string; input: RecoRuleInput },
): Promise<RecoRule> {
  const i = input.input;
  const id = await db
    .transaction(async (tx) => {
      const [row] = await tx
        .insert(recommendationRules)
        .values({
          ...ruleColumns(i),
          createdBy: input.staffUserId,
        })
        .returning({ id: recommendationRules.id });
      if (!row) throw new Error('rule insert returned no row');
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'recommendation_rule.created',
        entity: 'recommendation_rule',
        entityId: row.id,
        after: i,
      });
      await recordServerEvent(tx, 'admin_reco_rule_saved', {
        userId: input.staffUserId,
        props: { ruleId: row.id, action: 'created', active: i.active },
      });
      return row.id;
    })
    .catch(mapRuleError);
  return ruleById(db, id);
}

export async function updateRecoRule(
  db: Tx,
  input: { ruleId: string; expectedVersion: number; staffUserId: string; input: RecoRuleInput },
): Promise<RecoRule> {
  const i = input.input;
  await db
    .transaction(async (tx) => {
      const before = await ruleById(tx, input.ruleId);
      const [row] = await tx
        .update(recommendationRules)
        .set({
          ...ruleColumns(i),
        })
        .where(
          and(
            eq(recommendationRules.id, input.ruleId),
            eq(recommendationRules.version, input.expectedVersion),
          ),
        )
        .returning({ id: recommendationRules.id });
      if (!row) throw new ConflictError('The rule changed meanwhile; reload it', 'STALE_RULE');
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'recommendation_rule.updated',
        entity: 'recommendation_rule',
        entityId: row.id,
        before: {
          ...auditSides(before),
          label: before.label,
          labelHi: before.labelHi,
          priority: before.priority,
          active: before.active,
        },
        after: i,
      });
      await recordServerEvent(tx, 'admin_reco_rule_saved', {
        userId: input.staffUserId,
        props: { ruleId: row.id, action: 'updated', active: i.active },
      });
    })
    .catch(mapRuleError);
  return ruleById(db, input.ruleId);
}

export async function deleteRecoRule(
  db: Tx,
  input: { ruleId: string; expectedVersion: number; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await ruleById(tx, input.ruleId);
    const gone = await tx
      .delete(recommendationRules)
      .where(
        and(eq(recommendationRules.id, input.ruleId), eq(recommendationRules.version, input.expectedVersion)),
      )
      .returning({ id: recommendationRules.id });
    if (gone.length === 0) throw new ConflictError('The rule changed meanwhile; reload it', 'STALE_RULE');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'recommendation_rule.deleted',
      entity: 'recommendation_rule',
      entityId: input.ruleId,
      before: {
        ...auditSides(before),
        label: before.label,
        priority: before.priority,
      },
    });
    await recordServerEvent(tx, 'admin_reco_rule_saved', {
      userId: input.staffUserId,
      props: { ruleId: input.ruleId, action: 'deleted', active: false },
    });
  });
}

// ── Nightly co-purchase counts ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilds `copurchase_pairs` from delivered orders: two products count as bought together when delivered parts of
 * one checkout (order group) held both; a pair needs `minSupport` different checkouts; the strongest
 * `RECO_PAIRS_PER_PRODUCT` per product are kept. Delete and insert run in one transaction (readers never see a half
 * table) and under an advisory lock (two workers, or a manual run, never overlap: the second returns `ran: false`).
 * No user id is read into the result, only products and counts, so the table can never identify a buyer.
 */
export async function recomputeCopurchase(
  db: Tx,
  opts: { minSupport?: number },
): Promise<{ ran: boolean; pairs: number }> {
  const min = Math.max(opts.minSupport ?? RECO_MIN_SUPPORT, 1);
  return db.transaction(async (tx) => {
    const lock = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('copurchase_recompute')) as ok`),
    )[0];
    if (!lock?.ok) return { ran: false, pairs: 0 };
    await tx.execute(sql`delete from copurchase_pairs`);
    const res = rowsOf<{ n: string | number }>(
      await tx.execute(sql`
        with bought as (
          select distinct o.group_id, v.product_id
          from orders o
          join order_items oi on oi.order_id = o.id
          join product_variants v on v.id = oi.variant_id
          where o.status = 'delivered'
        ), pairs as (
          select a.product_id as a_id, b.product_id as b_id, count(*)::int as c
          from bought a join bought b on b.group_id = a.group_id and b.product_id <> a.product_id
          group by a.product_id, b.product_id
          having count(*) >= ${min}
        ), ranked as (
          select a_id, b_id, c, row_number() over (partition by a_id order by c desc, b_id) as rn from pairs
        ), ins as (
          insert into copurchase_pairs (a_product_id, b_product_id, pair_count, computed_at)
          select a_id, b_id, c, now() from ranked where rn <= ${RECO_PAIRS_PER_PRODUCT}
          returning 1
        )
        select count(*) as n from ins`),
    );
    const pairs = num(res[0]?.n ?? 0);
    await recordServerEvent(tx, 'copurchase_computed', { props: { pairs } });
    return { ran: true, pairs };
  });
}

// ── Suggestions for a page ────────────────────────────────────────────────────────────────────────────────

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/** The visible products named by `slugs`, and the categories a rule may trigger on (their own and the parent). */
async function sourcesOf(
  db: Tx,
  slugs: readonly string[],
): Promise<{ sourceIds: string[]; triggerIds: string[] } | null> {
  if (slugs.length === 0) return null;
  const sources = rowsOf<{ id: string; category_id: string; parent_id: string | null }>(
    await db.execute(sql`
      select p.id, p.category_id, c.parent_id from products p join categories c on c.id = p.category_id
      where ${productVisible('p')} and p.slug in (${sql.join(
        slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`),
  );
  if (sources.length === 0) return null;
  return {
    sourceIds: sources.map((s) => s.id),
    triggerIds: [
      ...new Set(sources.flatMap((s) => (s.parent_id ? [s.category_id, s.parent_id] : [s.category_id]))),
    ],
  };
}

/**
 * "Goes well with" for the products a page is about (a product page: one; a cart: its lines). Admin rules first
 * (lower priority number first, then newest products), then what customers bought together; each product once, never
 * one of the asked-about products, only products with a buyable offer, at most `RECO_MAX`. Unknown slugs are ignored.
 */
export async function recommendFor(
  db: Tx,
  input: { slugs: readonly string[]; cityCode: string; locale: CatalogueLocale },
): Promise<Recommendation[]> {
  const src = await sourcesOf(db, input.slugs);
  if (!src) return [];
  const { sourceIds, triggerIds } = src;

  const ruled = rowsOf<{ product_id: string; label: string; label_hi: string }>(
    await db.execute(sql`
      select cand.id as product_id, r.label, r.label_hi
      from recommendation_rules r
      cross join lateral (
        select p.id from products p join categories pc on pc.id = p.category_id
        where ${productVisible('p')}
          and ((r.suggest_kind = 'category'
                and (pc.id = r.suggest_category_id or pc.parent_id = r.suggest_category_id))
            or (r.suggest_kind = 'product' and p.id = r.suggest_product_id))
          and p.id not in (${uuidList(sourceIds)})
          and exists (
            select 1 from product_variants v join shop_inventory si on si.variant_id = v.id
            join shops s on s.id = si.shop_id
            where v.product_id = p.id and ${BUYABLE_OFFER})
        order by p.created_at desc, p.id
        limit ${RECO_RULE_CANDIDATES}) cand
      where r.active and r.suggest_kind <> 'workshop_fitting'
        and (r.trigger_category_id in (${uuidList(triggerIds)}) or r.trigger_product_id in (${uuidList(sourceIds)}))
      order by r.priority, r.id, cand.id`),
  );
  const together = rowsOf<{ product_id: string; c: string | number }>(
    await db.execute(sql`
      select b_product_id as product_id, sum(pair_count) as c from copurchase_pairs
      where a_product_id in (${uuidList(sourceIds)}) and b_product_id not in (${uuidList(sourceIds)})
      group by b_product_id order by sum(pair_count) desc, b_product_id limit ${RECO_RULE_CANDIDATES}`),
  );

  const why = new Map<string, Recommendation['reason']>();
  for (const r of ruled)
    if (!why.has(r.product_id))
      why.set(r.product_id, {
        source: 'rule',
        label: input.locale === 'hi' ? r.label_hi : r.label,
        count: null,
      });
  for (const r of together)
    if (!why.has(r.product_id)) why.set(r.product_id, { source: 'copurchase', label: null, count: num(r.c) });
  if (why.size === 0) return [];

  const ids = [...why.keys()].slice(0, 40);
  const page = await listCatalogue(db, {
    cityCode: input.cityCode,
    locale: input.locale,
    productIds: ids,
    availableOnly: true,
    limit: ids.length,
  });
  const byId = new Map(page.items.map((c) => [c.id, c]));
  const out: Recommendation[] = [];
  for (const id of ids) {
    const card = byId.get(id);
    const reason = why.get(id);
    if (card && reason) out.push({ card, reason });
    if (out.length === RECO_MAX) break;
  }
  return out;
}

/**
 * The workshop fitting link (phase 3): the label of the first active `workshop_fitting` rule whose trigger is one of
 * the products or their category (or its parent), in the asked language; null when none applies.
 */
export async function fittingFor(
  db: Tx,
  input: { slugs: readonly string[]; locale: CatalogueLocale },
): Promise<{ label: string } | null> {
  const src = await sourcesOf(db, input.slugs);
  if (!src) return null;
  const [row] = rowsOf<{ label: string; label_hi: string }>(
    await db.execute(sql`
      select r.label, r.label_hi from recommendation_rules r
      where r.active and r.suggest_kind = 'workshop_fitting'
        and (r.trigger_category_id in (${uuidList(src.triggerIds)})
          or r.trigger_product_id in (${uuidList(src.sourceIds)}))
      order by r.priority, r.id limit 1`),
  );
  return row ? { label: input.locale === 'hi' ? row.label_hi : row.label } : null;
}

/** A pack size as people say it: 900 ml, 1 l, 3.5 l, 500 g, 5 pieces stay as stored. */
function packLabel(qty: number, unit: string): string {
  if (unit === 'ml' && qty >= 1000) return `${String(qty / 1000)} l`;
  if (unit === 'g' && qty >= 1000) return `${String(qty / 1000)} kg`;
  return `${String(qty)} ${unit}`;
}

/**
 * "Similar options" (phase 3): products of the same category in the same size (a variant's size text, or the tyre
 * size in the specs) and, when the product has them, the same oil grade (`saeGrade`) and battery capacity
 * (`capacityAh`), sharing a vehicle segment when the product has segments, of another brand, visible and with a
 * buyable offer in the city; at most `RECO_SIMILAR_MAX`. A product with no size and none of those specs gets nothing
 * (no guess). The reason carries the shared size.
 */
export async function similarFor(
  db: Tx,
  input: { slug: string; cityCode: string; locale: CatalogueLocale },
): Promise<Recommendation[]> {
  const rows = rowsOf<{ product_id: string; size: string | null; qty: number | null; unit: string | null }>(
    await db.execute(sql`
      with src as (
        select p.id, p.category_id, p.brand_id, p.spec from products p
        where p.slug = ${input.slug} and ${productVisible('p')}
      ), src_keys as (
        select v.size_compact as k, v.options->>'size' as size, v.net_qty as qty, v.net_unit as unit
        from product_variants v join src on v.product_id = src.id
        where v.status = 'active' and coalesce(v.size_compact, '') <> ''
        union all
        select regexp_replace(upper(src.spec->>'size'), '[^A-Z0-9]', '', 'g'), src.spec->>'size', null, null
        from src where coalesce(src.spec->>'size', '') <> ''
      ), src_seg as (
        select ps.segment_code from product_vehicle_segments ps join src on ps.product_id = src.id
      ), cand as (
        select p.id, v.size_compact as k from products p join src on p.category_id = src.category_id
        join product_variants v on v.product_id = p.id and v.status = 'active'
        where p.id <> src.id and p.brand_id <> src.brand_id and coalesce(v.size_compact, '') <> ''
        union all
        select p.id, regexp_replace(upper(p.spec->>'size'), '[^A-Z0-9]', '', 'g') from products p
        join src on p.category_id = src.category_id
        where p.id <> src.id and p.brand_id <> src.brand_id and coalesce(p.spec->>'size', '') <> ''
      )
      select cand.id as product_id, min(sk.size) as size, min(sk.qty) as qty, min(sk.unit) as unit
      from cand join src_keys sk on sk.k = cand.k
      join products p on p.id = cand.id
      cross join src
      where ${productVisible('p')}
        and (src.spec->>'saeGrade' is null or upper(p.spec->>'saeGrade') = upper(src.spec->>'saeGrade'))
        and (src.spec->>'capacityAh' is null or p.spec->>'capacityAh' = src.spec->>'capacityAh')
        and (not exists (select 1 from src_seg) or exists (
          select 1 from product_vehicle_segments ps
          where ps.product_id = p.id and ps.segment_code in (select segment_code from src_seg)))
        and exists (
          select 1 from product_variants v join shop_inventory si on si.variant_id = v.id
          join shops s on s.id = si.shop_id
          where v.product_id = p.id and ${BUYABLE_OFFER})
      group by cand.id, p.created_at
      order by p.created_at desc, cand.id
      limit 40`),
  );
  if (rows.length === 0) return [];
  const sizeOf = new Map(
    rows.map((r) => [
      r.product_id,
      r.size ?? (r.qty !== null && r.unit !== null ? packLabel(num(r.qty), r.unit) : null),
    ]),
  );
  const ids = rows.map((r) => r.product_id);
  const page = await listCatalogue(db, {
    cityCode: input.cityCode,
    locale: input.locale,
    productIds: ids,
    availableOnly: true,
    limit: ids.length,
  });
  const byId = new Map(page.items.map((c) => [c.id, c]));
  const out: Recommendation[] = [];
  for (const id of ids) {
    const card = byId.get(id);
    if (card)
      out.push({
        card,
        reason: { source: 'similar', label: null, count: null, size: sizeOf.get(id) ?? null },
      });
    if (out.length === RECO_SIMILAR_MAX) break;
  }
  return out;
}

/** The rule form's product picker: visible products whose name, brand or slug contains the text (at most 20). */
export async function searchRecoProducts(
  db: Tx,
  q: string,
): Promise<{ id: string; slug: string; name: string; nameHi: string | null }[]> {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return rowsOf<{ id: string; slug: string; name: string; nameHi: string | null }>(
    await db.execute(sql`
      select p.id, p.slug, b.name || ' ' || p.name as name,
        case when p.name_hi is null then null else b.name || ' ' || p.name_hi end as "nameHi"
      from products p join brands b on b.id = p.brand_id
      where ${productVisible('p')}
        and (p.name ilike ${like} or b.name ilike ${like} or p.slug ilike ${like})
      order by b.name, p.name, p.id limit 20`),
  );
}

// ── Suggestion funnel (spec 12) ─────────────────────────────────────────────────────────────────────────────

export interface RecoFunnelRow {
  surface: RecoSurface;
  algo: RecoAlgo;
  /** Lists scrolled into view, and the cards they held. */
  impressions: number;
  shown: number;
  clicks: number;
  /** Clicked products added to the cart later in the same session. */
  adds: number;
  /** Orders placed later in the same session that hold a clicked product. */
  orders: number;
}

/**
 * Impressions, clicks, add-to-cart and orders per surface and algorithm in [from, to) (spec 12 "Suggestions"). An add
 * or order counts for a click when it follows the click in the same browser session and names the clicked product
 * (orders: `purchase_submitted` of that session whose order group holds the product). Pseudonymous: sessions only.
 */
export async function recoFunnel(db: Tx, input: { from: Date; to: Date }): Promise<RecoFunnelRow[]> {
  const from = input.from.toISOString();
  const to = input.to.toISOString();
  const rows = rowsOf<{
    surface: RecoSurface;
    algo: RecoAlgo;
    impressions: string | number;
    shown: string | number;
    clicks: string | number;
    adds: string | number;
    orders: string | number;
  }>(
    await db.execute(sql`
      with imp as (
        select props->>'surface' as surface, props->>'algo' as algo, count(*) as impressions,
          coalesce(sum((props->>'count')::int), 0) as shown
        from events where event = 'reco_impression' and source = 'web'
          and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz
        group by 1, 2
      ), clk as (
        select props->>'surface' as surface, props->>'algo' as algo, props->>'slug' as slug, session_id, occurred_at
        from events where event = 'reco_click' and source = 'web' and session_id is not null
          and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz
      ), clicks as (
        select surface, algo, count(*) as clicks from clk group by 1, 2
      ), adds as (
        select c.surface, c.algo, count(distinct (c.session_id, c.slug)) as adds
        from clk c join events a on a.event = 'add_to_cart' and a.session_id = c.session_id
          and a.props->>'slug' = c.slug and a.occurred_at >= c.occurred_at
          and a.occurred_at < ${to}::timestamptz + interval '1 day'
        group by 1, 2
      ), ords as (
        select c.surface, c.algo, count(distinct pu.props->>'code') as orders
        from clk c
        join events pu on pu.event = 'purchase_submitted' and pu.session_id = c.session_id
          and pu.occurred_at >= c.occurred_at and pu.occurred_at < ${to}::timestamptz + interval '1 day'
        join order_groups g on g.code = pu.props->>'code'
        where exists (
          select 1 from orders o join order_items oi on oi.order_id = o.id
          join product_variants v on v.id = oi.variant_id join products p on p.id = v.product_id
          where o.group_id = g.id and p.slug = c.slug)
        group by 1, 2
      ), keys as (select surface, algo from imp union select surface, algo from clicks)
      select k.surface, k.algo, coalesce(imp.impressions, 0) as impressions, coalesce(imp.shown, 0) as shown,
        coalesce(clicks.clicks, 0) as clicks, coalesce(adds.adds, 0) as adds, coalesce(ords.orders, 0) as orders
      from keys k
      left join imp on imp.surface = k.surface and imp.algo = k.algo
      left join clicks on clicks.surface = k.surface and clicks.algo = k.algo
      left join adds on adds.surface = k.surface and adds.algo = k.algo
      left join ords on ords.surface = k.surface and ords.algo = k.algo
      order by k.surface, k.algo`),
  );
  return rows.map((r) => ({
    surface: r.surface,
    algo: r.algo,
    impressions: num(r.impressions),
    shown: num(r.shown),
    clicks: num(r.clicks),
    adds: num(r.adds),
    orders: num(r.orders),
  }));
}
