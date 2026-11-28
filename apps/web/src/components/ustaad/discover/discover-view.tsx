'use client';

import {
  Award,
  Bookmark,
  Hash,
  Link2,
  Heart,
  MessageCircle,
  Search,
  Sparkles,
  ThumbsUp,
  UserPlus,
  UserCheck,
} from 'lucide-react';
import Form from 'next/form';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CoachMark } from '../tutorial/coach-mark';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { USTAAD_LEVELS, USTAAD_SEGMENT_CODES, USTAAD_WORK_CODES } from '@mechdost/shared/ustaad/codes';
import { track } from '@/lib/analytics';
import { localePath } from '@/lib/locale-path';
import type { DiscoverPerson, TopPost } from '@/lib/ustaad/messages-api';
import {
  LoadFailed,
  LoadingBlock,
  SampleNote,
  btnPrimary,
  btnQuiet,
  card,
  fieldClass,
  useCodeLabel,
} from '../common';
import {
  Avatar,
  LiveNote,
  MemberLine,
  MoreButton,
  Who,
  useAct,
  useDmErrorText,
  useMemberName,
  usePaged,
  useSocial,
} from '../messages/shared';
import type { DiscoverFilters } from '../messages/view';

const small = 'min-h-12 px-3.5 text-[14px]';

/**
 * Discover (spec 23 § 4 flow 8, § 9.4, SR-37; `/ustaad/discover`): a typed search (name, handle or area; no voice
 * search, ruling 1) with the filters the API serves (work, level), then people ranked by helpful and best answers —
 * never by followers — with new Ustaads in guaranteed slots. Each card: initials, name, level chip, area and distance
 * band (never a km number), specialities, helpful / best counts, Follow and Message. Without a search: popular tags
 * and "Top this week". The filters live in the address (Back works); the form navigates without a reload.
 */
export function DiscoverView({ filters }: { filters: DiscoverFilters }) {
  const t = useTranslations('ustaad.discover');
  const locale = useLocale();
  const searching = filters.q !== null || filters.work !== null || filters.level !== null;
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header className="grid gap-1">
        <h1
          id="ustaad-discover-title"
          tabIndex={-1}
          className="font-heading text-[clamp(24px,5vw,32px)] font-extrabold tracking-[-0.02em] text-ink focus-visible:outline-3 focus-visible:outline-focus"
        >
          {t('title')}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('intro')}</p>
        <CoachMark target="discover" returnFocusTo="ustaad-discover-title" />
      </header>
      {/* Keyed on the address: Back or "Clear filters" redraws the fields with the shown filters. */}
      <SearchForm key={`${filters.q ?? ''}|${filters.work ?? ''}|${filters.level ?? ''}`} filters={filters} />
      <People filters={filters} searching={searching} />
      {searching ? (
        <Link
          href={localePath('/ustaad/discover', locale)}
          className={`${btnQuiet} justify-self-center`}
          scroll={false}
          data-track="ustaad_discover_clear"
        >
          {t('clearFilters')}
        </Link>
      ) : (
        <>
          <Tags />
          <TopThisWeek />
        </>
      )}
    </div>
  );
}

