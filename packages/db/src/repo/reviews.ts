import { sql, type SQL } from 'drizzle-orm';
import {
  REVIEW_DAILY_LIMIT,
  REVIEWABLE_SERVICE_STATES,
  cleanReviewBody,
  cleanReviewNote,
  reviewMachine,
  reviewerName,
  type ReviewHideReason,
  type ReviewStatus,
  type ReviewTargetType,
} from '@mechdost/shared/reviews';
import { auditLog, reviews } from '../schema';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Customer reviews (spec 02 § Reviews; decision 2026-10-31). Verified only: a product review needs a delivered
 * sub-order of the customer's order containing that product; a workshop review needs the customer's service
 * request there to be paid or completed. One review per customer, target and purchase (unique constraint).
 * Reviews start pending; staff with `reviews:moderate` approve or hide them through `reviewMachine` by
 * compare-and-set on `version`, scoped to their cities (others' ids are 404). A workshop's rating aggregate is
 * recomputed in the same transaction whenever its approved set changes; product ratings are read live from the
 * approved rows (catalogue `cardExtras`). Review text is user content: stored as typed, never logged or translated.
 */
type Locale = 'en' | 'hi';

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const iso = (v: unknown): string => toDate(v).toISOString();

const PRODUCT_CODE = /^MD-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;
const SERVICE_CODE = /^SR-[A-Z]{3}-\d{4}-[0-9A-HJKMNP-TV-Z]{6}$/;

export interface MyReviewView {
  id: string;
  rating: number;
  body: string | null;
  status: ReviewStatus;
  createdAt: string;
}

export interface ReviewTargetView {
  targetType: ReviewTargetType;
  slug: string;
  name: string;
  review: MyReviewView | null;
}

/** The purchase a review is about: the customer's order (MD-…) or service request (SR-…). */
export type ReviewPurchase = { orderCode: string } | { serviceCode: string };

interface Candidate {
  targetType: ReviewTargetType;
  targetId: string;
  slug: string;
  name: string;
  nameHi: string | null;
  orderId: string | null;
  serviceRequestId: string | null;
  cityId: string;
}

/**
 * Everything the customer may review for one purchase. A foreign or unknown code is 404 (never "forbidden"); an
 * order with nothing delivered yet or a service not yet paid simply has no targets.
 */
async function candidatesFor(tx: Tx, userId: string, purchase: ReviewPurchase): Promise<Candidate[]> {
  if ('orderCode' in purchase) {
    if (!PRODUCT_CODE.test(purchase.orderCode)) throw new NotFoundError('Order not found');
    const [group] = rowsOf<{ id: string }>(
      await tx.execute(
        sql`select id from order_groups where code = ${purchase.orderCode} and user_id = ${userId} limit 1`,
      ),
    );
    if (!group) throw new NotFoundError('Order not found');
    const rows = rowsOf<{
      product_id: string;
      slug: string;
      name: string;
      name_hi: string | null;
      order_id: string;
      city_id: string;
    }>(
      await tx.execute(sql`
        select distinct on (p.id) p.id as product_id, p.slug, p.name, p.name_hi, o.id as order_id, o.city_id
        from orders o
        join order_items oi on oi.order_id = o.id
        join product_variants v on v.id = oi.variant_id
        join products p on p.id = v.product_id
        where o.group_id = ${group.id} and o.user_id = ${userId} and o.status = 'delivered'
        order by p.id, o.sub_no
        limit 50`),
    );
    return rows.map((r) => ({
      targetType: 'product',
      targetId: r.product_id,
      slug: r.slug,
      name: r.name,
      nameHi: r.name_hi,
      orderId: r.order_id,
      serviceRequestId: null,
      cityId: r.city_id,
    }));
  }
  if (!SERVICE_CODE.test(purchase.serviceCode)) throw new NotFoundError('Service request not found');
  const [row] = rowsOf<{
    id: string;
    status: string;
    city_id: string;
    workshop_id: string | null;
    slug: string | null;
    name: string | null;
    name_hi: string | null;
  }>(
    await tx.execute(sql`
      select sr.id, sr.status, sr.city_id, w.id as workshop_id, w.slug, w.name, w.name_hi
      from service_requests sr left join workshops w on w.id = sr.workshop_id
      where sr.code = ${purchase.serviceCode} and sr.user_id = ${userId} limit 1`),
  );
  if (!row) throw new NotFoundError('Service request not found');
  const reviewable = (REVIEWABLE_SERVICE_STATES as readonly string[]).includes(row.status);
  if (!reviewable || !row.workshop_id || !row.slug || !row.name) return [];
  return [
    {
      targetType: 'workshop',
      targetId: row.workshop_id,
      slug: row.slug,
      name: row.name,
      nameHi: row.name_hi,
      orderId: null,
      serviceRequestId: row.id,
      cityId: row.city_id,
    },
  ];
}

const purchaseFilter = (c: Candidate): SQL =>
  c.orderId ? sql`order_id = ${c.orderId}` : sql`service_request_id = ${c.serviceRequestId}`;

/** What the customer may review for this order or service, with the review they already wrote (any status). */
export async function myReviewTargets(
  db: Tx,
  input: { userId: string; purchase: ReviewPurchase; locale: Locale },
): Promise<ReviewTargetView[]> {
  const candidates = await candidatesFor(db, input.userId, input.purchase);
  const out: ReviewTargetView[] = [];
  for (const c of candidates) {
    const [r] = rowsOf<{
      id: string;
      rating: unknown;
      body: string | null;
      status: string;
      created_at: unknown;
    }>(
      await db.execute(sql`select id, rating, body, status, created_at from reviews
        where user_id = ${input.userId} and target_type = ${c.targetType} and target_id = ${c.targetId}
          and ${purchaseFilter(c)} limit 1`),
    );
    out.push({
      targetType: c.targetType,
      slug: c.slug,
      name: localized(c.name, c.nameHi, input.locale),
      review: r
        ? {
            id: r.id,
            rating: num(r.rating),
            body: r.body,
            status: r.status as ReviewStatus,
            createdAt: iso(r.created_at),
          }
        : null,
    });
  }
  return out;
}

/**
 * Write a verified review (pending until staff approve it). Refusals: unknown/foreign purchase → 404; target not
 * part of a delivered/paid purchase → 422 `REVIEW_NOT_ELIGIBLE`; already reviewed → 409 `REVIEW_EXISTS`; more
 * than `REVIEW_DAILY_LIMIT` in 24 h → 422 `REVIEW_DAILY_LIMIT` (serialised per customer).
 */
export async function submitReview(
  db: Tx,
  input: {
    userId: string;
    purchase: ReviewPurchase;
    targetType: ReviewTargetType;
    targetSlug: string;
    rating: number;
    body: string | null;
  },
): Promise<{ id: string; status: ReviewStatus }> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
    throw new ValidationError('Choose 1 to 5 stars', 'REVIEW_RATING');
  const body = cleanReviewBody(input.body);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`review:${input.userId}`}, 0))`);
    const candidates = await candidatesFor(tx, input.userId, input.purchase);
    const target = candidates.find((c) => c.targetType === input.targetType && c.slug === input.targetSlug);
    if (!target)
      throw new ValidationError('You can review only what you bought or had serviced', 'REVIEW_NOT_ELIGIBLE');
    const [recent] = rowsOf<{ n: unknown }>(
      await tx.execute(sql`select count(*)::int as n from reviews
        where user_id = ${input.userId} and created_at > now() - interval '24 hours'`),
    );
    if (num(recent?.n ?? 0) >= REVIEW_DAILY_LIMIT)
      throw new ValidationError(
        'You have written many reviews today; try again tomorrow',
        'REVIEW_DAILY_LIMIT',
      );
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction(async (sp) =>
        sp
          .insert(reviews)
          .values({
            userId: input.userId,
            cityId: target.cityId,
            orderId: target.orderId,
            serviceRequestId: target.serviceRequestId,
            targetType: target.targetType,
            targetId: target.targetId,
            rating: input.rating,
            body,
          })
          .returning({ id: reviews.id }),
      );
    } catch (err) {
      if (pgCode(err) === '23505') throw new ConflictError('You have already reviewed this', 'REVIEW_EXISTS');
      throw err;
    }
    if (!row) throw new Error('review insert returned nothing');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'review.submitted',
      entity: 'review',
      entityId: row.id,
      after: {
        targetType: target.targetType,
        targetId: target.targetId,
        rating: input.rating,
        text: body !== null,
      },
    });
    await recordServerEvent(tx, 'review_submitted', {
      userId: input.userId,
      cityId: target.cityId,
      props: {
        reviewId: row.id,
        targetType: target.targetType,
        targetId: target.targetId,
        rating: input.rating,
        hasText: body !== null,
      },
    });
    return { id: row.id, status: 'pending' as const };
  });
}

// ── public ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RatingSummary {
  avg: number | null;
  count: number;
  /** [5★, 4★, 3★, 2★, 1★] counts. */
  distribution: [number, number, number, number, number];
}

export interface PublicReviewView {
  id: string;
  rating: number;
  body: string | null;
  author: string | null;
  createdAt: string;
}

export const PUBLIC_REVIEWS_MAX = 20;

/** Id of a target that is public now (live product, published workshop); anything else is 404. */
async function publicTargetId(db: Tx, targetType: ReviewTargetType, slug: string): Promise<string> {
  const q =
    targetType === 'product'
      ? sql`select id from products where slug = ${slug} and status = 'live' limit 1`
      : sql`select id from workshops where slug = ${slug} and published limit 1`;
  const [row] = rowsOf<{ id: string }>(await db.execute(q));
  if (!row) throw new NotFoundError('Not found');
  return row.id;
}

/** Approved reviews of a product or workshop, newest first (keyset cursor), with the rating summary. */
export async function listPublicReviews(
  db: Tx,
  input: { targetType: ReviewTargetType; slug: string; cursor?: string; limit?: number },
): Promise<{ summary: RatingSummary; reviews: PublicReviewView[]; nextCursor: string | null }> {
  const targetId = await publicTargetId(db, input.targetType, input.slug);
  const limit = pageSize(input.limit, 10, PUBLIC_REVIEWS_MAX);
  const after = input.cursor ? decodeCursor(input.cursor, 'timestamp') : null;
  const [s] = rowsOf<Record<'n' | 'avg' | 's5' | 's4' | 's3' | 's2' | 's1', unknown>>(
    await db.execute(sql`select count(*)::int as n, avg(rating)::float8 as avg,
        count(*) filter (where rating = 5)::int as s5, count(*) filter (where rating = 4)::int as s4,
        count(*) filter (where rating = 3)::int as s3, count(*) filter (where rating = 2)::int as s2,
        count(*) filter (where rating = 1)::int as s1
      from reviews where target_type = ${input.targetType} and target_id = ${targetId} and status = 'approved'`),
  );
  const count = num(s?.n ?? 0);
  const avg = numOrNull(s?.avg);
  const summary: RatingSummary = {
    avg: count > 0 && avg !== null ? Math.round(avg * 10) / 10 : null,
    count,
    distribution: [num(s?.s5 ?? 0), num(s?.s4 ?? 0), num(s?.s3 ?? 0), num(s?.s2 ?? 0), num(s?.s1 ?? 0)],
  };
  const rows = rowsOf<{
    id: string;
    rating: unknown;
    body: string | null;
    name: string | null;
    created_at: unknown;
    k: string;
  }>(
    await db.execute(sql`select r.id, r.rating, r.body, u.name, r.created_at, r.created_at::text as k
      from reviews r join users u on u.id = r.user_id
      where r.target_type = ${input.targetType} and r.target_id = ${targetId} and r.status = 'approved'
        ${after ? sql`and (r.created_at, r.id) < (${after.k}::timestamptz, ${after.id}::uuid)` : sql``}
      order by r.created_at desc, r.id desc
      limit ${limit + 1}`),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    summary,
    reviews: page.map((r) => ({
      id: r.id,
      rating: num(r.rating),
      body: r.body,
      author: reviewerName(r.name),
      createdAt: iso(r.created_at),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}

// ── staff ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdminReviewView {
  id: string;
  targetType: ReviewTargetType;
  targetSlug: string;
  targetName: string;
  rating: number;
  body: string | null;
  author: string | null;
  status: ReviewStatus;
  hiddenReason: ReviewHideReason | null;
  note: string | null;
  orderCode: string | null;
  serviceCode: string | null;
  createdAt: string;
  moderatedAt: string | null;
  version: number;
}

export const REVIEW_QUEUE_MAX = 50;

const scopeSql = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`r.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

