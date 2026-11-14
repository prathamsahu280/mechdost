import type { ReviewStatus } from '@mechdost/shared/reviews';
import type { RatingSummaryApi } from '@mechdost/shared/reviews-api';

/**
 * Pure helpers for the review screens in real-API mode (spec 02 § Reviews): API error codes → `reviews.api_err_*`
 * keys, the rating distribution as whole percentages, and the status line of the customer's own review.
 */
export type ReviewErrorKey =
  | 'api_err_exists'
  | 'api_err_limit'
  | 'api_err_eligible'
  | 'api_err_rate'
  | 'api_err_auth'
  | 'api_err_verify'
  | 'api_err_network'
  | 'api_err_generic';

const BY_CODE: Record<string, ReviewErrorKey> = {
  REVIEW_EXISTS: 'api_err_exists',
  REVIEW_DAILY_LIMIT: 'api_err_limit',
  REVIEW_NOT_ELIGIBLE: 'api_err_eligible',
  RATE_LIMITED: 'api_err_rate',
  HTTP_429: 'api_err_rate',
  AUTH_REQUIRED: 'api_err_auth',
  HTTP_401: 'api_err_auth',
  VERIFICATION_REQUIRED: 'api_err_verify',
  NETWORK: 'api_err_network',
  UNAVAILABLE: 'api_err_network',
};

export function reviewErrorKey(code: string): ReviewErrorKey {
  return BY_CODE[code] ?? (/^HTTP_5\d\d$/.test(code) ? 'api_err_network' : 'api_err_generic');
}

/** One row per star level, 5★ first, as whole percentages of the approved reviews. */
export function reviewShares(summary: RatingSummaryApi): { stars: number; percent: number }[] {
  return summary.distribution.map((n, i) => ({
    stars: 5 - i,
    percent: summary.count > 0 ? Math.round((n / summary.count) * 100) : 0,
  }));
}

export function reviewStatusKey(
  status: ReviewStatus,
): 'api_status_pending' | 'api_status_approved' | 'api_status_hidden' {
  return `api_status_${status}`;
}