function SearchForm({ filters }: { filters: DiscoverFilters }) {
  const t = useTranslations('ustaad.discover');
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const label = useCodeLabel();
  const qId = useId();
  const hintId = useId();
  const workId = useId();
  const levelId = useId();
  return (
    <Form
      action={localePath('/ustaad/discover', locale)}
      scroll={false}
      className={`${card} grid gap-3`}
      role="search"
      noValidate
    >
      <div className="grid gap-1.5">
        <label htmlFor={qId} className="text-[15px] font-bold text-ink">
          {t('searchLabel')}
        </label>
        <div className="flex gap-2">
          <input
            id={qId}
            name="q"
            type="search"
            maxLength={60}
            enterKeyHint="search"
            aria-describedby={hintId}
            defaultValue={filters.q ?? ''}
            placeholder={t('searchPh')}
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button type="submit" className={`${btnPrimary} px-4`} data-track="ustaad_discover_search">
            <Search aria-hidden="true" className="size-5" />
            {t('search')}
          </button>
        </div>
        <p id={hintId} className="text-sm text-muted">
          {t('searchHint')}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={workId} className="text-[15px] font-bold text-ink">
            {t('filterWork')}
          </label>
          <select id={workId} name="work" defaultValue={filters.work ?? ''} className={fieldClass}>
            <option value="">{t('anyWork')}</option>
            {[...USTAAD_SEGMENT_CODES, ...USTAAD_WORK_CODES].map((c) => (
              <option key={c} value={c}>
                {label(c) ?? c}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={levelId} className="text-[15px] font-bold text-ink">
            {t('filterLevel')}
          </label>
          <select id={levelId} name="level" defaultValue={filters.level ?? ''} className={fieldClass}>
            <option value="">{t('anyLevel')}</option>
            {USTAAD_LEVELS.map((v) => (
              <option key={v} value={v}>
                {l(`lvl_${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Form>
  );
}

function People({ filters, searching }: { filters: DiscoverFilters; searching: boolean }) {
  const t = useTranslations('ustaad.discover');
  const errorText = useDmErrorText();
  const key = `${filters.q ?? ''}|${filters.work ?? ''}|${filters.level ?? ''}`;
  const list = usePaged((c, cursor) => c.discover(filters, cursor), key);
  const { loaded, items, next, loadMore, reload, sample, busy, moreError } = list;
  const tracked = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // One status and one alert for every card's Follow / Connect (not two live regions per card).
  const [note, setNote] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const cardNote = useCallback((n: string) => {
    setCardError(null);
    setNote(n);
  }, []);
  const cardFailed = useCallback((e: string) => {
    setNote(null);
    setCardError(e);
  }, []);
  const results =
    searching && loaded.state === 'ok'
      ? loaded.data.items.length === 0
        ? t('noMatch')
        : t('resultsCount', { n: loaded.data.items.length })
      : '';

  // One `ustaad_discover_searched` per search (not per keystroke: the form searches on submit).
  useEffect(() => {
    if (!searching || loaded.state !== 'ok' || tracked.current === key) return;
    tracked.current = key;
    track('ustaad_discover_searched', { results: loaded.data.items.length });
  }, [searching, loaded, key]);

  return (
    <section className="grid gap-3">
      <h2
        ref={heading}
        tabIndex={-1}
        className="rounded-sm font-heading text-xl font-extrabold text-ink focus-visible:outline-3 focus-visible:outline-focus"
      >
        {searching ? t('results') : t('topHelpers')}
      </h2>
      {searching ? null : <p className="text-[15px] leading-relaxed text-muted">{t('rankRule')}</p>}
      <SampleNote show={sample} />
      <p role="status" className="sr-only">
        {results}
      </p>
      <LiveNote text={note} />
      <LiveNote tone="error" text={cardError ? errorText(cardError) : null} />
      {loaded.state === 'loading' ? <LoadingBlock /> : null}
      {loaded.state === 'error' ? <LoadFailed message={errorText(loaded.code)} onRetry={reload} /> : null}
      {loaded.state === 'ok' && items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-card bg-surface p-6 text-center text-[15px] text-ink">
          {t('noMatch')}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="grid gap-3">
          {items.map((p) => (
            <li key={p.id}>
              <PersonCard p={p} onNote={cardNote} onError={cardFailed} />
            </li>
          ))}
        </ul>
      ) : null}
      <MoreButton
        next={next}
        busy={busy}
        moreError={moreError}
        loadMore={loadMore}
        endFocus={heading}
        label={t('loadMore')}
        track="ustaad_discover_more"
      />
    </section>
  );
}

function PersonCard({
  p,
  onNote,
  onError,
}: {
  p: DiscoverPerson;
  onNote: (s: string) => void;
  onError: (code: string) => void;
}) {
  const t = useTranslations('ustaad.discover');
  const locale = useLocale();
  const label = useCodeLabel();
  const name = useMemberName()(p);
  const nameId = useId();
  const { act, busy, error } = useAct();
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(p.followers);
  const [asked, setAsked] = useState(false);
  const setNote = onNote;

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  async function toggle() {
    const r = await act('follow', (c) => c.follow(p.id, !following));
    if (!r) return;
    setFollowing(r.following);
    setFollowers(r.followers);
    setNote(r.following ? t('followedNote', { name }) : t('unfollowedNote', { name }));
  }

  /** Ask to connect (two-way; they accept or decline in My network). Caps and the cooldown come back as words. */
  async function connect() {
    const r = await act('connect', (c) => c.connect(p.id));
    if (!r) return;
    setAsked(true);
    setNote(r.status === 'accepted' ? t('connectedNote', { name }) : t('connectSentNote', { name }));
  }

  return (
    <article className={`${card} grid gap-3`} aria-labelledby={nameId}>
      <div className="flex items-start gap-3">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <MemberLine
            m={p}
            nameId={nameId}
            extra={p.distanceBand ? <> · {t(`dist_${p.distanceBand}`)}</> : null}
          />
        </div>
        {p.isNew ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent-soft-text">
            <Sparkles aria-hidden="true" className="size-3.5" />
            {t('newUstaad')}
          </span>
        ) : null}
      </div>
      {p.specialities.length > 0 ? (
        <ul aria-label={t('specialities')} className="flex flex-wrap gap-1.5">
          {p.specialities.map((s) => (
            <li
              key={s}
              className="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent-soft-text"
            >
              {label(s) ?? s}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
        <span className="inline-flex items-center gap-1.5">
          <ThumbsUp aria-hidden="true" className="size-4 text-success" />
          {t('helpful', { n: p.helpfulAnswers })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Award aria-hidden="true" className="size-4 text-accent-soft-text" />
          {t('best', { n: p.bestAnswers })}
        </span>
        {followers === null ? null : <span>{t('followers', { n: followers })}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${following ? btnQuiet : btnPrimary} ${small}`}
          onClick={() => void toggle()}
          aria-disabled={busy !== null}
          data-track={following ? 'ustaad_discover_unfollow' : 'ustaad_discover_follow'}
        >
          {following ? (
            <UserCheck aria-hidden="true" className="size-5" />
          ) : (
            <UserPlus aria-hidden="true" className="size-5" />
          )}
          {busy === 'follow' ? t('working') : following ? t('unfollow') : t('follow')}
          <Who name={name} />
        </button>
        {/* Stays mounted after the request (focus is kept); it just says the request went. */}
        <button
          type="button"
          className={`${btnQuiet} ${small}`}
          onClick={() => {
            if (!asked) void connect();
          }}
          aria-disabled={asked || busy !== null}
          data-track="ustaad_discover_connect"
        >
          <Link2 aria-hidden="true" className="size-5" />
          {busy === 'connect' ? t('working') : asked ? t('connectSent') : t('connect')}
          <Who name={name} />
        </button>
        <Link
          href={localePath(`/ustaad/messages?to=${encodeURIComponent(p.handle)}`, locale)}
          className={`${btnQuiet} ${small}`}
          data-track="ustaad_discover_message"
        >
          <MessageCircle aria-hidden="true" className="size-5" />
          {t('message')}
          <Who name={name} />
        </Link>
      </div>
    </article>
  );
}

function Tags() {
  const t = useTranslations('ustaad.discover');
  const locale = useLocale();
  const { loaded } = useSocial((c) => c.discoverTags(), 'tags');
  if (loaded.state !== 'ok' || loaded.data.items.length === 0) return null;
  return (
    <section className="grid gap-3">
      <h2 className="font-heading text-xl font-extrabold text-ink">{t('tags')}</h2>
      <p className="text-[15px] text-muted">{t('tagsNote')}</p>
      <ul className="flex flex-wrap gap-2">
        {loaded.data.items.map((tag) => (
          <li key={tag.slug}>
            <Link
              href={localePath(`/ustaad/tags/${encodeURIComponent(tag.slug)}`, locale)}
              onClick={() => {
                track('ustaad_tag_opened', {});
              }}
              className="press inline-flex min-h-12 items-center gap-1.5 rounded-full border border-line-card bg-surface px-4 text-[15px] font-bold text-ink hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
              data-track="ustaad_discover_tag"
            >
              <Hash aria-hidden="true" className="size-4 text-accent-soft-text" />
              {locale === 'hi' ? tag.nameHi : tag.nameEn}
              <span className="text-sm font-normal text-muted">{t('tagUses', { n: tag.uses })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopThisWeek() {
  const t = useTranslations('ustaad.discover');
  const { loaded } = useSocial((c) => c.topPosts(), 'top');
  if (loaded.state !== 'ok' || loaded.data.items.length === 0) return null;
  return (
    <section className="grid gap-3">
      <h2 className="font-heading text-xl font-extrabold text-ink">{t('topWeek')}</h2>
      <ol className="grid gap-2">
        {loaded.data.items.map((post) => (
          <li key={post.id}>
            <TopPostRow post={post} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function TopPostRow({ post }: { post: TopPost }) {
  const t = useTranslations('ustaad.discover');
  const locale = useLocale();
  const name = useMemberName()(post.author);
  return (
    <Link
      href={localePath(`/ustaad/p/${post.id}`, locale)}
      className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-line-card bg-surface px-4 py-3 shadow-card hover:border-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      data-track="ustaad_discover_top_post"
    >
      <Avatar name={name} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-heading text-[16px] font-extrabold text-ink">
          {t.rich('topBy', {
            kind: t(`kind_${post.kind}`),
            who: name,
            name: (chunks) => <span data-user-content>{chunks}</span>,
          })}
        </span>
        <span className="flex flex-wrap gap-x-3 text-sm text-muted">
          {post.likes === null ? null : (
            <span className="inline-flex items-center gap-1">
              <Heart aria-hidden="true" className="size-4" />
              {t('likes', { n: post.likes })}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Bookmark aria-hidden="true" className="size-4" />
            {t('saves', { n: post.saves })}
          </span>
        </span>
      </span>
    </Link>
  );
}
