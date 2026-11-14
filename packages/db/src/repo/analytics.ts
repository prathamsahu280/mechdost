import { sql, type SQL } from 'drizzle-orm';
import type { AdminOverview, AnalyticsDashboard } from '@mechdost/shared/admin-analytics-api';
import { analyticsDays, type AnalyticsRange } from '@mechdost/shared/analytics-range';
import { istDateString } from '@mechdost/shared/time';
import { SERVICE_REQUEST_STATES } from '@mechdost/shared/state';
import { catalogueHasMatch } from './catalogue';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Admin analytics (spec 08 "Analytics", built 2026-11-14): read-only aggregates over live tables, bounded by an IST
 * date range (≤ 180 days) and the caller's cities. Every query is time-bounded on an indexed column:
 * `order_groups (city_id, created_at)` → `orders (group_id, …)` → `order_items (order_id)`;
 * `service_requests (city_id, created_at)` and `order_assignments (offered_at)` (migration 0050);
 * `events (event, occurred_at)` — the partition key, so only the range's monthly partitions are read.
 *
 * Definitions (shown in the admin help text):
 * - an **order** is a checkout that became one: cash on delivery, or online and paid (the routing queue's rule);
 *   unpaid online checkouts are counted separately and are never orders;
 * - **GMV** is the value of order parts not cancelled or rejected; AOV = GMV ÷ orders with a part still live;
 * - **new customer**: first order ever in the range; **repeat**: more than one order up to the range's end;
 * - **traffic** (web/app events) has no city yet, so it is site-wide and only computed when asked for (staff whose
 *   analytics grant covers every city); funnel visitor steps are distinct visitor ids, order steps are orders;
 * - a search phrase is listed only when at least two visitors typed it (it is user text; k-anonymity of 2).
 */
export type AnalyticsCities = 'all' | readonly string[];
export type AnalyticsResult = Omit<AnalyticsDashboard, 'range' | 'city' | 'cities'>;

const PAID = sql.raw(`('paid', 'partially_refunded', 'refunded')`);
/** The checkout is an order (same rule as the routing queue in `routing.ts`). */
const isOrder = (alias: string) =>
  sql`(${sql.raw(alias)}.payment_method = 'cod' or ${sql.raw(alias)}.payment_status in ${PAID})`;
const LIVE_PART = sql.raw(`not in ('cancelled', 'rejected')`);
const PRODUCT_PATH = '^/shop/[^/]+$';
const IST = sql.raw(`'Asia/Kolkata'`);
/** Service requests that reached "confirmed" or a later working state. */
const BOOKED = SERVICE_REQUEST_STATES.slice(
  SERVICE_REQUEST_STATES.indexOf('confirmed'),
  SERVICE_REQUEST_STATES.indexOf('completed') + 1,
);
const list = (values: readonly string[]) =>
  sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

function cityIn(column: string, cities: AnalyticsCities): SQL {
  if (cities === 'all') return sql`true`;
  if (cities.length === 0) return sql`false`;
  return sql`${sql.raw(column)} in (${sql.join(
    cities.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
const citiesOf = (scope: CityScope): AnalyticsCities => (scope.all ? 'all' : scope.cityIds);

interface Bounds {
  from: string;
  to: string;
}
const between = (column: string, b: Bounds) =>
  sql`${sql.raw(column)} >= ${b.from}::timestamptz and ${sql.raw(column)} < ${b.to}::timestamptz`;

const medianInt = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
};

async function orderKpis(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const [r] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      with g as (
        select og.id, og.user_id, og.payment_method, ${isOrder('og')} as is_order
        from order_groups og
        where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)}
      ),
      parts as (select o.group_id, o.status, o.total_paise from orders o join g on g.id = o.group_id where g.is_order)
      select
        (select count(*) from g where is_order)::int as orders,
        (select count(*) from g where is_order and payment_method = 'cod')::int as cod,
        (select count(*) from g where is_order and payment_method = 'online')::int as online,
        (select count(*) from g where not is_order)::int as unpaid,
        (select coalesce(sum(total_paise), 0) from parts where status ${LIVE_PART})::bigint as gmv,
        (select count(distinct group_id) from parts where status ${LIVE_PART})::int as live_orders,
        (select count(distinct group_id) from parts where status = 'delivered')::int as delivered,
        (select count(distinct user_id) from g where is_order)::int as customers`),
  );
  return {
    orders: num(r?.orders ?? 0),
    cod: num(r?.cod ?? 0),
    online: num(r?.online ?? 0),
    unpaid: num(r?.unpaid ?? 0),
    gmv: num(r?.gmv ?? 0),
    liveOrders: num(r?.live_orders ?? 0),
    delivered: num(r?.delivered ?? 0),
    customers: num(r?.customers ?? 0),
  };
}

