'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@/lib/orders-api';
import { ustaadClient, type UstaadClient } from '@/lib/ustaad/client';

/**
 * Shared bits of the Ustaad C + E screens: the loader hook (one client, one request at a time, reload on demand), the
 * sample-data note, the load-failed state with one next action, error text from API codes, and the shared classes for
 * big, sunlight-friendly controls (48 px and up).
 */

export const btnPrimary =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button bg-accent-button px-6 text-[15px] font-bold text-white hover:bg-accent-button-hover disabled:opacity-60 aria-disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
export const btnQuiet =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button border border-input-border bg-surface px-4 text-[15px] font-bold text-ink hover:bg-pill disabled:opacity-60 aria-disabled:opacity-60 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
export const card = 'rounded-2xl border border-line-card bg-surface p-4 shadow-card tab:p-5';
export const fieldClass =
  'min-h-12 w-full rounded-[8px] border border-input-border bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-muted focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-focus';

export type Loaded<T> =
  { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; status: number; code: string };

/** Runs `fn` with the Ustaad client on mount and whenever `key` changes; `reload` runs it again. */
export function useUstaad<T>(
  fn: (c: UstaadClient) => Promise<ApiResult<T>>,
  key: string,
): {
  loaded: Loaded<T>;
  reload: () => void;
  /** Fetch again without the loading state (the screen, focus and scroll stay; used after a write). */
  refresh: () => void;
  sample: boolean;
  set: (data: T) => void;
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
    void ustaadClient(locale).then(async (c) => {
      const r = await run.current(c);
      if (!live) return;
      setSample(c.sample);
      setLoaded(r.ok ? { state: 'ok', data: r.data } : { state: 'error', status: r.status, code: r.code });
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
  const set = useCallback((data: T) => {
    setLoaded({ state: 'ok', data });
  }, []);
  return { loaded, reload, refresh, sample, set };
}

/** Error text for an API code: the screen's own key (`err_CODE`) first, then the shared one, then the generic. */
export function useErrorText(ns: 'qa' | 'learn' | 'local' | 'jobs') {
  const t = useTranslations(`ustaad.${ns}`);
  const l = useTranslations('ustaad.labels');
  return (code: string): string => {
    const key = `err_${code}`;
    // Dynamic keys: the copy test checks every `err_*` the API can send exists in both languages.
    if (t.has(key as 'title')) return t(key as 'title');
    if (l.has(key as 'err_generic')) return l(key as 'err_generic');
    if (code === 'RATE_LIMITED' || code === 'HTTP_429') return l('err_RATE_LIMITED');
    return l('err_generic');
  };
}

export function SampleNote({ show }: { show: boolean }) {
  const t = useTranslations('ustaad.labels');
  if (!show) return null;
  return (
    <p className="rounded-xl bg-warning-bg px-3.5 py-2.5 text-sm leading-relaxed text-warning">
      {t('sample')}
    </p>
  );
}

export function LoadingBlock() {
  const t = useTranslations('ustaad.labels');
  return (
    <div className="grid gap-3" aria-busy="true">
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-24 rounded-2xl" aria-hidden="true" />
      ))}
    </div>
  );
}

export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('ustaad.labels');
  return (
    <div className={`${card} text-center`} role="alert">
      <p className="text-[15px] leading-relaxed text-ink">{message}</p>
      <button type="button" className={`${btnQuiet} mt-3`} onClick={onRetry} data-track="ustaad_retry">
        {t('retry')}
      </button>
    </div>
  );
}

/** "Ramesh Sahu · Pakka Ustaad": the name as written (user content) and the level in the page's language. */
export function AuthorLine({
  author,
  tone = 'muted',
}: {
  author: { displayName: string; displayNameHi: string | null; level: string };
  tone?: 'muted' | 'light';
}) {
  const t = useTranslations('ustaad.labels');
  const locale = useLocale();
  const name = locale === 'hi' && author.displayNameHi ? author.displayNameHi : author.displayName;
  const levelKey = `lvl_${author.level}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span data-user-content className={`font-bold ${tone === 'light' ? 'text-white' : 'text-ink'}`}>
        {name}
      </span>
      {t.has(levelKey as 'lvl_naya') ? (
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone === 'light' ? 'bg-white/15 text-white' : 'bg-pill text-ink'}`}
        >
          {t(levelKey as 'lvl_naya')}
        </span>
      ) : null}
    </span>
  );
}

/** "5 min ago" in the page's language (relative, IST does not matter for a difference). */
export function useTimeAgo() {
  const locale = useLocale();
  const rtf = new Intl.RelativeTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { numeric: 'auto' });
  return (iso: string, now = Date.now()): string => {
    const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  };
}

/** Segment / work label: the site's vehicle segment names, plus EV and the work codes from `ustaad.labels`. */
export function useCodeLabel() {
  const seg = useTranslations('segments');
  const l = useTranslations('ustaad.labels');
  return (code: string | null): string | null => {
    if (!code) return null;
    const work = `work_${code}` as 'work_engine';
    const ev = `seg_${code}` as 'seg_ev';
    if (l.has(work)) return l(work);
    if (l.has(ev)) return l(ev);
    const s = code as 'two_wheeler';
    return seg.has(s) ? seg(s) : null;
  };
}
