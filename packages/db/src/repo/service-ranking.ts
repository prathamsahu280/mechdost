import { sql, type SQL } from 'drizzle-orm';
import {
  rankWorkshops,
  RANK_RADIUS_KM,
  type RankCandidate,
  type RankedWorkshop,
} from '@mechdost/shared/workshop-ranking';
import { ConflictError, NotFoundError } from './errors';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, numOrNull, rowsOf } from './sql-rows';
import type { ServiceLocale } from './service-requests';

/**
 * Ranked workshop suggestions for admin routing of a service request (spec 06 "Ranking", spec 08; design 2026-11-15
 * item 7). Two statements however many workshops there are (no N+1):
 * 1. the eligible candidates of the request's city with their distance (PostGIS `ST_Distance` on the geography column,
 *    pre-filtered by `ST_DWithin` so the GiST index serves it), rating, busy flag, capacity and open jobs (correlated
 *    count on `(workshop_id, status)`);
 * 2. their acceptance and median time to propose over the last 90 days, from `service_proposals` and the append-only
 *    `service_events` of requests created in that window (`(city_id, created_at)` index, then `(request_id, id)`).
 * Eligibility is decided in SQL (same rules as `reassignServiceRequest`: published, location verified, `approved`,
 * not busy, same city, serves the vehicle type, a home visit only inside the workshop's home radius); the pure
 * `rankWorkshops` (packages/shared) then scores and orders them, and repeats the busy / paused / suspended exclusion.
 * A foreign-city request code is a 404. Read only.
 */
const ROUTABLE = ['needs_routing', 'awaiting_workshop', 'proposed'] as const;
const OPEN_JOB_STATES = `'awaiting_workshop','proposed','confirmed','vehicle_received','estimate_sent','approved',
  'no_work_approved','in_progress','ready','billed'`;
const WINDOW_DAYS = 90;
const MAX_SUGGESTIONS = 10;

export interface WorkshopSuggestionView extends RankedWorkshop {
  slug: string;
  name: string;
  pincode: string;
  distanceM: number | null;
  ratingX100: number | null;
  acceptancePercent: number | null;
  medianMinutesToPropose: number | null;
  openJobs: number;
  slotCapacity: number;
}