async function reasonCounts(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const rows = rowsOf<{ status: string; code: string | null; n: unknown }>(
    await db.execute(sql`
      select o.status, o.status_reason_code as code, count(*)::int as n
      from order_groups og join orders o on o.group_id = og.id
      where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)} and ${isOrder('og')}
        and o.status in ('cancelled', 'rejected')
      group by o.status, o.status_reason_code
      order by n desc, code`),
  );
  const pick = (status: string) =>
    rows.filter((r) => r.status === status).map((r) => ({ code: r.code ?? 'unknown', count: num(r.n) }));
  const total = (status: string) => pick(status).reduce((sum, r) => sum + r.count, 0);
  return {
    cancelled: total('cancelled'),
    cancelReasons: pick('cancelled'),
    rejected: total('rejected'),
    rejectReasons: pick('rejected'),
  };
}

async function customerKpis(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const [r] = rowsOf<{ fresh: unknown; repeat: unknown }>(
    await db.execute(sql`
      with c as (
        select distinct og.user_id from order_groups og
        where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)} and ${isOrder('og')}
      )
      select
        count(*) filter (where not exists (select 1 from order_groups p
          where p.user_id = c.user_id and p.created_at < ${b.from}::timestamptz and ${isOrder('p')}))::int as fresh,
        count(*) filter (where (select count(*) from order_groups p
          where p.user_id = c.user_id and p.created_at < ${b.to}::timestamptz and ${isOrder('p')}) > 1)::int as repeat
      from c`),
  );
  return { newCustomers: num(r?.fresh ?? 0), repeatCustomers: num(r?.repeat ?? 0) };
}

