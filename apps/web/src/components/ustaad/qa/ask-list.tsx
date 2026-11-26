'use client';

import { CheckCircle2, Mic, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QUESTION_FILTERS, type QuestionCard, type QuestionFilter } from '@mechdost/shared/ustaad/dto/qa';
import { localePath } from '@/lib/locale-path';
import { ustaadClient } from '@/lib/ustaad/client';
import { questionChip } from '@/lib/ustaad/qa-view';
import {
  AuthorLine,
  btnPrimary,
  btnQuiet,
  LoadFailed,
  LoadingBlock,
  SampleNote,
  useCodeLabel,
  useErrorText,
  useTimeAgo,
  useUstaad,
} from '../common';

/**
 * Ask list (spec 23 § 5 `/ustaad/ask`): four filters as links (All · For you · Mine · No answer yet; the address keeps
 * the filter, Back works), newest first, "Show more" pages by the API's keyset cursor. Each card is one big link to the
 * thread. The one primary action is "Ask a question" (the mic) at the top.
 */
export function AskList({ filter }: { filter: QuestionFilter }) {
  const t = useTranslations('ustaad.qa');
  const locale = useLocale();
  const errorText = useErrorText('qa');
  const { loaded, reload, sample } = useUstaad((c) => c.questions(filter, null), filter);
  const [more, setMore] = useState<{ key: string; items: QuestionCard[]; next: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const first = loaded.state === 'ok' ? loaded.data : null;
  const extra = more?.key === filter ? more : null;
  const items = [...(first?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (first?.nextCursor ?? null);

  async function loadMore() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    const r = await (await ustaadClient(locale)).questions(filter, next);
    setLoadingMore(false);
    if (r.ok)
      setMore({ key: filter, items: [...(extra?.items ?? []), ...r.data.items], next: r.data.nextCursor });
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink">
            {t('title')}
          </h1>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">{t('intro')}</p>
        </div>
        <Link
          href={localePath('/ustaad/ask/new', locale)}
          className={btnPrimary}
          data-track="ustaad_ask_open"
        >
          <Mic aria-hidden="true" className="size-5" />
          {t('askCta')}
        </Link>
      </header>

      <nav aria-label={t('filtersLabel')} className="-mx-4 overflow-x-auto px-4 tab:mx-0 tab:px-0">
        <ul className="flex w-max gap-2">
          {QUESTION_FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={localePath(f === 'all' ? '/ustaad/ask' : `/ustaad/ask?filter=${f}`, locale)}
                aria-current={f === filter ? 'page' : undefined}
                scroll={false}
                data-track={`ustaad_ask_filter_${f}`}
                className={`inline-flex min-h-12 items-center rounded-full px-5 text-[15px] font-bold whitespace-nowrap ${
                  f === filter
                    ? 'bg-navy text-white'
                    : 'border border-line-card bg-surface text-ink hover:border-accent'
                }`}
              >
                {t(`f_${f}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <SampleNote show={sample} />

      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center">
          <p className="text-[15px] leading-relaxed text-ink">{t(`empty_${filter}`)}</p>
          {filter === 'unanswered' ? null : (
            <Link
              href={localePath('/ustaad/ask/new', locale)}
              className={`${btnPrimary} mt-4`}
              data-track="ustaad_ask_empty"
            >
              {t('askCta')}
            </Link>
          )}
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map((q) => (
            <li key={q.code}>
              <QuestionRow q={q} />
            </li>
          ))}
        </ul>
      ) : null}

      {next ? (
        <button
          type="button"
          className={`${btnQuiet} justify-self-center`}
          onClick={() => void loadMore()}
          aria-disabled={loadingMore}
          aria-busy={loadingMore}
          data-track="ustaad_ask_more"
        >
          {t('loadMore')}
        </button>
      ) : null}
    </div>
  );
}

function QuestionRow({ q }: { q: QuestionCard }) {
  const t = useTranslations('ustaad.qa');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const label = useCodeLabel();
  const ago = useTimeAgo();
  const chip = questionChip(q);
  const vehicle = label(q.segmentCode);
  const work = label(q.workCode);
  return (
    <Link
      href={localePath(`/ustaad/q/${q.code}`, locale)}
      data-track="ustaad_question_open"
      className="press block rounded-2xl border border-line-card bg-surface p-4 shadow-card hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-heading text-[17px] leading-snug font-extrabold text-ink">
          {q.title === null ? (
            <span className="inline-flex items-center gap-2">
              <Mic aria-hidden="true" className="size-5 text-accent-soft-text" />
              {t('voiceQuestion')}
            </span>
          ) : (
            <span data-user-content>{q.title}</span>
          )}
        </p>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
            chip.key === 'solved'
              ? 'bg-success-bg text-success'
              : chip.key === 'new'
                ? 'bg-accent-soft text-accent-soft-text'
                : 'bg-pill text-ink'
          }`}
        >
          {chip.key === 'solved' ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : null}
          {chip.key === 'answers' ? <MessageCircle aria-hidden="true" className="size-3.5" /> : null}
          {chip.key === 'solved'
            ? t('chipSolved')
            : chip.key === 'new'
              ? t('chipNew')
              : t('answersN', { n: chip.n })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        {q.hasVoice && q.title !== null ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-soft-text">
            <Mic aria-hidden="true" className="size-3.5" />
            {t('voiceQuestion')}
          </span>
        ) : null}
        {vehicle ? (
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-bold text-ink">
            {vehicle}
          </span>
        ) : null}
        {work ? (
          <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs font-bold text-ink">{work}</span>
        ) : null}
        {q.safetyTag ? (
          <span className="rounded-full bg-error-bg px-2 py-0.5 text-xs font-bold text-error">
            {l(`safety_${q.safetyTag}` as 'safety_brake')}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        {q.mine ? <span className="font-bold text-ink">{l('you')}</span> : <AuthorLine author={q.asker} />}
        <time dateTime={q.createdAt}>{ago(q.createdAt)}</time>
      </div>
    </Link>
  );
}
