'use client';

import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { localePath } from '@/lib/locale-path';
import type { ApiResult } from '@/lib/orders-api';
import { socialClient, type MemberCard, type Page, type SocialClient } from '@/lib/ustaad/messages-api';
import { btnQuiet, type Loaded } from '../common';
import { dmErrorKey, initials } from './view';

/**
 * Shared bits of the messages, My network and Discover screens (spec 23 § 5; D2 web): the loader hooks on the social
 * seam (`messages-api.ts`), error words from API codes, the initials avatar, the member line (name as written, level
 * chip, verified tick, area), the tab links and the busy-action helper. Pages using these load `ustaad.messages` and
 * `ustaad.labels`.
 */

/** Runs `fn` with the social client on mount and whenever `key` changes. */
export function useSocial<T>(
  fn: (c: SocialClient) => Promise<ApiResult<T>>,
  key: string,
): {
  loaded: Loaded<T>;
  reload: () => void;
  /** Fetch again without the loading state (focus and scroll stay; used after a write). */
  refresh: () => void;
  sample: boolean;
} {
  const locale = useLocale();
  // The answer remembers which key it belongs to: right after the key changes (a new search), the old answer is not
  // shown or counted as the new one (it reads as loading until the new answer lands).
  const [result, setResult] = useState<{ key: string; loaded: Loaded<T> }>({
    key,
    loaded: { state: 'loading' },
  });
  const [sample, setSample] = useState(false);
  const [tick, setTick] = useState(0);
  const silent = useRef(false);
  const run = useRef(fn);
  run.current = fn;
  useEffect(() => {
    let live = true;
    if (!silent.current) setResult({ key, loaded: { state: 'loading' } });
    silent.current = false;
    socialClient(locale)
      .then(async (c) => {
        const r = await run.current(c);
        if (!live) return;
        setSample(c.sample);
        setResult({
          key,
          loaded: r.ok ? { state: 'ok', data: r.data } : { state: 'error', status: r.status, code: r.code },
        });
      })
      .catch(() => {
        if (live) setResult({ key, loaded: { state: 'error', status: 0, code: 'NETWORK' } });
      });
    return () => {
      live = false;
    };
  }, [locale, key, tick]);
  const loaded: Loaded<T> = result.key === key ? result.loaded : { state: 'loading' };
  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  const refresh = useCallback(() => {
    silent.current = true;
    setTick((n) => n + 1);
  }, []);
  return { loaded, reload, refresh, sample };
}

