import { cityWorkshopAnalytics, type Tx, type WorkshopAnalyticsResult } from '@mechdost/db/repo';
import type { AnalyticsRange } from '@mechdost/shared/analytics-range';
import { TtlCache } from './ttl-cache';

/**
 * One city's workshop analytics for a range, cached two minutes on this instance with single flight (concurrent
 * misses share one load). The admin table and the portal's city medians read the same entry, so a busy day of
 * workshop owners opening "Performance" costs one query per (city, range). One cache per database handle.
 */
const TTL_MS = 120_000;
const caches = new WeakMap<object, TtlCache<WorkshopAnalyticsResult>>();

export function cachedCityWorkshopAnalytics(
  db: Tx,
  cityId: string,
  range: AnalyticsRange,
): Promise<WorkshopAnalyticsResult> {
  let cache = caches.get(db);
  if (!cache) {
    cache = new TtlCache<WorkshopAnalyticsResult>(TTL_MS, 200);
    caches.set(db, cache);
  }
  return cache.getOrLoad(JSON.stringify([cityId, range.fromDate, range.toDate]), () =>
    cityWorkshopAnalytics(db, { cityIds: [cityId], range }),
  );
}
