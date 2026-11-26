'use client';

import { BadgeCheck } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { localePath } from '@/lib/locale-path';
import type { ApiResult } from '@/lib/orders-api';
import { socialClient, type MemberCard, type Page, type SocialClient } from '@/lib/ustaad/messages-api';
import type { Loaded } from '../common';
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
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: 'loading' });
  const [sample, setSample] = useState(false);
  const [tick, setTick] = useState(0);
  const silent = useRef(false);
  const run = useRef(fn);
  run.current = fn;
  useEffect(() => {
    let live = true;
    if (!silent.current) setLoaded({ state: 'loading' });
    silent.current = false;
    socialClient(locale)
      .then(async (c) => {
        const r = await run.current(c);
        if (!live) return;
        setSample(c.sample);
        setLoaded(r.ok ? { state: 'ok', data: r.data } : { state: 'error', status: r.status, code: r.code });
      })
      .catch(() => {
        if (live) setLoaded({ state: 'error', status: 0, code: 'NETWORK' });
      });
    return () => {
      live = false;
    };
  }, [locale, key, tick]);
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
  const loadMore = useCallback(async () => {
    if (!next || busy) return;
    setBusy(true);
    setMoreError(null);
    const r = await fnRef.current(await socialClient(locale), next);
    setBusy(false);
    if (!r.ok) {
      setMoreError(r.code);
      return;
    }
    setMore({ key, items: [...(extra?.items ?? []), ...r.data.items], next: r.data.nextCursor });
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

/** Name (links to the profile), level chip, verified tick and area. */
export function MemberLine({ m, link = true, extra }: { m: MemberCard; link?: boolean; extra?: ReactNode }) {
  const locale = useLocale();
  const t = useTranslations('ustaad.messages');
  const l = useTranslations('ustaad.labels');
  const name = useMemberName()(m);
  const area = locale === 'hi' && m.areaLabelHi ? m.areaLabelHi : m.areaLabel;
  const levelKey = `lvl_${m.level}`;
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {link ? (
          <Link
            href={localePath(`/ustaad/u/${encodeURIComponent(m.handle)}`, locale)}
            className="rounded-sm font-heading text-[16px] font-extrabold break-words text-ink underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            data-track="ustaad_member_open"
          >
            <span data-user-content>{name}</span>
          </Link>
        ) : (
          <span data-user-content className="font-heading text-[16px] font-extrabold break-words text-ink">
            {name}
          </span>
        )}
        {m.verified ? (
          <BadgeCheck aria-label={t('verified')} role="img" className="size-5 shrink-0 text-success" />
        ) : null}
        {l.has(levelKey as 'lvl_naya') ? (
          <span className="rounded-full bg-pill px-2.5 py-0.5 text-xs font-bold text-ink">
            {l(levelKey as 'lvl_naya')}
          </span>
        ) : null}
      </span>
      <span className="text-sm text-muted">
        <span data-user-content>{area}</span>
        {extra}
      </span>
    </span>
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
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 tab:mx-0 tab:px-0">
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
export function LiveNote({ text, tone = 'ok' }: { text: string | null; tone?: 'ok' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`text-[15px] font-bold empty:sr-only ${tone === 'error' ? 'text-error' : 'text-success'}`}
    >
      {text ?? ''}
    </p>
  );
}