/**
 * The moderation queue in the staff member's cities: pending oldest first (first in, first out); approved and
 * hidden newest first.
 */
export async function listReviewQueue(
  db: Tx,
  scope: CityScope,
  input: { status: ReviewStatus; cursor?: string; limit?: number },
): Promise<{ reviews: AdminReviewView[]; nextCursor: string | null }> {
  const limit = pageSize(input.limit, 30, REVIEW_QUEUE_MAX);
  const after = input.cursor ? decodeCursor(input.cursor, 'timestamp') : null;
  const asc = input.status === 'pending';
  const keyset = after
    ? asc
      ? sql`and (r.created_at, r.id) > (${after.k}::timestamptz, ${after.id}::uuid)`
      : sql`and (r.created_at, r.id) < (${after.k}::timestamptz, ${after.id}::uuid)`
    : sql``;
  const order = asc ? sql`r.created_at asc, r.id asc` : sql`r.created_at desc, r.id desc`;
  const rows = rowsOf<{
    id: string;
    target_type: ReviewTargetType;
    target_slug: string | null;
    target_name: string | null;
    rating: unknown;
    body: string | null;
    name: string | null;
    status: ReviewStatus;
    hidden_reason: ReviewHideReason | null;
    moderation_note: string | null;
    order_code: string | null;
    service_code: string | null;
    created_at: unknown;
    moderated_at: unknown;
    version: unknown;
    k: string;
  }>(
    await db.execute(sql`select r.id, r.target_type,
        coalesce(p.slug, w.slug) as target_slug, coalesce(p.name, w.name) as target_name,
        r.rating, r.body, u.name, r.status, r.hidden_reason, r.moderation_note,
        g.code as order_code, sr.code as service_code, r.created_at, r.moderated_at, r.version,
        r.created_at::text as k
      from reviews r
      join users u on u.id = r.user_id
      left join products p on r.target_type = 'product' and p.id = r.target_id
      left join workshops w on r.target_type = 'workshop' and w.id = r.target_id
      left join orders o on o.id = r.order_id
      left join order_groups g on g.id = o.group_id
      left join service_requests sr on sr.id = r.service_request_id
      where r.status = ${input.status} and ${scopeSql(scope)} ${keyset}
      order by ${order}
      limit ${limit + 1}`),
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    reviews: page.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetSlug: r.target_slug ?? '',
      targetName: r.target_name ?? '',
      rating: num(r.rating),
      body: r.body,
      author: reviewerName(r.name),
      status: r.status,
      hiddenReason: r.hidden_reason,
      note: r.moderation_note,
      orderCode: r.order_code,
      serviceCode: r.service_code,
      createdAt: iso(r.created_at),
      moderatedAt: r.moderated_at === null ? null : iso(r.moderated_at),
      version: num(r.version),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ k: last.k, id: last.id }) : null,
  };
}