/** A keyset-paged list: the first page from `useSocial`, then "Show more" appends with the API's cursor. */
export function usePaged<T>(
  fn: (c: SocialClient, cursor: string | null) => Promise<ApiResult<Page<T>>>,
  key: string,
) {
  const locale = useLocale();
  const first = useSocial((c) => fn(c, null), key);
  const [more, setMore] = useState<{ key: string; items: T[]; next: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const page = first.loaded.state === 'ok' ? first.loaded.data : null;
  const extra = more?.key === key ? more : null;
  const items = [...(page?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (page?.nextCursor ?? null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  /** Loads the next page; answers how many rows came and whether the list has ended (null on failure). */
  const loadMore = useCallback(async (): Promise<{ added: number; ended: boolean } | null> => {
    if (!next || busy) return null;
    setBusy(true);
    setMoreError(null);
    const r = await fnRef.current(await socialClient(locale), next);
    setBusy(false);
    if (!r.ok) {
      setMoreError(r.code);
      return null;
    }
    setMore({ key, items: [...(extra?.items ?? []), ...r.data.items], next: r.data.nextCursor });
    return { added: r.data.items.length, ended: r.data.nextCursor === null };
  }, [busy, extra, key, locale, next]);
  /** After a write: start again from the first page without the loading state. */
  const refresh = useCallback(() => {
    setMore(null);
    first.refresh();
  }, [first]);
  return { ...first, items, next, loadMore, busy, moreError, refresh };
}

/** Error words for an API code (`ustaad.messages.err_*`, en + hi). */
export function useDmErrorText() {
  const t = useTranslations('ustaad.messages');
  return (code: string): string => t(dmErrorKey(code) as 'err_generic');
}

/** Runs a write once at a time; the button stays focusable (`aria-disabled`) while it runs. */
export function useAct() {
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useCallback(
    async <T,>(id: string, fn: (c: SocialClient) => Promise<ApiResult<T>>): Promise<T | null> => {
      if (busy) return null;
      setBusy(id);
      setError(null);
      try {
        const r = await fn(await socialClient(locale));
        if (!r.ok) {
          setError(r.code);
          return null;
        }
        return r.data;
      } catch {
        setError('NETWORK');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [busy, locale],
  );
  return { act, busy, error, setError };
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-heading font-extrabold text-accent-soft-text ${
        size === 'lg' ? 'size-14 text-lg' : 'size-12 text-base'
      }`}
    >
      {initials(name)}
    </span>
  );
}

/** The name as the member wrote it (Hindi on `/hi` when they gave one). */
export function useMemberName() {
  const locale = useLocale();
  return (m: Pick<MemberCard, 'displayName' | 'displayNameHi'>) =>
    locale === 'hi' && m.displayNameHi ? m.displayNameHi : m.displayName;
}

/**
 * Name (links to the profile), verified tick, level chip and area. With `heading` the name alone is the page's h1
 * (the tick, chip and area sit beside it, outside the heading); `nameId` lets a card be named by the name only.
 */
export function MemberLine({
  m,
  link = true,
  extra,
  heading = false,
  nameId,
}: {
  m: MemberCard;
  link?: boolean;
  extra?: ReactNode;
  heading?: boolean;
  nameId?: string;
}) {
  const locale = useLocale();
  const t = useTranslations('ustaad.messages');
  const l = useTranslations('ustaad.labels');
  const name = useMemberName()(m);
  const area = locale === 'hi' && m.areaLabelHi ? m.areaLabelHi : m.areaLabel;
  const levelKey = `lvl_${m.level}`;
  const nameEl = link ? (
    <Link
      id={nameId}
      href={localePath(`/ustaad/u/${encodeURIComponent(m.handle)}`, locale)}
      className="rounded-sm font-heading text-[16px] font-extrabold break-words text-ink underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      data-track="ustaad_member_open"
    >
      <span data-user-content>{name}</span>
    </Link>
  ) : (
    <span
      id={nameId}
      data-user-content
      className="font-heading text-[16px] font-extrabold break-words text-ink"
    >
      {name}
    </span>
  );
  return (
    <div className="grid min-w-0 gap-0.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {heading ? <h1 className="min-w-0 text-[16px]">{nameEl}</h1> : nameEl}
        {m.verified ? (
          <BadgeCheck aria-label={t('verified')} role="img" className="size-5 shrink-0 text-success" />
        ) : null}
        {l.has(levelKey as 'lvl_naya') ? (
          <span className="rounded-full bg-pill px-2.5 py-0.5 text-xs font-bold text-ink">
            {l(levelKey as 'lvl_naya')}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        <span data-user-content>{area}</span>
        {extra}
      </p>
    </div>
  );
}

/** ", Raju Nishad" for screen readers: a row's buttons say whose row they act on (2.4.6). */
export function Who({ name }: { name: string }) {
  return (
    <span className="sr-only">
      {' '}
      <span data-user-content>{name}</span>
    </span>
  );
}

/**
 * "Show more" for a keyset list: says how many rows came (polite status) or why it failed (alert), and when the list
 * has ended — the button then leaves — puts focus on `endFocus` (the list's heading) so it is not lost.
 */
export function MoreButton({
  next,
  busy,
  moreError,
  loadMore,
  endFocus,
  label,
  track,
}: {
  next: string | null;
  busy: boolean;
  moreError: string | null;
  loadMore: () => Promise<{ added: number; ended: boolean } | null>;
  endFocus: RefObject<HTMLElement | null>;
  label: string;
  track: string;
}) {
  const t = useTranslations('ustaad.messages');
  const errorText = useDmErrorText();
  const [note, setNote] = useState<string | null>(null);
  async function more() {
    setNote(null);
    const r = await loadMore();
    if (!r) return;
    setNote(t('moreLoaded', { n: r.added }));
    if (r.ended) requestAnimationFrame(() => endFocus.current?.focus());
  }
  return (
    <>
      {next ? (
        <button
          type="button"
          className={`${btnQuiet} justify-self-center`}
          onClick={() => void more()}
          aria-disabled={busy}
          data-track={track}
        >
          {busy ? t('loadingMore') : label}
        </button>
      ) : null}
      <p role="status" className="sr-only">
        {note ?? ''}
      </p>
      <LiveNote tone="error" text={moreError ? errorText(moreError) : null} />
    </>
  );
}

/** Tabs as links (the address keeps the tab, Back works); the current one is marked for screen readers. */
export function TabLinks<K extends string>({
  label,
  tabs,
  current,
  hrefFor,
  textFor,
  dotFor,
  track,
}: {
  label: string;
  tabs: readonly K[];
  current: K;
  hrefFor: (k: K) => string;
  textFor: (k: K) => string;
  dotFor?: (k: K) => string | null;
  track: string;
}) {
  return (
    <nav aria-label={label} className="-mx-4 -my-1.5 overflow-x-auto px-4 py-1.5 tab:mx-0 tab:px-0">
      <ul className="flex w-max gap-2">
        {tabs.map((k) => {
          const dot = dotFor?.(k) ?? null;
          return (
            <li key={k}>
              <Link
                href={hrefFor(k)}
                aria-current={k === current ? 'page' : undefined}
                scroll={false}
                data-track={`${track}_${k}`}
                className={`press inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-[15px] font-bold whitespace-nowrap focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                  k === current
                    ? 'bg-navy text-white'
                    : 'border border-line-card bg-surface text-ink hover:border-accent'
                }`}
              >
                {textFor(k)}
                {dot ? (
                  <span className="rounded-full bg-accent-button px-2 py-0.5 text-xs font-bold text-white">
                    {dot}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Back to …" link above a screen's content. */
export const backLink =
  'press inline-flex min-h-12 items-center gap-2 justify-self-start rounded-full pr-4 text-[15px] font-bold text-ink hover:text-accent-soft-text focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** One polite live region per screen, always mounted (L-UCE2). */
export function LiveNote({
  text,
  tone = 'ok',
  id,
}: {
  text: string | null;
  tone?: 'ok' | 'error';
  id?: string;
}) {
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={`text-[15px] font-bold empty:sr-only ${tone === 'error' ? 'text-error' : 'text-success'}`}
    >
      {text ?? ''}
    </p>
  );
}
