/**
 * Response shapes of the review routes (`apps/api/src/routes/reviews.ts`), for the website in real-API mode to
 * validate what it receives (hard rule 4). Loaded only by real-mode server components and lazy screens, never by
 * demo pages. Times are ISO strings. Review text and reviewer names are user content (never translated).
 */
import { z } from 'zod';
import { REVIEW_HIDE_REASONS, REVIEW_STATES, REVIEW_TARGETS } from './reviews';

const Rating = z.number().int().min(1).max(5);
const Target = z.enum(REVIEW_TARGETS);
const Status = z.enum(REVIEW_STATES);

// ── Public (/v1/reviews/{product|workshop}/{slug}) ────────────────────────────────────────────────────────────

/** Approved reviews only; `distribution[0]` counts 5-star reviews … `distribution[4]` 1-star ones. */
export const RatingSummaryDto = z.object({
  avg: z.number().nullable(),
  count: z.number().int().min(0),
  distribution: z.array(z.number().int().min(0)).length(5),
});
export type RatingSummaryApi = z.infer<typeof RatingSummaryDto>;

export const PublicReviewDto = z.object({
  id: z.string(),
  rating: Rating,
  body: z.string().nullable(),
  /** "Ravi S." — null when the customer gave no name. */
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicReview = z.infer<typeof PublicReviewDto>;

export const PublicReviewsDto = z.object({
  summary: RatingSummaryDto,
  reviews: z.array(PublicReviewDto),
  nextCursor: z.string().nullable(),
});
export type PublicReviews = z.infer<typeof PublicReviewsDto>;

// ── Customer (/v1/my-reviews) ─────────────────────────────────────────────────────────────────────────────────

export const MyReviewDto = z.object({
  id: z.string(),
  rating: Rating,
  body: z.string().nullable(),
  status: Status,
  createdAt: z.string(),
});
export type MyReview = z.infer<typeof MyReviewDto>;

/** What the customer may review for one delivered order or completed service, with what they already wrote. */
export const ReviewTargetsDto = z.object({
  targets: z.array(
    z.object({
      targetType: Target,
      slug: z.string(),
      name: z.string(),
      review: MyReviewDto.nullable(),
    }),
  ),
});
export type ReviewTargets = z.infer<typeof ReviewTargetsDto>;
export type ReviewTargetItem = ReviewTargets['targets'][number];

export const ReviewCreatedDto = z.object({ id: z.string(), status: Status });
export type ReviewCreated = z.infer<typeof ReviewCreatedDto>;

// ── Staff (/v1/admin/reviews) ─────────────────────────────────────────────────────────────────────────────────

export const AdminReviewDto = z.object({
  id: z.string(),
  targetType: Target,
  targetSlug: z.string(),
  targetName: z.string(),
  rating: Rating,
  body: z.string().nullable(),
  author: z.string().nullable(),
  status: Status,
  hiddenReason: z.enum(REVIEW_HIDE_REASONS).nullable(),
  note: z.string().nullable(),
  orderCode: z.string().nullable(),
  serviceCode: z.string().nullable(),
  createdAt: z.string(),
  moderatedAt: z.string().nullable(),
  version: z.number().int(),
});
export type AdminReview = z.infer<typeof AdminReviewDto>;

export const AdminReviewsDto = z.object({
  reviews: z.array(AdminReviewDto),
  nextCursor: z.string().nullable(),
});
export type AdminReviews = z.infer<typeof AdminReviewsDto>;

export const ReviewModeratedDto = z.object({ status: Status, version: z.number().int() });
export type ReviewModerated = z.infer<typeof ReviewModeratedDto>;
