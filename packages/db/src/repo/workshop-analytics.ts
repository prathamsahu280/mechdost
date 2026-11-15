import { sql, type SQL } from 'drizzle-orm';
import type { WorkshopStats } from '@mechdost/shared/workshop-analytics-api';
import { analyticsDays, type AnalyticsRange } from '@mechdost/shared/analytics-range';
import { analyticsCityFilter, readOnlyReport, type AnalyticsCities } from './analytics';
import type { Tx } from './orders';
import { num, numOrNull, rowsOf } from './sql-rows';

/**
 * Workshop analytics (spec 08 "Analytics → Workshops", spec 07 "Performance"; design 2026-11-15). Read-only aggregates
 * over `service_requests` created in an IST range (≤ 180 days), per workshop, in one read-only transaction with the
 * dashboard's statement timeout (`readOnlyReport`). Indexed on `service_requests (city_id, created_at)` for a city and
 * `(workshop_id, created_at)` (0062) for one workshop; the per-request lookups use `(request_id, id)` on
 * `service_events`, `(request_id, revision)` on estimates, `request_id` on bills and photos, and
 * `(user_id, vehicle_key)` for comebacks.
 *
 * Definitions (shown in the help text):
 * - **requests**: created in the range and assigned to the workshop now, plus requests it declined (they move on);
 * - **funnel steps** are read from the append-only `service_events` (a cancelled request keeps the steps it reached);
 * - **time to propose**: the latest offer to the workshop → its first proposal; **to estimate**: vehicle received →
 *   first estimate sent; **job time**: vehicle received → ready (medians, minutes);
 * - **acceptance**: answered offers (proposed ÷ proposed + declined; there is no timer for workshops);
 * - **lines**: the latest estimate version's lines and their decisions (before GST);
 * - **billed**: the bill total (GST included); average bill = billed ÷ bills;
 * - **returned within 30 days**: a completed job followed by a new, not cancelled or rejected request of the same
 *   customer for the same vehicle (saved vehicle id when set, else the vehicle key) at the same workshop within 30 days
 *   of completion. Not blame: a comeback may be a new problem. The newest jobs may not have had their 30 days yet;
 * - **rating**: approved workshop reviews written in the range.
 */
type Row = Record<string, unknown>;

interface Bounds {
  from: string;
  to: string;
}
const between = (column: string, b: Bounds) =>
  sql`${sql.raw(column)} >= ${b.from}::timestamptz and ${sql.raw(column)} < ${b.to}::timestamptz`;
const medianInt = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.max(0, Math.round(n));
};

export function emptyWorkshopStats(): WorkshopStats {
  return {
    requests: 0,
    byMode: { workshop: 0, home: 0 },
    funnel: {
      requested: 0,
      proposed: 0,
      confirmed: 0,
      received: 0,
      estimateSent: 0,
      approved: 0,
      completed: 0,
    },
    cancelled: 0,
    cancelReasons: [],
    rejected: 0,
    rejectReasons: [],
    offersProposed: 0,
    offersDeclined: 0,
    medianMinutesToPropose: null,
    medianMinutesToEstimate: null,
    medianMinutesJob: null,
    estimates: 0,
    estimatesWithDeclinedLine: 0,
    linesSent: 0,
    linesApproved: 0,
    linesSentPaise: 0,
    linesApprovedPaise: 0,
    billed: 0,
    billedPaise: 0,
    visitFeesPaise: 0,
    paidCash: 0,
    paidUpi: 0,
    paidCard: 0,
    billsUnpaid: 0,
    ratingTenths: null,
    ratingCount: 0,
    completedJobs: 0,
    returnedWithin30Days: 0,
    withPhotos: 0,
  };
}

