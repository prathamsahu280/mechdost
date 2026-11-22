import { and, asc, eq, sql } from 'drizzle-orm';
import {
  RECO_MAX,
  RECO_MIN_SUPPORT,
  RECO_PAIRS_PER_PRODUCT,
  RECO_RULE_CANDIDATES,
  RECO_RULES_MAX,
} from '@mechdost/shared/recommendation-limits';
import type { Recommendation, RecoRule, RecoRuleInput } from '@mechdost/shared/recommendations';
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

interface RuleRow {
  id: string;
  label: string;
  label_hi: string;
  priority: number;
  active: boolean;
  version: number;
  updated_at: Date | string;
  trigger_id: string;
  trigger_slug: string;
  trigger_name: string;
  trigger_name_hi: string | null;
  suggest_id: string;
  suggest_slug: string;
  suggest_name: string;
  suggest_name_hi: string | null;
}

const RULE_SELECT = sql`
  select r.id, r.label, r.label_hi, r.priority, r.active, r.version, r.updated_at,
    tc.id as trigger_id, tc.slug as trigger_slug, tc.name as trigger_name, tc.name_hi as trigger_name_hi,
    sc.id as suggest_id, sc.slug as suggest_slug, sc.name as suggest_name, sc.name_hi as suggest_name_hi
  from recommendation_rules r
  join categories tc on tc.id = r.trigger_category_id
  join categories sc on sc.id = r.suggest_category_id`;

function toRule(r: RuleRow): RecoRule {
  return {
    id: r.id,
    triggerCategory: {
      id: r.trigger_id,
      slug: r.trigger_slug,
      name: r.trigger_name,
      nameHi: r.trigger_name_hi,
    },
    suggestCategory: {
      id: r.suggest_id,
      slug: r.suggest_slug,
      name: r.suggest_name,
      nameHi: r.suggest_name_hi,
    },
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
    await tx.execute(sql`${RULE_SELECT} order by r.priority, tc.name, sc.name, r.id limit ${RECO_RULES_MAX}`),
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
  if (code === '23503') throw new ValidationError('That category does not exist', 'UNKNOWN_CATEGORY');
  if (code === '23514') throw new ValidationError('The rule is not valid', 'RULE_INVALID');
  throw err;
}

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
          triggerCategoryId: i.triggerCategoryId,
          suggestCategoryId: i.suggestCategoryId,
          label: i.label,
          labelHi: i.labelHi,
          priority: i.priority,
          active: i.active,
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
          triggerCategoryId: i.triggerCategoryId,
          suggestCategoryId: i.suggestCategoryId,
          label: i.label,
          labelHi: i.labelHi,
          priority: i.priority,
          active: i.active,
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
          trigger: before.triggerCategory.slug,
          suggest: before.suggestCategory.slug,
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
        trigger: before.triggerCategory.slug,
        suggest: before.suggestCategory.slug,
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

/**
 * "Goes well with" for the products a page is about (a product page: one; a cart: its lines). Admin rules first
 * (lower priority number first, then newest products), then what customers bought together; each product once, never
 * one of the asked-about products, only products with a buyable offer, at most `RECO_MAX`. Unknown slugs are ignored.
 */
export async function recommendFor(
  db: Tx,
  input: { slugs: readonly string[]; cityCode: string; locale: CatalogueLocale },
): Promise<Recommendation[]> {
  if (input.slugs.length === 0) return [];
  const sources = rowsOf<{ id: string; category_id: string; parent_id: string | null }>(
    await db.execute(sql`
      select p.id, p.category_id, c.parent_id from products p join categories c on c.id = p.category_id
      where ${productVisible('p')} and p.slug in (${sql.join(
        input.slugs.map((s) => sql`${s}`),
        sql`, `,
      )})`),
  );
  if (sources.length === 0) return [];
  const sourceIds = sources.map((s) => s.id);
  const triggerIds = [
    ...new Set(sources.flatMap((s) => (s.parent_id ? [s.category_id, s.parent_id] : [s.category_id]))),
  ];

  const ruled = rowsOf<{ product_id: string; label: string; label_hi: string }>(
    await db.execute(sql`
      select cand.id as product_id, r.label, r.label_hi
      from recommendation_rules r
      cross join lateral (
        select p.id from products p join categories pc on pc.id = p.category_id
        where ${productVisible('p')}
          and (pc.id = r.suggest_category_id or pc.parent_id = r.suggest_category_id)
          and p.id not in (${uuidList(sourceIds)})
          and exists (
            select 1 from product_variants v join shop_inventory si on si.variant_id = v.id
            join shops s on s.id = si.shop_id
            where v.product_id = p.id and ${BUYABLE_OFFER})
        order by p.created_at desc, p.id
        limit ${RECO_RULE_CANDIDATES}) cand
      where r.active and r.trigger_category_id in (${uuidList(triggerIds)})
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