/**
 * Approve or hide a review (compare-and-set on `version`; a stale version is 409 `STALE_REVIEW`). Hiding needs a
 * reason code; approving clears it. When a workshop review enters or leaves the approved set, the workshop's
 * `rating_avg` / `rating_count` are recomputed in the same transaction, after locking the workshop row so two
 * moderations of the same workshop cannot both write a stale aggregate.
 */
export async function moderateReview(
  db: Tx,
  scope: CityScope,
  input: {
    staffUserId: string;
    id: string;
    to: ReviewStatus;
    reasonCode: ReviewHideReason | null;
    note: string | null;
    expectedVersion: number;
  },
): Promise<{ status: ReviewStatus; version: number }> {
  if (input.to === 'hidden' && !input.reasonCode)
    throw new ValidationError('Choose why the review is hidden', 'REVIEW_REASON_REQUIRED');
  const note = cleanReviewNote(input.note);
  return db.transaction(async (tx) => {
    const [r] = rowsOf<{
      id: string;
      status: ReviewStatus;
      target_type: ReviewTargetType;
      target_id: string;
      city_id: string;
    }>(
      await tx.execute(sql`select r.id, r.status, r.target_type, r.target_id, r.city_id from reviews r
        where r.id = ${input.id} and ${scopeSql(scope)} limit 1 for update`),
    );
    if (!r) throw new NotFoundError('Review not found');
    reviewMachine.assert(r.status, input.to, 'admin');
    const [updated] = rowsOf<{ version: unknown }>(
      await tx.execute(sql`update reviews set status = ${input.to},
          hidden_reason = ${input.to === 'hidden' ? input.reasonCode : null},
          moderation_note = ${note}, moderated_by = ${input.staffUserId}, moderated_at = now()
        where id = ${r.id} and version = ${input.expectedVersion}
        returning version`),
    );
    if (!updated) throw new ConflictError('This review changed; reload and try again', 'STALE_REVIEW');
    if (r.target_type === 'workshop' && (r.status === 'approved' || input.to === 'approved')) {
      await tx.execute(sql`select id from workshops where id = ${r.target_id} for update`);
      await tx.execute(sql`update workshops w set
          rating_count = s.n, rating_avg = case when s.n > 0 then round(s.avg, 2) else null end
        from (select count(*)::int as n, avg(rating)::numeric as avg from reviews
              where target_type = 'workshop' and target_id = ${r.target_id} and status = 'approved') s
        where w.id = ${r.target_id}`);
    }
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'staff',
      action: 'review.moderated',
      entity: 'review',
      entityId: r.id,
      before: { status: r.status },
      after: { status: input.to, reasonCode: input.to === 'hidden' ? input.reasonCode : null },
      reason: input.to === 'hidden' ? input.reasonCode : null,
    });
    await recordServerEvent(tx, 'admin_review_moderated', {
      userId: input.staffUserId,
      cityId: r.city_id,
      props: {
        reviewId: r.id,
        targetType: r.target_type,
        from: r.status,
        to: input.to,
        reasonCode: input.to === 'hidden' ? input.reasonCode : null,
      },
    });
    return { status: input.to, version: num(updated.version) };
  });
}
