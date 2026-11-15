'use client';

import { Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { type ReviewTarget } from '@/demo/store';
import { submitReview, useReviews } from '@/demo/partner-store';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { StarRating } from './star-rating';

type Field = 'rating' | 'name' | 'body';

/**
 * Customer-submitted reviews on this device: approved ones are shown publicly, the visitor's own pending ones are
 * shown to them with an "awaiting approval" tag, plus the write-a-review form (one primary action).
 */
export function LocalReviews({ target, slug }: { target: ReviewTarget; slug: string }) {
  const t = useTranslations('reviews');
  const locale = useLocale();
  const all = useReviews().filter((r) => r.target === target && r.slug === slug && r.status !== 'hidden');
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [sent, setSent] = useState(false);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const next: Partial<Record<Field, string>> = {};
    if (rating < 1) next.rating = t('errRating');
    if (value('name').length < 2) next.name = t('errName');
    if (value('body').length < 20) next.body = t('errBody');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`review-${first}-${slug}`)?.focus();
      return;
    }
    submitReview({ target, slug, rating, name: value('name'), title: value('title'), body: value('body') });
    track('click', { id: `review_submitted_${target}`, path: window.location.pathname });
    setSent(true);
    setOpen(false);
    setRating(0);
  }

  const input =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink aria-[invalid=true]:border-error';
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`review-${id}-${slug}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;
  const aria = (id: Field) => ({
    id: `review-${id}-${slug}`,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `review-${id}-${slug}-error` : undefined,
  });

  return (
    <div className="mt-3 space-y-3">
      {all.length > 0 ? (
        <ul className="space-y-3">
          {all.map((r) => (
            <li key={r.id} className="rounded-card border border-line-card bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StarRating rating={r.rating} label={t('average', { rating: r.rating })} />
                <span className="text-xs text-muted">{formatDate(r.createdAt, locale)}</span>
              </div>
              {r.title ? (
                <p data-user-content className="mt-2 font-heading font-bold text-ink">
                  {r.title}
                </p>
              ) : null}
              <p data-user-content className="mt-1 text-sm leading-relaxed text-muted">
                {r.body}
              </p>
              <p className="mt-3 flex items-center gap-2 text-xs">
                <span data-user-content className="font-bold text-ink">
                  {r.name}
                </span>
                {r.status === 'pending' ? (
                  <span className="rounded-md bg-warning-bg px-1.5 py-0.5 font-bold text-warning">
                    {t('awaiting')}
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="animate-page-in rounded-tile bg-success-bg p-4 text-sm font-bold text-success"
        >
          {t('pending')}
        </p>
      ) : null}

      {open ? (
        <form
          noValidate
          onSubmit={onSubmit}
          className="animate-page-in space-y-4 rounded-card border border-line-card bg-surface p-5 shadow-card"
        >
          <fieldset {...aria('rating')} tabIndex={-1}>
            <legend className="text-sm font-bold text-ink">{t('yourRating')}</legend>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  className="press cursor-pointer rounded-lg p-1 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
                >
                  <input
                    type="radio"
                    name="rating"
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
            {err('rating')}
          </fieldset>
          <div className="grid gap-4 min-[600px]:grid-cols-2">
            <div>
              <label htmlFor={`review-name-${slug}`} className="text-sm font-bold text-ink">
                {t('name')}
              </label>
              <input
                {...aria('name')}
                name="name"
                autoComplete="given-name"
                maxLength={60}
                className={input}
              />
              {err('name')}
            </div>
            <div>
              <label htmlFor={`review-title-${slug}`} className="text-sm font-bold text-ink">
                {t('headline')}
              </label>
              <input id={`review-title-${slug}`} name="title" maxLength={80} className={input} />
            </div>
          </div>
          <div>
            <label htmlFor={`review-body-${slug}`} className="text-sm font-bold text-ink">
              {t('body')}
            </label>
            <textarea {...aria('body')} name="body" rows={4} maxLength={1500} className={`${input} py-2`} />
            <p className="mt-1 text-xs text-muted">{t('bodyHint')}</p>
            {err('body')}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="press inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
            >
              {t('submit')}
            </button>
            <button
              type="button"
              data-panel-cancel={`review-${slug}`}
              data-track={`review_cancel_${target}`}
              onClick={() => {
                setOpen(false);
                setRating(0);
                setErrors({});
              }}
              className="press inline-flex min-h-11 items-center rounded-button px-4 text-sm font-bold text-ink underline hover:bg-pill"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          data-disclosure-trigger={`review-${slug}`}
          data-track={`review_open_${target}`}
          onClick={() => {
            setOpen(true);
            setSent(false);
          }}
          className="press inline-flex min-h-11 items-center rounded-button border border-input-border bg-surface px-5 text-sm font-bold text-ink hover:bg-pill"
        >
          {t('write')}
        </button>
      )}
    </div>
  );
}