/** Per-request facts, then one grouped row per workshop plus (grouping sets) one row for all of them. */
function statsQuery(cities: AnalyticsCities, b: Bounds, workshopId: string | null): SQL {
  const only = workshopId ? sql`and sr.workshop_id = ${workshopId}::uuid` : sql``;
  return sql`
    with r as (
      select sr.id, sr.workshop_id, sr.service_mode, sr.status, sr.visit_fee_paise, sr.visit_fee_waived_reason,
        sr.user_id, sr.vehicle_id, sr.vehicle_key, sr.completed_at, sr.created_at
      from service_requests sr
      where ${analyticsCityFilter('sr.city_id', cities)} and ${between('sr.created_at', b)}
        and sr.workshop_id is not null ${only}
    ),
    x as (
      select r.*, ev.awaiting_at, ev.recv_at, ev.est_at, ev.ready_at, ev.f_confirmed, ev.f_approved, ev.f_done,
        p.first_at, le.id as est_id, li.lines, li.approved, li.declined, li.sent_paise, li.approved_paise,
        sb.total_paise as bill_paise, sb.paid_at, sb.method,
        exists (select 1 from service_photos ph where ph.request_id = r.id and ph.deleted_at is null) as has_photo,
        (r.completed_at is not null and r.status in ('paid', 'completed') and exists (
          select 1 from service_requests n
          where n.user_id = r.user_id and n.workshop_id = r.workshop_id and n.id <> r.id
            and n.status not in ('cancelled', 'rejected')
            and n.created_at > r.completed_at and n.created_at <= r.completed_at + interval '30 days'
            and ((r.vehicle_id is not null and n.vehicle_id = r.vehicle_id)
              or (r.vehicle_id is null and n.vehicle_key = r.vehicle_key)))) as returned
      from r
      left join lateral (
        select max(e.created_at) filter (where e.to_status = 'awaiting_workshop') as awaiting_at,
          min(e.created_at) filter (where e.to_status = 'vehicle_received') as recv_at,
          min(e.created_at) filter (where e.to_status = 'estimate_sent') as est_at,
          min(e.created_at) filter (where e.to_status = 'ready') as ready_at,
          coalesce(bool_or(e.to_status = 'confirmed'), false) as f_confirmed,
          coalesce(bool_or(e.to_status = 'approved'), false) as f_approved,
          coalesce(bool_or(e.to_status in ('paid', 'completed')), false) as f_done
        from service_events e where e.request_id = r.id) ev on true
      left join lateral (
        select min(pr.created_at) as first_at from service_proposals pr
        where pr.request_id = r.id and pr.workshop_id = r.workshop_id
          and pr.created_at >= coalesce(ev.awaiting_at, r.created_at)) p on true
      left join lateral (
        select e.id from estimates e where e.request_id = r.id order by e.revision desc limit 1) le on true
      left join lateral (
        select count(*) as lines, count(*) filter (where i.decision = 'approved') as approved,
          count(*) filter (where i.decision = 'declined') as declined,
          coalesce(sum(i.qty * i.unit_paise), 0) as sent_paise,
          coalesce(sum(i.qty * i.unit_paise) filter (where i.decision = 'approved'), 0) as approved_paise
        from estimate_items i where i.estimate_id = le.id) li on le.id is not null
      left join service_bills sb on sb.request_id = r.id
    )
    select x.workshop_id,
      count(*)::int as received,
      count(*) filter (where service_mode = 'home')::int as home,
      count(*) filter (where first_at is not null)::int as proposed,
      count(*) filter (where f_confirmed)::int as confirmed,
      count(*) filter (where recv_at is not null)::int as vehicle_received,
      count(*) filter (where est_at is not null)::int as estimate_sent,
      count(*) filter (where f_approved)::int as approved_n,
      count(*) filter (where f_done)::int as done,
      count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*) filter (where status = 'rejected')::int as rejected,
      percentile_cont(0.5) within group (order by extract(epoch from (first_at - coalesce(awaiting_at, created_at))) / 60)
        filter (where first_at is not null) as median_propose,
      percentile_cont(0.5) within group (order by extract(epoch from (est_at - recv_at)) / 60)
        filter (where est_at is not null and recv_at is not null) as median_estimate,
      percentile_cont(0.5) within group (order by extract(epoch from (ready_at - recv_at)) / 60)
        filter (where ready_at is not null and recv_at is not null) as median_job,
      count(*) filter (where est_id is not null)::int as estimates,
      count(*) filter (where declined > 0)::int as estimates_declined,
      coalesce(sum(lines), 0)::int as lines_sent,
      coalesce(sum(approved), 0)::int as lines_approved,
      coalesce(sum(sent_paise), 0)::bigint as lines_sent_paise,
      coalesce(sum(approved_paise), 0)::bigint as lines_approved_paise,
      count(*) filter (where bill_paise is not null)::int as billed,
      coalesce(sum(bill_paise), 0)::bigint as billed_paise,
      coalesce(sum(visit_fee_paise) filter (where bill_paise is not null and visit_fee_waived_reason is null), 0)::bigint as visit_fees,
      count(*) filter (where paid_at is not null and method = 'cash')::int as paid_cash,
      count(*) filter (where paid_at is not null and method = 'upi')::int as paid_upi,
      count(*) filter (where paid_at is not null and method = 'card')::int as paid_card,
      count(*) filter (where bill_paise is not null and paid_at is null)::int as bills_unpaid,
      count(*) filter (where completed_at is not null and status in ('paid', 'completed'))::int as completed_jobs,
      count(*) filter (where returned)::int as returned,
      count(*) filter (where has_photo and recv_at is not null)::int as with_photos
    from x
    group by grouping sets ((x.workshop_id), ())`;
}

