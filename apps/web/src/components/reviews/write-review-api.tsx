'use client';

import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { REVIEW_BODY_MAX } from '@mechdost/shared/reviews';
import type { MyReview, ReviewTargetItem } from '@mechdost/shared/reviews-api';
import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { reviewErrorKey, reviewStatusKey } from '@/lib/review-views';
import type { ReviewPurchase } from '@/lib/reviews-api';
import { StarRating } from './star-rating';

type Load =
  { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; targets: ReviewTargetItem[] };

/**
 * "Rate what you bought" on a delivered order or a paid service (real data mode; spec 02 § Reviews, spec 06).
 * Lists what this purchase lets the customer review (`GET /v1/my-reviews/eligible`); one form open at a time (one
 * primary action); a star rating is required, the text optional (plain text, 1000 characters). A sent review shows
 * its status (waiting for approval / published / not published). Loaded lazily by the order and service screens.
 */
export function WriteReviewApi({ kind, code }: { kind: 'order' | 'service'; code: string }) {
  const t = useTranslations('reviews');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const purchase = useMemo<ReviewPurchase>(
    () => (kind === 'order' ? { orderCode: code } : { serviceCode: code }),
    [kind, code],
  );

  const refresh = useCallback(async () => {
    const { fetchReviewTargets } = await import('@/lib/reviews-api');
    const res = await fetchReviewTargets(locale, purchase);
    setLoad(res.ok ? { kind: 'ok', targets: res.data.targets } : { kind: 'error', code: res.code });
  }, [purchase, locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const box = 'rounded-card border border-line-card bg-surface p-6 shadow-card';
  if (load.kind === 'loading')
    return (
      <p role="status" className={`${box} text-sm text-muted`}>
        {t('api_loading')}
      </p>
    );
  if (load.kind === 'error')
    return (
      <p role="alert" className={`${box} text-sm font-bold text-ink`}>
        {t(reviewErrorKey(load.code))}
      </p>
    );
  if (load.targets.length === 0) return null;

  return (
    <section aria-labelledby={`write-review-${code}`} className={box}>
      <h2 id={`write-review-${code}`} className="font-heading text-lg font-extrabold text-ink">
        {kind === 'order' ? t('api_writeTitleOrder') : t('api_writeTitleService')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('moderationNote')}</p>
      <ul className="mt-4 space-y-3">
        {load.targets.map((target) => (
          <li
            key={`${target.targetType}:${target.slug}`}
            className="rounded-tile border border-line-card p-4"
          >
            <TargetRow
              purchase={purchase}
              target={target}
              open={open === target.slug}
              onOpen={() => {
                setOpen(target.slug);
              }}
              onDone={(review) => {
                setOpen(null);
                setLoad((l) =>
                  l.kind === 'ok'
                    ? {
                        kind: 'ok',
                        targets: l.targets.map((x) => (x.slug === target.slug ? { ...x, review } : x)),
                      }
                    : l,
                );
              }}
              onStale={refresh}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TargetRow({
  purchase,
  target,
  open,
  onOpen,
  onDone,
  onStale,
}: {
  purchase: ReviewPurchase;
  target: ReviewTargetItem;
  open: boolean;
  onOpen: () => void;
  onDone: (review: MyReview) => void;
  onStale: () => Promise<void>;
}) {
  const t = useTranslations('reviews');
  const locale = useLocale();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `review-${target.targetType}-${target.slug}`;

  if (target.review)
    return (
      <div>
        <p data-user-content className="font-heading font-bold text-ink">
          {target.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StarRating rating={target.review.rating} label={t('average', { rating: target.review.rating })} />
          <span role="status" className="text-sm text-muted">
            {t(reviewStatusKey(target.review.status))}
          </span>
        </div>
      </div>
    );

  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-user-content className="font-heading font-bold text-ink">
          {target.name}
        </p>
        <button
          type="button"
          onClick={onOpen}
          data-track={`review_open_${target.targetType}`}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-5 text-sm font-bold text-ink hover:bg-pill"
        >
          {t('write')}
        </button>
      </div>
    );

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (rating < 1) {
      setError(t('errRating'));
      document.getElementById(`${id}-rating`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const { submitReview } = await import('@/lib/reviews-api');
    const res = await submitReview(locale, {
      purchase,
      targetType: target.targetType,
      targetSlug: target.slug,
      rating,
      body,
    });
    setBusy(false);
    if (res.ok) {
      track('click', { id: `review_submitted_${target.targetType}`, path: window.location.pathname });
      onDone({
        id: res.data.id,
        rating,
        body: body.trim() || null,
        status: res.data.status,
        createdAt: new Date().toISOString(),
      });
      return;
    }
    setError(t(reviewErrorKey(res.code)));
    if (res.code === 'REVIEW_EXISTS') await onStale();
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="animate-page-in space-y-4">
      <fieldset
        id={`${id}-rating`}
        tabIndex={-1}
        aria-invalid={error && rating < 1 ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <legend className="text-sm font-bold text-ink">{t('api_ratingFor', { name: target.name })}</legend>
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="press cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name={`${id}-stars`}
                value={n}
                checked={rating === n}
                onChange={() => {
                  setRating(n);
                }}
                className="sr-only"
              />
              <span className="sr-only">{t('stars', { n })}</span>
              <Star
                aria-hidden="true"
                className={`size-8 transition-colors duration-[var(--duration-fast)] ${n <= rating ? 'text-star' : 'text-line-card'}`}
                fill="currentColor"
                strokeWidth={0}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${id}-body`} className="text-sm font-bold text-ink">
          {t('api_text')}
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          rows={4}
          maxLength={REVIEW_BODY_MAX}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          aria-describedby={`${id}-hint`}
          className="mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 py-2 text-[15px] text-ink"
        />
        <p id={`${id}-hint`} className="mt-1 flex justify-between gap-3 text-xs text-muted">
          <span>{t('api_textHint')}</span>
          <span className="tabular-nums">{t('api_counter', { n: body.length, max: REVIEW_BODY_MAX })}</span>
        </p>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60"
      >
        {busy ? t('api_sending') : t('submit')}
      </button>
    </form>
  );
}
