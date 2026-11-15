import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { dateToIstLocal, istLocalToDate, type CouponKind } from '@mechdost/shared/coupon';
import type { AdminCoupon, CouponInput } from '@mechdost/shared/coupon-api';
import { auditLog, categories, cities, couponShopTerms, coupons, shops } from '../schema';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { cityIdByCode } from './settings-admin';

/**
 * Admin coupons (spec 08 "Promotions", design 2026-11-15; permission `coupons:write`): only staff create, edit, pause
 * and resume coupons. Every change is audited with before/after in the same transaction and checked against the
 * caller's city scope (a coupon outside it is a 404; "every city" needs an all-cities grant). Edits are compare-and-set
 * on `config_version` (admin edits only, not redemptions). A shop-funded coupon waits for its shop's acceptance (`coupon_shop_terms`); changing what the shop
 * would pay (kind, value, cap, minimum, window, limits, first-order rule) puts the acceptance back to `pending`.
 * Funder, shop and kind are locked once the coupon has been used.
 */
type CouponRow = typeof coupons.$inferSelect;

/** The terms a shop agrees to fund: what the checkout will do with the coupon (all numbers integer paise). */
function termsSnapshot(
  c: Pick<
    CouponRow,
    | 'kind'
    | 'value'
    | 'minSubtotalPaise'
    | 'maxDiscountPaise'
    | 'startsAt'
    | 'endsAt'
    | 'usageLimitTotal'
    | 'usageLimitPerUser'
    | 'firstOrderOnly'
    | 'cityId'
    | 'funder'
    | 'shopId'
    | 'categoryId'
  >,
) {
  return {
    // Only when set, so a shop's earlier acceptance of a coupon without a category is not asked again (2026-11-16).
    ...(c.categoryId ? { categoryId: c.categoryId } : {}),
    funder: c.funder,
    shopId: c.shopId,
    kind: c.kind,
    value: c.value,
    minSubtotalPaise: c.minSubtotalPaise,
    maxDiscountPaise: c.maxDiscountPaise,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt?.toISOString() ?? null,
    usageLimitTotal: c.usageLimitTotal,
    usageLimitPerUser: c.usageLimitPerUser,
    firstOrderOnly: c.firstOrderOnly,
    cityId: c.cityId,
  };
}

/** Deep equality of JSON values regardless of key order (jsonb does not keep it). */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, val]) => [k, canon(val)]),
          )
        : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const inScope = (scope: CityScope, cityId: string | null): boolean =>
  scope.all || (cityId !== null && scope.cityIds.includes(cityId));

