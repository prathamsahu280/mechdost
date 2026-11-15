import { eq, sql } from 'drizzle-orm';
import { DEFAULT_ACCEPTANCE_TIMEOUT_MIN } from '@mechdost/shared/workshop-slots';
import { serviceRequests } from '../schema';
import { settingOr } from './checkout';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { lockRequest, transitionRequest } from './service-requests';
import { num, rowsOf } from './sql-rows';

/**
 * Acceptance timeout for service requests (spec 06, workshops tier 1; the shop offer timer's twin). A request waits in
 * `awaiting_workshop` for `service.acceptance_timeout_min` minutes (per city, default 60) counted from the moment it
 * got there (the latest event into that status, so a reschedule restarts the clock); after that the worker sends it
 * back to routing (`needs_routing`, actor system) with an event that names the workshop and the reason. The deadline is
 * compared on the database clock. Each expiry is its own transaction and a compare-and-set on the request, so
 * several workers may run this safely and one bad row never blocks the rest.
 */
const SETTING = { key: 'service.acceptance_timeout_min', fallback: DEFAULT_ACCEPTANCE_TIMEOUT_MIN };

/** Whole minutes since the request entered `awaiting_workshop` (database clock). */
async function minutesWaiting(tx: Tx, requestId: string): Promise<number> {
  const [row] = rowsOf<{ waited_s: unknown }>(
    await tx.execute(sql`select extract(epoch from (now() - coalesce(
        (select max(e.created_at) from service_events e where e.request_id = r.id and e.to_status = 'awaiting_workshop'),
        r.created_at))) as waited_s
      from service_requests r where r.id = ${requestId}`),
  );
  return row ? Math.floor(num(row.waited_s) / 60) : 0;
}

/** Expire one request if it is still waiting past the deadline; false when it moved on meanwhile. */
export async function expireServiceRequest(
  db: Tx,
  input: { requestId: string; timeoutMinutes: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, eq(serviceRequests.id, input.requestId));
    // Answered, cancelled or rerouted in the meantime: nothing to do.
    if (r.status !== 'awaiting_workshop' || !r.workshopId) return false;
    // The clock is read again under the lock: a request that left and re-entered the status has a fresh one.
    const waitedMinutes = await minutesWaiting(tx, r.id);
    if (waitedMinutes < input.timeoutMinutes) return false;
    const expiredWorkshopId = r.workshopId;
    await transitionRequest(tx, {
      request: r,
      to: 'needs_routing',
      expectedVersion: r.version,
      actor: { type: 'system', userId: null },
      patch: { workshopId: null },
      payload: { reason: 'acceptance_timeout', expiredWorkshopId, waitedMinutes },
      visibleToCustomer: false,
    });
    await recordServerEvent(tx, 'service_acceptance_expired', {
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: expiredWorkshopId, waitedMinutes },
    });
    return true;
  });
}

/** Worker sweep (every 30 s): expire every request past its city's deadline, oldest first. */
export async function expireDueServiceRequests(
  db: Tx,
  limit = 50,
): Promise<{ expired: number; failed: { requestId: string; error: unknown }[] }> {
  const waiting = rowsOf<{ id: string; city_id: string; waited_s: unknown }>(
    await db.execute(sql`select r.id, r.city_id,
        extract(epoch from (now() - coalesce(
          (select max(e.created_at) from service_events e where e.request_id = r.id and e.to_status = 'awaiting_workshop'),
          r.created_at))) as waited_s
      from service_requests r where r.status = 'awaiting_workshop'
      order by r.updated_at limit ${limit * 4}`),
  );
  const minutesByCity = new Map<string, number>();
  let expired = 0;
  const failed: { requestId: string; error: unknown }[] = [];
  for (const w of waiting) {
    if (expired + failed.length >= limit) break;
    let minutes = minutesByCity.get(w.city_id);
    if (minutes === undefined) {
      minutes = await settingOr(db, w.city_id, SETTING);
      minutesByCity.set(w.city_id, minutes);
    }
    if (Math.floor(num(w.waited_s) / 60) < minutes) continue;
    try {
      if (await expireServiceRequest(db, { requestId: w.id, timeoutMinutes: minutes })) expired += 1;
    } catch (error) {
      failed.push({ requestId: w.id, error });
    }
  }
  return { expired, failed };
}