async function serviceKpis(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const [r] = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      select count(*)::int as total,
        count(*) filter (where sr.status in ${list(BOOKED)})::int as confirmed,
        count(*) filter (where sr.status in ('paid', 'completed'))::int as completed,
        count(*) filter (where sr.status in ('cancelled', 'rejected'))::int as cancelled
      from service_requests sr
      where ${cityIn('sr.city_id', cities)} and ${between('sr.created_at', b)}`),
  );
  return {
    serviceRequests: num(r?.total ?? 0),
    bookingsConfirmed: num(r?.confirmed ?? 0),
    bookingsCompleted: num(r?.completed ?? 0),
    bookingsCancelled: num(r?.cancelled ?? 0),
  };
}

const OFFER_COLUMNS = sql`
  count(*)::int as offers,
  count(*) filter (where a.status = 'accepted')::int as accepted,
  count(*) filter (where a.status = 'declined')::int as declined,
  count(*) filter (where a.status = 'expired')::int as expired,
  percentile_cont(0.5) within group (order by extract(epoch from (a.responded_at - a.offered_at)))
    filter (where a.status = 'accepted' and a.responded_at is not null) as median_s`;

async function shopPerformance(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const where = sql`${cityIn('s.city_id', cities)} and ${between('a.offered_at', b)}`;
  const totals = await db.execute(sql`select ${OFFER_COLUMNS}
    from order_assignments a join shops s on s.id = a.shop_id where ${where}`);
  const rows = await db.execute(sql`select s.id, s.name, s.name_hi, ${OFFER_COLUMNS}
    from order_assignments a join shops s on s.id = a.shop_id where ${where}
    group by s.id, s.name, s.name_hi order by offers desc, s.name limit 20`);
  const [t] = rowsOf<Record<string, unknown>>(totals);
  return {
    kpis: {
      offersAnswered: num(t?.accepted ?? 0) + num(t?.declined ?? 0) + num(t?.expired ?? 0),
      offersAccepted: num(t?.accepted ?? 0),
      medianSecondsToAccept: medianInt(t?.median_s),
    },
    shops: rowsOf<Record<string, unknown> & { id: string; name: string; name_hi: string | null }>(rows).map(
      (r) => ({
        id: r.id,
        name: r.name,
        nameHi: r.name_hi,
        offers: num(r.offers),
        accepted: num(r.accepted),
        declined: num(r.declined),
        expired: num(r.expired),
        medianSecondsToAccept: medianInt(r.median_s),
      }),
    ),
  };
}

async function workshopPerformance(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const rows = rowsOf<Record<string, unknown> & { id: string; name: string; name_hi: string | null }>(
    await db.execute(sql`
      select w.id, w.name, w.name_hi, count(*)::int as requests,
        count(*) filter (where sr.status in ${list(BOOKED)})::int as confirmed,
        count(*) filter (where sr.status in ('paid', 'completed'))::int as completed,
        count(*) filter (where sr.status in ('cancelled', 'rejected'))::int as cancelled,
        percentile_cont(0.5) within group (order by extract(epoch from (fp.first_at - sr.created_at)) / 60) as median_m
      from service_requests sr
      join workshops w on w.id = sr.workshop_id
      left join lateral (select min(p.created_at) as first_at from service_proposals p
        where p.request_id = sr.id and p.workshop_id = sr.workshop_id) fp on true
      where ${cityIn('sr.city_id', cities)} and ${between('sr.created_at', b)}
      group by w.id, w.name, w.name_hi
      order by requests desc, w.name
      limit 20`),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameHi: r.name_hi,
    requests: num(r.requests),
    confirmed: num(r.confirmed),
    completed: num(r.completed),
    cancelled: num(r.cancelled),
    medianMinutesToPropose: medianInt(r.median_m),
  }));
}

async function areas(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const rows = rowsOf<{
    pincode: string;
    locality: string | null;
    locality_hi: string | null;
    orders: unknown;
    bookings: unknown;
  }>(
    await db.execute(sql`
      with ord as (
        select o.pincode, count(distinct og.id)::int as n
        from order_groups og join orders o on o.group_id = og.id
        where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)} and ${isOrder('og')}
        group by o.pincode
      ),
      bk as (
        select sr.pincode, count(*)::int as n from service_requests sr
        where ${cityIn('sr.city_id', cities)} and ${between('sr.created_at', b)}
        group by sr.pincode
      ),
      area as (
        select coalesce(ord.pincode, bk.pincode) as pincode, coalesce(ord.n, 0) as orders, coalesce(bk.n, 0) as bookings
        from ord full join bk on bk.pincode = ord.pincode
      )
      select area.pincode, pc.locality, pc.locality_hi, area.orders, area.bookings
      from area left join pincodes pc on pc.pincode = area.pincode
      order by area.orders + area.bookings desc, area.pincode
      limit 15`),
  );
  return rows.map((r) => ({
    pincode: r.pincode,
    locality: r.locality,
    localityHi: r.locality_hi,
    orders: num(r.orders),
    bookings: num(r.bookings),
  }));
}

async function topOrdered(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const rows = rowsOf<{
    slug: string;
    name: string;
    name_hi: string | null;
    orders: unknown;
    units: unknown;
  }>(
    await db.execute(sql`
      select p.slug, p.name, p.name_hi, count(distinct o.id)::int as orders, sum(i.qty)::int as units
      from order_groups og
      join orders o on o.group_id = og.id
      join order_items i on i.order_id = o.id
      join product_variants v on v.id = i.variant_id
      join products p on p.id = v.product_id
      where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)} and ${isOrder('og')}
        and o.status ${LIVE_PART}
      group by p.id, p.slug, p.name, p.name_hi
      order by orders desc, units desc, p.slug
      limit 10`),
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    nameHi: r.name_hi,
    orders: num(r.orders),
    units: num(r.units),
  }));
}

async function dailyOps(db: Tx, cities: AnalyticsCities, b: Bounds) {
  const orders = await db.execute(sql`
    select to_char(og.created_at at time zone ${IST}, 'YYYY-MM-DD') as day, count(distinct og.id)::int as orders,
      coalesce(sum(o.total_paise) filter (where o.status ${LIVE_PART}), 0)::bigint as gmv
    from order_groups og join orders o on o.group_id = og.id
    where ${cityIn('og.city_id', cities)} and ${between('og.created_at', b)} and ${isOrder('og')}
    group by 1`);
  const bookings = await db.execute(sql`
    select to_char(sr.created_at at time zone ${IST}, 'YYYY-MM-DD') as day, count(*)::int as n
    from service_requests sr
    where ${cityIn('sr.city_id', cities)} and ${between('sr.created_at', b)}
    group by 1`);
  return {
    orders: new Map(
      rowsOf<{ day: string; orders: unknown; gmv: unknown }>(orders).map((r) => [
        r.day,
        { orders: num(r.orders), gmv: num(r.gmv) },
      ]),
    ),
    bookings: new Map(rowsOf<{ day: string; n: unknown }>(bookings).map((r) => [r.day, num(r.n)])),
  };
}

// ── Traffic (first-party events; site-wide) ───────────────────────────────────────────────────────────────────────

const WEB = sql.raw(`e.source in ('web', 'app')`);

async function traffic(db: Tx, b: Bounds) {
  const inRange = sql`${WEB} and ${between('e.occurred_at', b)}`;
  const totals = await db.execute(sql`
      select
        count(distinct e.anonymous_id) filter (where e.event = 'page_view')::int as visitors,
        count(distinct e.session_id) filter (where e.event = 'page_view')::int as sessions,
        count(*) filter (where e.event = 'page_view' and e.props->>'path' ~ ${PRODUCT_PATH})::int as product_views,
        count(distinct e.anonymous_id) filter (where e.event = 'page_view' and e.props->>'path' ~ ${PRODUCT_PATH})::int
          as product_viewers,
        count(*) filter (where e.event = 'search')::int as searches,
        count(distinct e.anonymous_id) filter (where e.event = 'add_to_cart')::int as cart,
        count(distinct e.anonymous_id) filter (where e.event = 'begin_checkout')::int as checkout
      from events e
      where e.event in ('page_view', 'search', 'add_to_cart', 'begin_checkout') and ${inRange}`);
  const daily = await db.execute(sql`
      select to_char(e.occurred_at at time zone ${IST}, 'YYYY-MM-DD') as day, count(distinct e.anonymous_id)::int as n
      from events e where e.event = 'page_view' and ${inRange}
      group by 1`);
  const viewed = await db.execute(sql`
      with v as (
        select substring(e.props->>'path' from '^/shop/([^/]+)$') as slug, count(*)::int as views
        from events e
        where e.event = 'page_view' and ${inRange} and e.props->>'path' ~ ${PRODUCT_PATH}
        group by 1
      )
      select p.slug, p.name, p.name_hi, v.views from v join products p on p.slug = v.slug
      order by v.views desc, p.slug
      limit 10`);
  const searches = await db.execute(sql`
      select regexp_replace(lower(btrim(e.props->>'query')), '\\s+', ' ', 'g') as q, count(*)::int as n
      from events e
      where e.event = 'search' and ${inRange}
      group by 1
      having count(distinct e.anonymous_id) >= 2 and regexp_replace(lower(btrim(e.props->>'query')), '\\s+', ' ', 'g') <> ''
      order by n desc, q
      limit 15`);
  const [t] = rowsOf<Record<string, unknown>>(totals);
  const topSearches: { query: string; count: number; matches: boolean }[] = [];
  for (const r of rowsOf<{ q: string; n: unknown }>(searches))
    topSearches.push({ query: r.q, count: num(r.n), matches: await catalogueHasMatch(db, r.q) });
  return {
    totals: {
      visitors: num(t?.visitors ?? 0),
      sessions: num(t?.sessions ?? 0),
      productViews: num(t?.product_views ?? 0),
      searches: num(t?.searches ?? 0),
      cartVisitors: num(t?.cart ?? 0),
      checkoutVisitors: num(t?.checkout ?? 0),
    },
    productViewers: num(t?.product_viewers ?? 0),
    daily: new Map(rowsOf<{ day: string; n: unknown }>(daily).map((r) => [r.day, num(r.n)])),
    topViewed: rowsOf<{ slug: string; name: string; name_hi: string | null; views: unknown }>(viewed).map(
      (r) => ({
        slug: r.slug,
        name: r.name,
        nameHi: r.name_hi,
        views: num(r.views),
      }),
    ),
    topSearches,
  };
}

/**
 * The whole dashboard for one range and set of cities. Read-only; the caller caches it (the API keeps it for a few
 * minutes). `traffic` adds the site-wide event figures (only for staff with an all-cities analytics grant).
 */
export async function analyticsDashboard(
  db: Tx,
  input: { cityIds: AnalyticsCities; range: AnalyticsRange; traffic: boolean },
): Promise<AnalyticsResult> {
  const { fromInstant, toInstant, dates } = analyticsDays(input.range);
  const b: Bounds = { from: fromInstant.toISOString(), to: toInstant.toISOString() };
  const cities = input.cityIds;
  // One query at a time: a dashboard must never take several pooled connections from customer traffic.
  const orders = await orderKpis(db, cities, b);
  const reasons = await reasonCounts(db, cities, b);
  const customers = await customerKpis(db, cities, b);
  const services = await serviceKpis(db, cities, b);
  const shops = await shopPerformance(db, cities, b);
  const workshops = await workshopPerformance(db, cities, b);
  const areaRows = await areas(db, cities, b);
  const ordered = await topOrdered(db, cities, b);
  const daily = await dailyOps(db, cities, b);
  const web = input.traffic ? await traffic(db, b) : null;

  const orderSteps = [
    { step: 'order_placed' as const, count: orders.orders },
    { step: 'order_delivered' as const, count: orders.delivered },
  ];
  return {
    traffic: web?.totals ?? null,
    kpis: {
      ordersPlaced: orders.orders,
      gmvPaise: orders.gmv,
      aovPaise: orders.liveOrders > 0 ? Math.round(orders.gmv / orders.liveOrders) : null,
      codOrders: orders.cod,
      onlineOrders: orders.online,
      paymentsNotCompleted: orders.unpaid,
      ...reasons,
      customers: orders.customers,
      ...customers,
      ...services,
      ...shops.kpis,
    },
    daily: dates.map((date) => ({
      date,
      visitors: web ? (web.daily.get(date) ?? 0) : null,
      orders: daily.orders.get(date)?.orders ?? 0,
      gmvPaise: daily.orders.get(date)?.gmv ?? 0,
      bookings: daily.bookings.get(date) ?? 0,
    })),
    funnel: web
      ? [
          { step: 'product_view', count: web.productViewers },
          { step: 'add_to_cart', count: web.totals.cartVisitors },
          { step: 'checkout_started', count: web.totals.checkoutVisitors },
          ...orderSteps,
        ]
      : orderSteps,
    topViewed: web?.topViewed ?? null,
    topOrdered: ordered,
    topSearches: web?.topSearches ?? null,
    areas: areaRows,
    shops: shops.shops,
    workshops,
  };
}

/** The cities a staff member may pick (their analytics scope), by code. */
export async function analyticsCities(
  db: Tx,
  scope: CityScope,
): Promise<{ id: string; code: string; name: string; nameHi: string | null }[]> {
  const rows = rowsOf<{ id: string; code: string; name: string; name_hi: string | null }>(
    await db.execute(sql`select c.id, c.code, c.name, c.name_hi from cities c
      where ${cityIn('c.id', citiesOf(scope))} order by c.code`),
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, nameHi: r.name_hi }));
}

/** Per-queue city scopes of the caller; null = the caller lacks the permission that reads that queue. */
export interface OverviewScopes {
  orders: CityScope | null;
  service: CityScope | null;
  tickets: CityScope | null;
  reviews: CityScope | null;
  /** Partner applications have no city: counted only with an all-cities grant. */
  applications: CityScope | null;
  prices: CityScope | null;
  analytics: CityScope | null;
}

async function count(db: Tx, query: SQL): Promise<number> {
  const [r] = rowsOf<{ n: unknown }>(await db.execute(query));
  return num(r?.n ?? 0);
}

/**
 * Live work queues for the admin Overview (real sign-in). Each count uses the index of its queue:
 * `orders (status, city_id, placed_at)`, `service_requests (status, city_id, created_at)`,
 * `support_tickets (city_id, status)` / `(status, sla_ack_due)`, `reviews (status, created_at, id)`,
 * `partner_applications (status, created_at)`, `shop_price_requests (status, created_at)`.
 */
export async function adminOverviewCounts(
  db: Tx,
  input: { now: Date; scopes: OverviewScopes },
): Promise<AdminOverview> {
  const { scopes } = input;
  // One query at a time (see analyticsDashboard): never several pooled connections for one admin screen.
  const orders = scopes.orders
    ? await db.execute(sql`
        select count(*) filter (where o.status in ('placed', 'needs_rerouting'))::int as need,
          count(*) filter (where o.status = 'awaiting_shop')::int as awaiting,
          count(*) filter (where o.status in ('confirmed', 'packed', 'shipped', 'out_for_delivery'))::int as progress
        from orders o
        where o.status in ('placed', 'needs_rerouting', 'awaiting_shop', 'confirmed', 'packed', 'shipped',
            'out_for_delivery')
          and ${cityIn('o.city_id', citiesOf(scopes.orders))}
          and exists (select 1 from order_groups g where g.id = o.group_id and ${isOrder('g')})`)
    : null;
  const service = scopes.service
    ? await count(
        db,
        sql`select count(*) as n from service_requests r
          where r.status = 'needs_routing' and ${cityIn('r.city_id', citiesOf(scopes.service))}`,
      )
    : null;
  const tickets = scopes.tickets
    ? await count(
        db,
        sql`select count(*) as n from support_tickets t
          where t.status in ('open', 'in_review') and ${cityIn('t.city_id', citiesOf(scopes.tickets))}`,
      )
    : null;
  const reviews = scopes.reviews
    ? await count(
        db,
        sql`select count(*) as n from reviews r
          where r.status = 'pending' and ${cityIn('r.city_id', citiesOf(scopes.reviews))}`,
      )
    : null;
  const applications = scopes.applications?.all
    ? await count(
        db,
        sql`select count(*) as n from partner_applications a where a.status in ('new', 'in_review')`,
      )
    : null;
  const prices = scopes.prices
    ? await count(
        db,
        sql`select count(*) as n from shop_price_requests pr join shops s on s.id = pr.shop_id
          where pr.status = 'pending' and ${cityIn('s.city_id', citiesOf(scopes.prices))}`,
      )
    : null;
  const today = istDateString(input.now);
  const day = analyticsDays({ fromDate: today, toDate: today, days: 1 });
  const todayKpis = scopes.analytics
    ? await orderKpis(db, citiesOf(scopes.analytics), {
        from: day.fromInstant.toISOString(),
        to: day.toInstant.toISOString(),
      })
    : null;
  const [o] = orders ? rowsOf<{ need: unknown; awaiting: unknown; progress: unknown }>(orders) : [];
  return {
    ordersNeedRouting: o ? num(o.need) : null,
    ordersAwaitingShop: o ? num(o.awaiting) : null,
    ordersInProgress: o ? num(o.progress) : null,
    servicesNeedRouting: service,
    ticketsOpen: tickets,
    reviewsPending: reviews,
    applicationsPending: applications,
    priceRequestsPending: prices,
    ordersToday: todayKpis?.orders ?? null,
    gmvTodayPaise: todayKpis?.gmv ?? null,
  };
}
