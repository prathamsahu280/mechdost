import {
  AdminOverviewDto,
  AnalyticsDashboardDto,
  type AdminOverview,
  type AnalyticsDashboard,
} from '@mechdost/shared/admin-analytics-api';
import { adminApi, type AdminResult } from './admin-api';

/**
 * Admin analytics calls of the real sign-in screens (spec 08 "Analytics"): the dashboard for a city and IST date
 * range, and the Overview queue counts. Answers are checked with the shared response schemas (hard rule 4). Loaded
 * only by the lazy admin screens, so the schemas never reach other pages.
 */
export function fetchAnalyticsDashboard(
  locale: string,
  q: { city: string | null; from: string; to: string },
): Promise<AdminResult<AnalyticsDashboard>> {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.city) p.set('city', q.city);
  return adminApi(locale, `/admin/analytics/dashboard?${p.toString()}`, AnalyticsDashboardDto);
}

export function fetchAdminOverview(locale: string): Promise<AdminResult<AdminOverview>> {
  return adminApi(locale, '/admin/overview', AdminOverviewDto);
}
