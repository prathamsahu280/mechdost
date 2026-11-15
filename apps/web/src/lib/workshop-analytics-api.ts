import {
  AdminWorkshopAnalyticsDto,
  PortalWorkshopAnalyticsDto,
  type AdminWorkshopAnalytics,
  type PortalWorkshopAnalytics,
} from '@mechdost/shared/workshop-analytics-api';
import { adminApi, type AdminResult } from './admin-api';

/**
 * Workshop analytics calls of the real sign-in screens (spec 08 "Analytics → Workshops", spec 07 "Performance"):
 * answers are checked with the shared response schemas (hard rule 4). Loaded only by the lazy screens.
 */
export function fetchAdminWorkshopAnalytics(
  locale: string,
  q: { city: string | null; from: string; to: string },
): Promise<AdminResult<AdminWorkshopAnalytics>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.city) p.set('city', q.city);
  return adminApi(locale, `/admin/analytics/workshops?${p.toString()}`, AdminWorkshopAnalyticsDto);
}

export function fetchWorkshopPerformance(
  locale: string,
  q: { from: string; to: string },
): Promise<AdminResult<PortalWorkshopAnalytics>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  return adminApi(locale, `/workshop/analytics?${p.toString()}`, PortalWorkshopAnalyticsDto);
}