function scopeSql(scope: CityScope): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.cityIds.length === 0) return sql`false`;
  return sql`${coupons.cityId} in (${sql.join(
    scope.cityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

async function toView(tx: Tx, row: CouponRow): Promise<AdminCoupon> {
  const [extra] = await tx
    .select({
      cityCode: cities.code,
      shopName: shops.name,
      shopTerms: couponShopTerms.status,
      categoryName: categories.name,
      categorySlug: categories.slug,
      now: sql<Date>`now()`,
    })
    .from(coupons)
    .leftJoin(cities, eq(cities.id, coupons.cityId))
    .leftJoin(shops, eq(shops.id, coupons.shopId))
    .leftJoin(couponShopTerms, eq(couponShopTerms.couponId, coupons.id))
    .leftJoin(categories, eq(categories.id, coupons.categoryId))
    .where(eq(coupons.id, row.id));
  return view(row, extra);
}

interface Extra {
  cityCode: string | null;
  shopName: string | null;
  shopTerms: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  now: Date | string;
}

function view(row: CouponRow, extra: Extra | undefined): AdminCoupon {
  const now = new Date(extra?.now ?? Date.now());
  const shopTerms =
    extra?.shopTerms === 'pending' || extra?.shopTerms === 'accepted' || extra?.shopTerms === 'declined'
      ? extra.shopTerms
      : null;
  const live =
    row.active &&
    row.startsAt <= now &&
    (row.endsAt === null || row.endsAt > now) &&
    (row.usageLimitTotal === null || row.usedCount < row.usageLimitTotal) &&
    (row.funder === 'mechdost' || shopTerms === 'accepted');
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    titleHi: row.titleHi,
    terms: row.terms,
    termsHi: row.termsHi,
    kind: row.kind as CouponKind,
    value: row.value,
    minSubtotalPaise: row.minSubtotalPaise,
    maxDiscountPaise: row.maxDiscountPaise,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    startsAtIst: dateToIstLocal(row.startsAt),
    endsAtIst: row.endsAt ? dateToIstLocal(row.endsAt) : null,
    usageLimitTotal: row.usageLimitTotal,
    usageLimitPerUser: row.usageLimitPerUser,
    usedCount: row.usedCount,
    firstOrderOnly: row.firstOrderOnly,
    cityCode: extra?.cityCode ?? null,
    funder: row.funder === 'shop' ? 'shop' : 'mechdost',
    shop: row.shopId ? { id: row.shopId, name: extra?.shopName ?? '' } : null,
    shopTerms,
    isPublic: row.isPublic,
    autoApply: row.autoApply,
    category: row.categoryId ? { slug: extra?.categorySlug ?? '', name: extra?.categoryName ?? '' } : null,
    active: row.active,
    pausedReason: row.pausedReason,
    live,
    version: row.configVersion,
  };
}

/** Newest first, optionally only the ones that need attention; keyset cursor on (created_at, id). */
export async function listCoupons(
  db: Tx,
  input: { scope: CityScope; cursor?: string | null; limit?: number },
): Promise<{ coupons: AdminCoupon[]; nextCursor: string | null }> {
  const limit = pageSize(input.limit, 25, 100);
  const after = input.cursor ? decodeCursor(input.cursor, 'timestamp') : null;
  const rows = await db
    .select({
      c: coupons,
      cityCode: cities.code,
      shopName: shops.name,
      shopTerms: couponShopTerms.status,
      categoryName: categories.name,
      categorySlug: categories.slug,
      now: sql<Date>`now()`,
      sortKey: sql<string>`${coupons.createdAt}::text`,
    })
    .from(coupons)
    .leftJoin(cities, eq(cities.id, coupons.cityId))
    .leftJoin(shops, eq(shops.id, coupons.shopId))
    .leftJoin(couponShopTerms, eq(couponShopTerms.couponId, coupons.id))
    .leftJoin(categories, eq(categories.id, coupons.categoryId))
    .where(
      and(
        scopeSql(input.scope),
        after
          ? sql`(${coupons.createdAt}, ${coupons.id}) < (cast(${after.k} as timestamptz), cast(${after.id} as uuid))`
          : undefined,
      ),
    )
    .orderBy(desc(coupons.createdAt), desc(coupons.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    coupons: page.map((r) => view(r.c, r)),
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.sortKey, id: last.c.id }) : null,
  };
}

async function resolveCity(tx: Tx, scope: CityScope, code: string | null): Promise<string | null> {
  if (code === null) {
    if (!scope.all) throw new NotFoundError('Not found');
    return null;
  }
  const id = await cityIdByCode(tx, code);
  if (!inScope(scope, id)) throw new NotFoundError('City not found');
  return id;
}

/** A category offer names its category by slug (what the catalogue shows); unknown or archived is a 422. */
async function resolveCategory(tx: Tx, slug: string | null): Promise<string | null> {
  if (slug === null) return null;
  const [row] = await tx
    .select({ id: categories.id, archivedAt: categories.archivedAt })
    .from(categories)
    .where(eq(categories.slug, slug));
  if (row?.archivedAt === null) return row.id;
  throw new ValidationError('That category does not exist', 'COUPON_CATEGORY');
}

/** A shop-funded coupon needs an approved shop, in the coupon's city when it has one. */
async function checkShop(tx: Tx, input: CouponInput, cityId: string | null): Promise<void> {
  if (input.funder !== 'shop' || input.shopId === null) return;
  const [shop] = await tx
    .select({ status: shops.status, cityId: shops.cityId })
    .from(shops)
    .where(eq(shops.id, input.shopId));
  if (!shop) throw new ValidationError('That shop does not exist', 'COUPON_SHOP');
  if (shop.status !== 'approved')
    throw new ValidationError('Only an approved shop can fund a coupon', 'COUPON_SHOP');
  if (cityId !== null && shop.cityId !== cityId)
    throw new ValidationError('The shop is in another city', 'COUPON_SHOP');
}

function valuesFrom(input: CouponInput, cityId: string | null, categoryId: string | null) {
  return {
    code: input.code,
    title: input.title,
    titleHi: input.titleHi,
    terms: input.terms,
    termsHi: input.termsHi,
    kind: input.kind,
    value: input.value,
    minSubtotalPaise: input.minSubtotalPaise,
    maxDiscountPaise: input.maxDiscountPaise,
    startsAt: istLocalToDate(input.startsAtIst),
    endsAt: input.endsAtIst ? istLocalToDate(input.endsAtIst) : null,
    usageLimitTotal: input.usageLimitTotal,
    usageLimitPerUser: input.usageLimitPerUser,
    firstOrderOnly: input.firstOrderOnly,
    cityId,
    funder: input.funder,
    shopId: input.shopId,
    isPublic: input.isPublic,
    autoApply: input.autoApply,
    categoryId,
  };
}

function mapWriteError(err: unknown): never {
  const code = pgCode(err);
  if (code === '23505') throw new ConflictError('That coupon code is already used', 'COUPON_CODE_TAKEN');
  if (code === '23503') throw new ValidationError('That category does not exist', 'COUPON_CATEGORY');
  if (code === '23514')
    throw new ValidationError('That combination is not allowed for a coupon', 'COUPON_RULE');
  throw err;
}

export async function createCoupon(
  db: Tx,
  input: { staffUserId: string; scope: CityScope; coupon: CouponInput },
): Promise<AdminCoupon> {
  return db.transaction(async (tx) => {
    const cityId = await resolveCity(tx, input.scope, input.coupon.city);
    await checkShop(tx, input.coupon, cityId);
    let row: CouponRow | undefined;
    try {
      [row] = await tx
        .insert(coupons)
        .values({
          ...valuesFrom(input.coupon, cityId, await resolveCategory(tx, input.coupon.categorySlug)),
          createdBy: input.staffUserId,
        })
        .returning();
    } catch (err) {
      mapWriteError(err);
    }
    if (!row) throw new Error('coupon insert returned no row');
    if (row.funder === 'shop' && row.shopId)
      await tx
        .insert(couponShopTerms)
        .values({ couponId: row.id, shopId: row.shopId, status: 'pending', terms: termsSnapshot(row) });
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'coupon.created',
      entity: 'coupon',
      entityId: row.id,
      after: {
        code: row.code,
        kind: row.kind,
        funder: row.funder,
        value: row.value,
        isPublic: row.isPublic,
        autoApply: row.autoApply,
        categoryId: row.categoryId,
      },
    });
    await recordServerEvent(tx, 'admin_coupon_saved', {
      userId: input.staffUserId,
      cityId,
      props: { couponId: row.id, action: 'created', funder: input.coupon.funder },
    });
    return toView(tx, row);
  });
}

async function lockCoupon(tx: Tx, scope: CityScope, id: string): Promise<CouponRow> {
  const [row] = await tx.select().from(coupons).where(eq(coupons.id, id)).for('update');
  if (!row || !inScope(scope, row.cityId)) throw new NotFoundError('Coupon not found');
  return row;
}

export async function updateCoupon(
  db: Tx,
  input: {
    couponId: string;
    expectedVersion: number;
    staffUserId: string;
    scope: CityScope;
    coupon: CouponInput;
  },
): Promise<AdminCoupon> {
  return db.transaction(async (tx) => {
    const before = await lockCoupon(tx, input.scope, input.couponId);
    if (before.configVersion !== input.expectedVersion)
      throw new ConflictError('The coupon changed meanwhile; reload it', 'STALE_COUPON');
    const cityId = await resolveCity(tx, input.scope, input.coupon.city);
    await checkShop(tx, input.coupon, cityId);
    const next = valuesFrom(input.coupon, cityId, await resolveCategory(tx, input.coupon.categorySlug));
    if (
      before.usedCount > 0 &&
      (next.funder !== before.funder || next.shopId !== before.shopId || next.kind !== before.kind)
    )
      throw new ValidationError(
        'Kind, funder and shop cannot change after the coupon was used',
        'COUPON_LOCKED',
      );
    let row: CouponRow | undefined;
    try {
      [row] = await tx
        .update(coupons)
        .set({ ...next, configVersion: sql`${coupons.configVersion} + 1` })
        .where(and(eq(coupons.id, before.id), eq(coupons.configVersion, input.expectedVersion)))
        .returning();
    } catch (err) {
      mapWriteError(err);
    }
    if (!row) throw new ConflictError('The coupon changed meanwhile; reload it', 'STALE_COUPON');
    // The shop agreed to specific terms: any change to them (or a new shop) asks again.
    // Compared with the snapshot the shop actually saw (the stored terms row), never with the previous coupon state,
    // so no sequence of edits (change, flip the funder away and back) can leave an old acceptance standing.
    const terms = termsSnapshot(row);
    const [existing] = await tx.select().from(couponShopTerms).where(eq(couponShopTerms.couponId, row.id));
    let moneyChanged = false;
    if (row.funder === 'shop' && row.shopId) {
      if (!existing) {
        moneyChanged = true;
        await tx
          .insert(couponShopTerms)
          .values({ couponId: row.id, shopId: row.shopId, status: 'pending', terms });
      } else if (existing.shopId !== row.shopId || !sameJson(existing.terms, terms)) {
        moneyChanged = true;
        await tx
          .update(couponShopTerms)
          .set({ shopId: row.shopId, status: 'pending', terms, decidedBy: null, decidedAt: null })
          .where(eq(couponShopTerms.id, existing.id));
      }
    } else if (existing) {
      // No longer shop-funded: the acceptance goes with it; funding by a shop again asks from scratch.
      await tx.delete(couponShopTerms).where(eq(couponShopTerms.id, existing.id));
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'coupon.updated',
      entity: 'coupon',
      entityId: row.id,
      before: {
        terms: termsSnapshot(before),
        code: before.code,
        shopId: before.shopId,
        isPublic: before.isPublic,
        autoApply: before.autoApply,
      },
      after: {
        terms,
        code: row.code,
        shopId: row.shopId,
        isPublic: row.isPublic,
        autoApply: row.autoApply,
        reaskedShop: moneyChanged && row.funder === 'shop',
      },
    });
    await recordServerEvent(tx, 'admin_coupon_saved', {
      userId: input.staffUserId,
      cityId,
      props: { couponId: row.id, action: 'updated', funder: input.coupon.funder },
    });
    return toView(tx, row);
  });
}

/** Pause with a reason (the code then answers "not available") or resume; history is the audit log. */
export async function setCouponPaused(
  db: Tx,
  input: {
    couponId: string;
    paused: boolean;
    reason: string | null;
    expectedVersion: number;
    staffUserId: string;
    scope: CityScope;
  },
): Promise<AdminCoupon> {
  return db.transaction(async (tx) => {
    const before = await lockCoupon(tx, input.scope, input.couponId);
    const [row] = await tx
      .update(coupons)
      .set({
        active: !input.paused,
        pausedReason: input.paused ? input.reason : null,
        configVersion: sql`${coupons.configVersion} + 1`,
      })
      .where(and(eq(coupons.id, before.id), eq(coupons.configVersion, input.expectedVersion)))
      .returning();
    if (!row) throw new ConflictError('The coupon changed meanwhile; reload it', 'STALE_COUPON');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: input.paused ? 'coupon.paused' : 'coupon.resumed',
      entity: 'coupon',
      entityId: row.id,
      before: { active: before.active, reason: before.pausedReason },
      after: { active: row.active, reason: row.pausedReason },
    });
    await recordServerEvent(tx, 'admin_coupon_paused', {
      userId: input.staffUserId,
      cityId: row.cityId,
      props: { couponId: row.id, paused: input.paused },
    });
    return toView(tx, row);
  });
}
