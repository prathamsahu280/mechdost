import { eq, inArray, sql } from 'drizzle-orm';
import {
  benchmarkOf,
  emptyCounts,
  metricsOf,
  PERFORMANCE_WINDOWS,
  SHOP_ON_TIME_HOURS,
  type ShopCounts,
} from '@mechdost/shared/shop-performance';
import { shops } from '../schema';
import { NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';

/**
 * Shop performance (design 2026-11-15 item 6; spec 07), owner only (the API checks). For one shop over 30 and 90
 * days: acceptance rate, median time to accept, give-ups, on-time hand-over and ratings, next to the anonymous median
 * of the OTHER shops in the same city. Anonymity: the median leaves out every shop in `ownerShopIds`, and a metric
 * needs `SHOP_BENCHMARK_MIN` other shops (`@mechdost/shared/shop-performance`). Counts per shop come from three
 * indexed scans (offers by `offered_at`, hand-over from the order timeline, approved shop reviews), merged here.
 */
async function countsByShop(tx: Tx, cityId: string, days: number): Promise<Map<string, ShopCounts>> {
  const since = sql`now() - (${days}::int * interval '1 day')`;
  const byShop = new Map<string, ShopCounts>();
  const of = (id: string) => {
    let c = byShop.get(id);
    if (!c) {
      c = emptyCounts();
      byShop.set(id, c);
    }
    return c;
  };

  for (const r of rowsOf<{
    shop_id: string;
    accepted: unknown;
    declined: unknown;
    expired: unknown;
    given_up: unknown;
    secs: number[] | null;
  }>(
    await tx.execute(sql`
      select a.shop_id,
        count(*) filter (where a.status in ('accepted', 'given_up')) as accepted,
        count(*) filter (where a.status = 'declined') as declined,
        count(*) filter (where a.status = 'expired') as expired,
        count(*) filter (where a.status = 'given_up') as given_up,
        array_agg(extract(epoch from a.responded_at - a.offered_at)::int)
          filter (where a.status in ('accepted', 'given_up') and a.responded_at is not null) as secs
      from order_assignments a join shops s on s.id = a.shop_id
      where s.city_id = ${cityId} and a.offered_at >= ${since}
        and a.status in ('accepted', 'declined', 'expired', 'given_up')
      group by a.shop_id`),
  )) {
    const c = of(r.shop_id);
    c.accepted = num(r.accepted);
    c.declined = num(r.declined);
    c.expired = num(r.expired);
    c.givenUp = num(r.given_up);
    c.acceptSeconds = (r.secs ?? []).map(Number);
  }

  // Hand-over: the order moved to `shipped` within the window of hours after the accept. A give-up never counts as on
  // time; an order is "due" once it was handed over or its window has run out.
  for (const r of rowsOf<{ shop_id: string; due: unknown; on_time: unknown }>(
    await tx.execute(sql`
      select a.shop_id,
        count(*) filter (where a.status = 'given_up' or e.at is not null
          or a.responded_at + (${SHOP_ON_TIME_HOURS}::int * interval '1 hour') <= now()) as due,
        count(*) filter (where a.status = 'accepted' and e.at is not null
          and e.at <= a.responded_at + (${SHOP_ON_TIME_HOURS}::int * interval '1 hour')) as on_time
      from order_assignments a join shops s on s.id = a.shop_id
      left join lateral (
        select min(ev.created_at) as at from order_events ev
        where ev.order_id = a.order_id and ev.to_status = 'shipped'
      ) e on a.status = 'accepted'
      where s.city_id = ${cityId} and a.offered_at >= ${since}
        and a.status in ('accepted', 'given_up') and a.responded_at is not null
      group by a.shop_id`),
  )) {
    const c = of(r.shop_id);
    c.due = num(r.due);
    c.onTime = num(r.on_time);
  }

  for (const r of rowsOf<{ shop_id: string; total: unknown; n: unknown }>(
    await tx.execute(sql`
      select rv.target_id as shop_id, sum(rv.rating) as total, count(*) as n
      from reviews rv join shops s on s.id = rv.target_id
      where s.city_id = ${cityId} and rv.target_type = 'shop' and rv.status = 'approved'
        and rv.created_at >= ${since}
      group by rv.target_id`),
  )) {
    const c = of(r.shop_id);
    c.ratingSum = num(r.total);
    c.ratingCount = num(r.n);
  }
  return byShop;
}

export async function getShopPerformance(
  db: Tx,
  input: { shopId: string; ownerShopIds: readonly string[]; userId: string },
) {
  const [shop] = await db.select({ cityId: shops.cityId }).from(shops).where(eq(shops.id, input.shopId));
  if (!shop || !input.ownerShopIds.includes(input.shopId)) throw new NotFoundError('Shop not found');
  const ownCities = await db
    .select({ cityId: shops.cityId, id: shops.id })
    .from(shops)
    .where(inArray(shops.id, [...input.ownerShopIds]));
  // Owners holding shops in more than one city get no benchmark: "the city" would be ambiguous.
  const oneCity = ownCities.every((s) => s.cityId === shop.cityId);
  const owned = new Set(input.ownerShopIds);

  const windows = [];
  for (const days of PERFORMANCE_WINDOWS) {
    const all = await countsByShop(db, shop.cityId, days);
    const others = [...all.entries()].filter(([id]) => !owned.has(id)).map(([, c]) => metricsOf(c));
    windows.push({
      days,
      mine: metricsOf(all.get(input.shopId) ?? emptyCounts()),
      city: oneCity ? benchmarkOf(others) : null,
    });
  }
  await recordServerEvent(db, 'shop_performance_viewed', {
    userId: input.userId,
    cityId: shop.cityId,
    props: { shopId: input.shopId },
  });
  return { shopId: input.shopId, onTimeHours: SHOP_ON_TIME_HOURS, windows };
}
