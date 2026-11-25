'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  REVIEW_HIDE_REASONS,
  REVIEW_NOTE_MAX,
  type ReviewHideReason,
  type ReviewStatus,
} from '@mechdost/shared/reviews';
import type { AdminReview } from '@mechdost/shared/reviews-api';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { commonErrorKey, type CommonErrorKey } from '@/lib/api-error-key';
import { formatDate } from '@/lib/format';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';
import { AdminToolbar } from './admin-page-header';

const TABS: readonly ReviewStatus[] = ['pending', 'approved', 'hidden'];

/**
 * Admin → Reviews on the API (spec 08 review moderation; real sign-in builds, loaded by `admin-console.tsx`). The
 * queue is in the staff member's cities: waiting reviews oldest first, published and hidden newest first. Approve
 * publishes; hide needs a reason code (and an optional staff-only note). Every action sends the review's version;
 * if someone else moderated it meanwhile the list reloads with a message. Review text is user content.
 */
export function AdminReviewsApi() {
  const t = useTranslations('reviews');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [tab, setTab] = useState<ReviewStatus>('pending');
  const [items, setItems] = useState<AdminReview[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<CommonErrorKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const { fetchReviewQueue } = await import('@/lib/reviews-api');
      const res = await fetchReviewQueue(locale, tab, cursor);
      if (!res.ok) {
        setError(commonErrorKey(res.code));
        return;
      }
      setError(null);
      setItems((prev) => (cursor && prev ? [...prev, ...res.data.reviews] : res.data.reviews));
      setNext(res.data.nextCursor);
    },
    [locale, tab],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-labelledby="admin-page-title" className="space-y-4">
      <AdminToolbar label={t('api_admin_filter')}>
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={tab === s}
            onClick={() => {
              setItems(null);
              setNotice(null);
              setTab(s);
            }}
            className={`press min-h-11 rounded-pill px-4 text-sm font-bold ${
              tab === s ? 'bg-accent-soft text-accent-soft-text' : 'bg-pill text-ink'
            }`}
          >
            {t(`api_admin_tab_${s}`)}
          </button>
        ))}
      </AdminToolbar>
      {notice ? (
        <p role="status" className="rounded-tile bg-success-bg p-3 text-sm font-bold text-success">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className={`${adminCard} space-y-3`}>
          <p className="text-sm font-bold text-error">{p(error)}</p>
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {p('api_common_retry')}
          </button>
        </div>
      ) : items === null ? (
        <p role="status" className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {p('api_common_loading')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-card border border-line-card bg-surface p-5 text-sm text-muted">
          {t(`api_admin_empty_${tab}`)}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 xl:grid-cols-2">
            {items.map((r) => (
              <li key={r.id}>
                <ReviewCard
                  review={r}
                  onDone={async (message) => {
                    setNotice(message);
                    setItems(null);
                    await load();
                  }}
                />
              </li>
            ))}
          </ul>
          {next ? (
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                void load(next);
              }}
            >
              {t('api_admin_more')}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function ReviewCard({
  review: r,
  onDone,
}: {
  review: AdminReview;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useTranslations('reviews');
  const p = useTranslations('portal');
  const locale = useLocale();
  const [hiding, setHiding] = useState(false);
  const [reason, setReason] = useState<ReviewHideReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `review-${r.id}`;

  async function act(to: 'approved' | 'hidden') {
    if (to === 'hidden' && !reason) {
      setError(t('api_admin_err_reason'));
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const { moderateReview } = await import('@/lib/reviews-api');
    const res = await moderateReview(locale, r.id, {
      to,
      version: r.version,
      ...(to === 'hidden' && reason ? { reasonCode: reason } : {}),
      ...(to === 'hidden' && note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (res.ok) {
      await onDone(to === 'approved' ? t('api_admin_done_approved') : t('api_admin_done_hidden'));
      return;
    }
    if (res.code === 'STALE_REVIEW' || res.code === 'ILLEGAL_TRANSITION') {
      await onDone(t('api_admin_stale'));
      return;
    }
    setError(p(commonErrorKey(res.code)));
  }

  function onHide(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    void act('hidden');
  }

  return (
    <article className={adminCard} aria-labelledby={`${id}-target`}>
      <p className="text-sm font-bold text-star" aria-hidden="true">
        {'★'.repeat(r.rating)}
        {'☆'.repeat(5 - r.rating)}
      </p>
      <p className="sr-only">{t('average', { rating: r.rating })}</p>
      <p id={`${id}-target`} className="mt-1 font-heading font-extrabold text-ink">
        {t(r.targetType === 'product' ? 'api_admin_onProduct' : 'api_admin_onWorkshop', {
          target: r.targetName,
        })}
      </p>
      {r.body ? (
        <p data-user-content className="mt-1 text-sm whitespace-pre-line text-ink">
          {r.body}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">{t('api_admin_noText')}</p>
      )}
      <p className="mt-2 text-xs text-muted">
        {r.author ? <span data-user-content>{r.author}</span> : t('api_customer')} ·{' '}
        {formatDate(r.createdAt, locale)} · {r.orderCode ?? r.serviceCode}
      </p>
      {r.status === 'hidden' && r.hiddenReason ? (
        <p className="mt-2 text-xs font-bold text-warning">
          {t('api_admin_hiddenBecause', { reason: t(`api_admin_reason_${r.hiddenReason}`) })}
          {r.note ? (
            <span data-user-content className="font-normal">
              {' '}
              · {r.note}
            </span>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-3 text-sm font-bold text-error">
          {error}
        </p>
      ) : null}
      {hiding ? (
        <form onSubmit={onHide} className="mt-4 space-y-3">
          <div>
            <label htmlFor={`${id}-reason`} className="text-sm font-bold text-ink">
              {t('api_admin_hideReason')}
            </label>
            <select
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => {
                const v = REVIEW_HIDE_REASONS.find((x) => x === e.target.value);
                setReason(v ?? '');
              }}
              aria-describedby={error ? `${id}-error` : undefined}
              className={portalField}
            >
              <option value="">{t('api_admin_choose')}</option>
              {REVIEW_HIDE_REASONS.map((code) => (
                <option key={code} value={code}>
                  {t(`api_admin_reason_${code}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-note`} className="text-sm font-bold text-ink">
              {t('api_admin_note')}
            </label>
            <input
              id={`${id}-note`}
              value={note}
              maxLength={REVIEW_NOTE_MAX}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              className={portalField}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalPrimary} data-track="admin_review_hide">
              {t('api_admin_confirmHide')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setHiding(false);
                setError(null);
              }}
            >
              {t('api_admin_cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {r.status !== 'approved' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act('approved')}
              className={portalPrimary}
              data-track="admin_review_approve"
            >
              {t('api_admin_approve')}
            </button>
          ) : null}
          {r.status !== 'hidden' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setHiding(true);
              }}
              className={portalQuiet}
            >
              {t('api_admin_hide')}
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}
