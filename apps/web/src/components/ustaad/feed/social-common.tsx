'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '@/lib/orders-api';
import { socialClient, type MediaKind, type SocialClient } from '@/lib/ustaad/social-client';
import type { Loaded } from '../common';

/**
 * Shared bits of the Ustaad feed and social screens (workstream D web): the loader hook on the social seam, error
 * words from API codes, the round initial avatar, and a signed picture that loads only when it nears the screen
 * (low data: nothing is fetched for cards the member never scrolls to; the box keeps its size, no layout shift).
 */

export function useSocial<T>(
  fn: (c: SocialClient) => Promise<ApiResult<T>>,
  key: string,
): {
  loaded: Loaded<T>;
  reload: () => void;
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
  const set = useCallback((data: T) => {
    setLoaded({ state: 'ok', data });
  }, []);
  return { loaded, reload, refresh, sample, set };
}

/** The social client for event handlers (likes, sends): one per locale, loaded on demand. */
export function useSocialAction() {
  const locale = useLocale();
  return useCallback(() => socialClient(locale), [locale]);
}

/** Error words for an API code: the screen's own `err_CODE` first, then the shared ones, then the generic. */
export function useSocialError(ns: 'feed' | 'social') {
  const t = useTranslations(`ustaad.${ns}`);
  const l = useTranslations('ustaad.labels');
  const m = useTranslations('ustaad.media');
  return (code: string): string => {
    const key = `err_${code}`;
    if (t.has(key as 'send')) return t(key as 'send');
    if (m.has(key as 'err_MEDIA_TYPE')) return m(key as 'err_MEDIA_TYPE');
    if (l.has(key as 'err_generic')) return l(key as 'err_generic');
    if (code === 'RATE_LIMITED' || code === 'HTTP_429') return l('err_RATE_LIMITED');
    return l('err_generic');
  };
}

/** Name in the page's language when the member gave one (user content either way). */
export function useMemberName() {
  const locale = useLocale();
  return (m: { displayName: string; displayNameHi: string | null }): string =>
    locale === 'hi' && m.displayNameHi ? m.displayNameHi : m.displayName;
}

/** The first letter as the reader sees it (a whole Devanagari cluster, not half of one). */
function firstLetter(name: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(name.trim())
    [Symbol.iterator]()
    .next();
  return first.done ? '?' : first.value.segment.toUpperCase();
}

const AVATAR_TINTS = ['bg-navy', 'bg-accent-button', 'bg-success', 'bg-ink'] as const;

/** A round initial (no photos of people in the feed yet); decorative, the name is always next to it. */
export function Avatar({ name, id, size = 44 }: { name: string; id: string; size?: number }) {
  const tint = AVATAR_TINTS[id.charCodeAt(id.length - 1) % AVATAR_TINTS.length] ?? 'bg-navy';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-heading font-extrabold text-white ${tint}`}
    >
      {firstLetter(name)}
    </span>
  );
}

/**
 * A member's picture by media id: the signed URL is asked for only when the box comes near the screen (200 px), the
 * box has its final size from the start (width/height from the API), and `next/image` runs `unoptimized` (the URL is
 * already a sized, signed WebP from the pipeline).
 */
export function SignedImage({
  mediaId,
  alt,
  width,
  height,
  kind = 'image',
  className = '',
  eager = false,
}: {
  mediaId: string;
  alt: string;
  width: number | null;
  height: number | null;
  kind?: MediaKind;
  className?: string;
  eager?: boolean;
}) {
  const locale = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [near, setNear] = useState(eager);
  const w = width ?? 1080;
  const h = height ?? 810;
  useEffect(() => {
    if (near || !box.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(box.current);
    return () => {
      io.disconnect();
    };
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    void socialClient(locale)
      .then((c) => c.mediaUrl(mediaId, kind))
      .then((r) => {
        if (live && r.ok) setUrl(r.data.url);
      });
    return () => {
      live = false;
    };
  }, [near, locale, mediaId, kind]);
  return (
    <div
      ref={box}
      style={{ aspectRatio: `${String(w)} / ${String(h)}` }}
      className={`relative w-full overflow-hidden bg-surface-alt ${className}`}
    >
      {url ? (
        <Image src={url} alt={alt} width={w} height={h} unoptimized className="size-full object-cover" />
      ) : alt ? (
        <span role="img" aria-label={alt} aria-busy="true" className="skeleton absolute inset-0" />
      ) : (
        <span aria-hidden="true" className="skeleton absolute inset-0" />
      )}
    </div>
  );
}
