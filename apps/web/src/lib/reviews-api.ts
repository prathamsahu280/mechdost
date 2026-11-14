import type { ReviewHideReason, ReviewStatus, ReviewTargetType } from '@mechdost/shared/reviews';
import {
  AdminReviewsDto,
  ReviewCreatedDto,
  ReviewModeratedDto,
  ReviewTargetsDto,
  type AdminReviews,
  type ReviewTargets,
} from '@mechdost/shared/reviews-api';
import { adminApi, type AdminResult } from './admin-api';
import { authed, type ApiResult } from './orders-api';

/**
 * The review calls of the real-API screens (spec 02 § Reviews): the customer's targets and new review, the staff
 * moderation queue. Answers are checked with the shared response schemas (hard rule 4); errors come back as the
 * API's code for the screen to translate (`reviewErrorKey`, `commonErrorKey`). Loaded only by lazy screens.
 */
export type ReviewPurchase = { orderCode: string } | { serviceCode: string };

export function fetchReviewTargets(
  locale: string,
  purchase: ReviewPurchase,
): Promise<ApiResult<ReviewTargets>> {
  const p = new URLSearchParams({ locale: locale === 'hi' ? 'hi' : 'en' });
  if ('orderCode' in purchase) p.set('order', purchase.orderCode);
  else p.set('service', purchase.serviceCode);
  return authed(locale, `/my-reviews/eligible?${p.toString()}`, ReviewTargetsDto);
}

export function submitReview(
  locale: string,
  input: {
    purchase: ReviewPurchase;
    targetType: ReviewTargetType;
    targetSlug: string;
    rating: number;
    body: string;
  },
) {
  const body = input.body.trim();
  return authed(locale, '/my-reviews', ReviewCreatedDto, {
    method: 'POST',
    body: {
      ...input.purchase,
      targetType: input.targetType,
      targetSlug: input.targetSlug,
      rating: input.rating,
      body: body.length > 0 ? body : null,
    },
  });
}

export function fetchReviewQueue(
  locale: string,
  status: ReviewStatus,
  cursor?: string,
): Promise<AdminResult<AdminReviews>> {
  const p = new URLSearchParams({ status, limit: '30' });
  if (cursor) p.set('cursor', cursor);
  return adminApi(locale, `/admin/reviews?${p.toString()}`, AdminReviewsDto);
}

export function moderateReview(
  locale: string,
  id: string,
  body: { to: 'approved' | 'hidden'; version: number; reasonCode?: ReviewHideReason; note?: string },
) {
  return adminApi(locale, `/admin/reviews/${encodeURIComponent(id)}/moderate`, ReviewModeratedDto, {
    method: 'POST',
    body,
  });
}