const inScope = (scope: CityScope): SQL =>
  scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`sr.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

interface CandidateRow {
  id: string;
  slug: string;
  name: string;
  name_hi: string | null;
  pincode: string;
  status: string;
  busy: boolean;
  slot_capacity: number;
  rating_avg: string | null;
  rating_count: number;
  distance_m: unknown;
  open_jobs: unknown;
}

export async function suggestWorkshopsForRequest(
  db: Tx,
  scope: CityScope,
  code: string,
  locale: ServiceLocale,
): Promise<WorkshopSuggestionView[]> {
  // A code outside the staff member's cities is the same 404 as a code that does not exist.
  const [scoped] = rowsOf<{ id: string; status: string }>(
    await db.execute(
      sql`select sr.id, sr.status from service_requests sr where sr.code = ${code} and ${inScope(scope)}`,
    ),
  );
  if (!scoped) throw new NotFoundError('Service request not found');
  if (!(ROUTABLE as readonly string[]).includes(scoped.status))
    throw new ConflictError(`This request is ${scoped.status.replace(/_/g, ' ')}`, 'WRONG_STEP');

  const candidates = rowsOf<CandidateRow>(
    await db.execute(sql`
      select w.id, w.slug, w.name, w.name_hi, w.pincode, w.status, w.busy, w.slot_capacity, w.rating_avg::text,
        w.rating_count,
        case when sr.location is not null then round(ST_Distance(w.location, sr.location)) end as distance_m,
        (select count(*) from service_requests j where j.workshop_id = w.id
          and j.status in (${sql.raw(OPEN_JOB_STATES)})) as open_jobs
      from service_requests sr
      join workshops w on w.city_id = sr.city_id
      where sr.id = ${scoped.id}
        and w.published and w.location_verified and w.status = 'approved' and not w.busy
        and w.vehicle_types @> array[sr.vehicle_type]::text[]
        and (sr.location is null or ST_DWithin(w.location, sr.location, ${RANK_RADIUS_KM * 1000}))
        and (sr.service_mode <> 'home' or (w.home_service and sr.location is not null
          and ST_DWithin(w.location, sr.location, w.home_radius_km * 1000)))`),
  );
  if (candidates.length === 0) return [];

  const ids = sql.join(
    candidates.map((c) => sql`${c.id}::uuid`),
    sql`, `,
  );
  const stats = rowsOf<{ wid: string; proposed: unknown; unanswered: unknown; median: unknown }>(
    await db.execute(sql`
      with win as (
        select r.id from service_requests r
        where r.city_id = (select city_id from service_requests where id = ${scoped.id})
          and r.created_at >= now() - make_interval(days => ${WINDOW_DAYS})
      ),
      prop as (
        select pr.workshop_id as wid, count(*) as proposed,
          percentile_cont(0.5) within group (order by extract(epoch from (pr.created_at - aw.at)) / 60)
            filter (where aw.at is not null) as median
        from service_proposals pr
        join win on win.id = pr.request_id
        left join lateral (
          select max(e.created_at) as at from service_events e
          where e.request_id = pr.request_id and e.to_status = 'awaiting_workshop' and e.created_at <= pr.created_at) aw on true
        where pr.workshop_id in (${ids})
        group by 1
      ),
      lost as (
        select coalesce(e.payload ->> 'declinedBy', e.payload ->> 'expiredWorkshopId') as wid, count(*) as unanswered
        from service_events e
        join win on win.id = e.request_id
        where e.to_status = 'needs_routing'
          and coalesce(e.payload ->> 'declinedBy', e.payload ->> 'expiredWorkshopId') in (${sql.join(
            candidates.map((c) => sql`${c.id}`),
            sql`, `,
          )})
        group by 1
      )
      select coalesce(p.wid::text, l.wid) as wid, coalesce(p.proposed, 0) as proposed,
        coalesce(l.unanswered, 0) as unanswered, p.median
      from prop p full join lost l on l.wid = p.wid::text`),
  );
  const byWorkshop = new Map(stats.map((s) => [s.wid, s]));

  const view = new Map<string, WorkshopSuggestionView['name']>();
  const rankInput: RankCandidate[] = candidates.map((c) => {
    const s = byWorkshop.get(c.id);
    const proposed = s ? num(s.proposed) : 0;
    const unanswered = s ? num(s.unanswered) : 0;
    view.set(c.id, locale === 'hi' && c.name_hi ? c.name_hi : c.name);
    return {
      workshopId: c.id,
      distanceM: numOrNull(c.distance_m),
      ratingX100:
        c.rating_avg === null || c.rating_count === 0 ? null : Math.round(Number(c.rating_avg) * 100),
      acceptancePercent:
        proposed + unanswered === 0 ? null : Math.round((proposed * 100) / (proposed + unanswered)),
      medianMinutesToPropose: numOrNull(s?.median) === null ? null : Math.max(0, Math.round(num(s?.median))),
      openJobs: num(c.open_jobs),
      slotCapacity: c.slot_capacity,
      busy: c.busy,
      status: c.status,
    };
  });
  const byId = new Map(rankInput.map((c) => [c.workshopId, c]));
  const meta = new Map(candidates.map((c) => [c.id, c]));
  return rankWorkshops(rankInput)
    .slice(0, MAX_SUGGESTIONS)
    .map((r) => {
      const c = byId.get(r.workshopId);
      const m = meta.get(r.workshopId);
      return {
        ...r,
        slug: m?.slug ?? '',
        name: view.get(r.workshopId) ?? '',
        pincode: m?.pincode ?? '',
        distanceM: c?.distanceM ?? null,
        ratingX100: c?.ratingX100 ?? null,
        acceptancePercent: c?.acceptancePercent ?? null,
        medianMinutesToPropose: c?.medianMinutesToPropose ?? null,
        openJobs: c?.openJobs ?? 0,
        slotCapacity: c?.slotCapacity ?? 1,
      };
    });
}
