import { describe, expect, it } from 'vitest';
import { cleanReviewBody, REVIEW_BODY_MAX, REVIEW_STATES, reviewerName, reviewMachine } from '../src/reviews';
import { AdminReviewsDto, PublicReviewsDto, ReviewTargetsDto } from '../src/reviews-api';

describe('review state machine', () => {
  it('only staff move a review; every pair is either allowed for admin or illegal', () => {
    const allowed = new Set(['pending>approved', 'pending>hidden', 'approved>hidden', 'hidden>approved']);
    for (const from of REVIEW_STATES)
      for (const to of REVIEW_STATES) {
        const key = `${from}>${to}`;
        expect(reviewMachine.can(from, to)).toBe(allowed.has(key));
        if (allowed.has(key)) {
          expect(reviewMachine.canActor(from, to, 'admin')).toBe(true);
          expect(reviewMachine.canActor(from, to, 'customer')).toBe(false);
        }
      }
  });
});

describe('review text', () => {
  it('is plain text: control and invisible characters removed, trimmed, empty → null, capped', () => {
    expect(cleanReviewBody('  Good\u0000 part‮, fast\n delivery ')).toBe('Good part, fast delivery');
    expect(cleanReviewBody('   ')).toBeNull();
    expect(cleanReviewBody(null)).toBeNull();
    expect(cleanReviewBody('x'.repeat(REVIEW_BODY_MAX + 50))?.length).toBe(REVIEW_BODY_MAX);
    // Hindi conjuncts keep ZWJ/ZWNJ.
    expect(cleanReviewBody('बढ़िया‍सर्विस')).toBe('बढ़िया‍सर्विस');
  });

  it('shows the reviewer as first name and last initial', () => {
    expect(reviewerName('Ravi Kumar Sahu')).toBe('Ravi S.');
    expect(reviewerName('Asha')).toBe('Asha');
    expect(reviewerName('  ')).toBeNull();
    expect(reviewerName(null)).toBeNull();
  });
});

describe('review response schemas', () => {
  const at = '2026-11-14T10:00:00.000Z';
  it('accept the API shapes', () => {
    expect(
      PublicReviewsDto.safeParse({
        summary: { avg: 4.5, count: 2, distribution: [1, 1, 0, 0, 0] },
        reviews: [{ id: 'r1', rating: 5, body: null, author: 'Ravi S.', createdAt: at }],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      ReviewTargetsDto.safeParse({
        targets: [{ targetType: 'product', slug: 'castrol-activ', name: 'Activ', review: null }],
      }).success,
    ).toBe(true);
    expect(
      AdminReviewsDto.safeParse({
        reviews: [
          {
            id: 'r1',
            targetType: 'workshop',
            targetSlug: 'w',
            targetName: 'W',
            rating: 3,
            body: 'ok',
            author: null,
            status: 'hidden',
            hiddenReason: 'spam',
            note: null,
            orderCode: null,
            serviceCode: 'SR-RPR-2026-7K3Q9X',
            createdAt: at,
            moderatedAt: at,
            version: 2,
          },
        ],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it('refuse a rating outside 1–5 and a short distribution', () => {
    expect(
      PublicReviewsDto.safeParse({
        summary: { avg: 4, count: 1, distribution: [1, 0, 0, 0] },
        reviews: [],
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      PublicReviewsDto.safeParse({
        summary: { avg: null, count: 0, distribution: [0, 0, 0, 0, 0] },
        reviews: [{ id: 'r', rating: 6, body: null, author: null, createdAt: at }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