/** Requests a workshop declined (they moved on, so they are no longer assigned to it), per decliner. */
async function declines(db: Tx, cities: AnalyticsCities, b: Bounds, workshopId: string | null) {
  const only = workshopId ? sql`and e.payload->>'declinedBy' = ${workshopId}` : sql``;
  const rows = rowsOf<{ wid: string; declined: unknown }>(
    await db.execute(sql`
      select e.payload->>'declinedBy' as wid, count(distinct sr.id)::int as declined
      from service_requests sr
      join service_events e on e.request_id = sr.id and e.to_status = 'needs_routing'
      where ${analyticsCityFilter('sr.city_id', cities)} and ${between('sr.created_at', b)}
        and e.payload->>'declinedBy' is not null ${only}
        and sr.workshop_id is distinct from (e.payload->>'declinedBy')::uuid
      group by 1`),
  );
  return new Map(rows.map((r) => [r.wid, num(r.declined)]));
}

async function reasons(db: Tx, cities: AnalyticsCities, b: Bounds, workshopId: string | null) {
  const only = workshopId ? sql`and sr.workshop_id = ${workshopId}::uuid` : sql``;
  const rows = rowsOf<{ wid: string; status: string; code: string; n: unknown }>(
    await db.execute(sql`
      select sr.workshop_id as wid, sr.status, sr.status_reason_code as code, count(*)::int as n
      from service_requests sr
      where ${analyticsCityFilter('sr.city_id', cities)} and ${between('sr.created_at', b)}
        and sr.workshop_id is not null and sr.status in ('cancelled', 'rejected')
        and sr.status_reason_code is not null ${only}
      group by 1, 2, 3 order by n desc, code`),
  );
  return rows;
}

async function ratings(db: Tx, cities: AnalyticsCities, b: Bounds, workshopId: string | null) {
  const only = workshopId ? sql`and w.id = ${workshopId}::uuid` : sql``;
  const rows = rowsOf<{ wid: string; n: unknown; tenths: unknown }>(
    await db.execute(sql`
      select rv.target_id as wid, count(*)::int as n, round(avg(rv.rating) * 10)::int as tenths
      from reviews rv
      where rv.target_type = 'workshop' and rv.status = 'approved' and ${between('rv.created_at', b)}
        and rv.target_id in (select w.id from workshops w where ${analyticsCityFilter('w.city_id', cities)} ${only})
      group by 1`),
  );
  return new Map(rows.map((r) => [r.wid, { n: num(r.n), tenths: num(r.tenths) }]));
}

function statsOf(
  r: Row | undefined,
  declined: number,
  reasonRows: readonly { status: string; code: string; n: unknown }[],
  rating: { n: number; tenths: number } | undefined,
): WorkshopStats {
  const base = emptyWorkshopStats();
  if (!r && declined === 0 && !rating) return base;
  const g = (k: string) => (r ? num(r[k] ?? 0) : 0);
  const requests = g('received') + declined;
  const reasonList = (status: string) =>
    reasonRows.filter((x) => x.status === status).map((x) => ({ code: x.code, count: num(x.n) }));
  return {
    ...base,
    requests,
    byMode: { workshop: g('received') - g('home'), home: g('home') },
    funnel: {
      requested: requests,
      proposed: g('proposed'),
      confirmed: g('confirmed'),
      received: g('vehicle_received'),
      estimateSent: g('estimate_sent'),
      approved: g('approved_n'),
      completed: g('done'),
    },
    cancelled: g('cancelled'),
    cancelReasons: reasonList('cancelled'),
    rejected: g('rejected'),
    rejectReasons: reasonList('rejected'),
    offersProposed: g('proposed'),
    offersDeclined: declined,
    medianMinutesToPropose: medianInt(r?.median_propose),
    medianMinutesToEstimate: medianInt(r?.median_estimate),
    medianMinutesJob: medianInt(r?.median_job),
    estimates: g('estimates'),
    estimatesWithDeclinedLine: g('estimates_declined'),
    linesSent: g('lines_sent'),
    linesApproved: g('lines_approved'),
    linesSentPaise: g('lines_sent_paise'),
    linesApprovedPaise: g('lines_approved_paise'),
    billed: g('billed'),
    billedPaise: g('billed_paise'),
    visitFeesPaise: g('visit_fees'),
    paidCash: g('paid_cash'),
    paidUpi: g('paid_upi'),
    paidCard: g('paid_card'),
    billsUnpaid: g('bills_unpaid'),
    ratingTenths: rating?.tenths ?? null,
    ratingCount: rating?.n ?? 0,
    completedJobs: g('completed_jobs'),
    returnedWithin30Days: g('returned'),
    withPhotos: g('with_photos'),
  };
}

export interface WorkshopAnalyticsResult {
  /** Every workshop of the cities (also those without requests), by name. */
  workshops: (WorkshopStats & { id: string; name: string; nameHi: string | null })[];
  /** All of them together (medians are true medians over every request). */
  totals: WorkshopStats;
}

async function statsIn(
  db: Tx,
  input: { cityIds: AnalyticsCities; range: AnalyticsRange; workshopId: string | null },
): Promise<WorkshopAnalyticsResult> {
  const { fromInstant, toInstant } = analyticsDays(input.range);
  const b: Bounds = { from: fromInstant.toISOString(), to: toInstant.toISOString() };
  const wid = input.workshopId;
  // One query at a time in one transaction: a report holds a single pooled connection.
  const grouped = rowsOf<Row>(await db.execute(statsQuery(input.cityIds, b, wid)));
  const declined = await declines(db, input.cityIds, b, wid);
  const reasonRows = await reasons(db, input.cityIds, b, wid);
  const rated = await ratings(db, input.cityIds, b, wid);
  const only = wid ? sql`and w.id = ${wid}::uuid` : sql``;
  const named = rowsOf<{ id: string; name: string; name_hi: string | null }>(
    await db.execute(sql`select w.id, w.name, w.name_hi from workshops w
      where ${analyticsCityFilter('w.city_id', input.cityIds)} ${only} order by w.name, w.id limit 500`),
  );
  const byId = new Map(grouped.filter((r) => r.workshop_id !== null).map((r) => [String(r.workshop_id), r]));
  const total = grouped.find((r) => r.workshop_id === null);
  const declinedAll = [...declined.values()].reduce((a, v) => a + v, 0);
  const ratedAll = [...rated.values()].reduce((a, v) => ({ n: a.n + v.n, sum: a.sum + v.n * v.tenths }), {
    n: 0,
    sum: 0,
  });
  const totals = statsOf(
    total,
    declinedAll,
    mergeReasons(reasonRows),
    ratedAll.n > 0 ? { n: ratedAll.n, tenths: Math.round(ratedAll.sum / ratedAll.n) } : undefined,
  );
  return {
    totals,
    workshops: named.map((w) => ({
      id: w.id,
      name: w.name,
      nameHi: w.name_hi,
      ...statsOf(
        byId.get(w.id),
        declined.get(w.id) ?? 0,
        reasonRows.filter((x) => x.wid === w.id),
        rated.get(w.id),
      ),
    })),
  };
}

/** The same reason code across workshops added up (for the all-workshops total). */
function mergeReasons(rows: readonly { status: string; code: string; n: unknown }[]) {
  const out = new Map<string, { status: string; code: string; n: number }>();
  for (const r of rows) {
    const key = `${r.status}/${r.code}`;
    const cur = out.get(key);
    if (cur) cur.n += num(r.n);
    else out.set(key, { status: r.status, code: r.code, n: num(r.n) });
  }
  return [...out.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
}

/** Every workshop of the cities for an IST range (the admin table, and the city medians of the portal). */
export function cityWorkshopAnalytics(
  db: Tx,
  input: { cityIds: AnalyticsCities; range: AnalyticsRange; timeoutMs?: number },
): Promise<WorkshopAnalyticsResult> {
  return readOnlyReport(db, (tx) => statsIn(tx, { ...input, workshopId: null }), input.timeoutMs);
}

/** One workshop's numbers (the portal): the workshop's own rows only, found by its id and city. */
export async function ownWorkshopAnalytics(
  db: Tx,
  input: { cityId: string; workshopId: string; range: AnalyticsRange; timeoutMs?: number },
): Promise<WorkshopAnalyticsResult['workshops'][number] | null> {
  const out = await readOnlyReport(
    db,
    (tx) => statsIn(tx, { cityIds: [input.cityId], range: input.range, workshopId: input.workshopId }),
    input.timeoutMs,
  );
  return out.workshops[0] ?? null;
}

/** The workshop's city (portal: its own numbers are read inside this city), null when it does not exist. */
export async function workshopCityId(db: Tx, workshopId: string): Promise<string | null> {
  const [r] = rowsOf<{ city_id: string }>(
    await db.execute(sql`select city_id from workshops where id = ${workshopId}::uuid`),
  );
  return r?.city_id ?? null;
}
