'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notice } from '@mechdost/shared/notice-api';
import { fetchNotices, markNoticesRead } from '@/lib/notices-api';
import { arrivedSince, NOTICES_EVENT, pollInterval, type NoticesEventDetail } from '@/lib/notices-view';

/**
 * The notification feed behind the bell and the centre page (spec 10, design 2026-11-15). Fetches the newest page,
 * keeps it fresh while the tab is visible (15 s for partners and staff, 60 s for customers, growing back-off on
 * errors), refreshes at once when the tab becomes visible again or the push worker says a message arrived, and tells
 * the rest of the page about new arrivals (`mechdost:notices`, e.g. the shop's offers list). Live pings over the
 * Realtime Database replace the poll when the browser transport ships (spec 10, "Live updates").
 */
export type FeedStatus = 'loading' | 'ready' | 'error';

export interface Feed {
  status: FeedStatus;
  notices: Notice[];
  unread: number;
  hasMore: boolean;
  loadingMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (n: Notice) => void;
  markAllRead: () => void;
}

export function useNoticeFeed(opts: {
  locale: string;
  role: string;
  limit: number;
  enabled?: boolean;
}): Feed {
  const { locale, role, limit } = opts;
  const enabled = opts.enabled ?? true;
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const failures = useRef(0);
  const cursor = useRef<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const res = await fetchNotices(locale, { limit });
    if (!alive.current) return;
    if (!res.ok) {
      failures.current += 1;
      setStatus((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    failures.current = 0;
    const first = res.data.notices;
    // The first load only learns what exists; later loads announce what is new.
    const arrived = known.current ? arrivedSince(known.current, first) : [];
    known.current = new Set([...(known.current ?? []), ...first.map((n) => n.id)]);
    setNotices((prev) => {
      const ids = new Set(first.map((n) => n.id));
      const oldest = first[first.length - 1]?.createdAt ?? '';
      // Pages the person already scrolled to stay; the newest page is replaced by the fresh copy.
      return [...first, ...prev.filter((n) => !ids.has(n.id) && n.createdAt < oldest)];
    });
    setUnread(res.data.unread);
    if (cursor.current === null) {
      cursor.current = res.data.nextCursor;
      setNext(res.data.nextCursor);
    }
    setStatus('ready');
    if (arrived.length > 0)
      window.dispatchEvent(
        new CustomEvent<NoticesEventDetail>(NOTICES_EVENT, {
          detail: { kinds: arrived.map((n) => n.kind ?? '') },
        }),
      );
  }, [locale, limit]);

  const loadMore = useCallback(async () => {
    if (!cursor.current || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchNotices(locale, { limit, cursor: cursor.current });
    if (!alive.current) return;
    setLoadingMore(false);
    if (!res.ok) return;
    cursor.current = res.data.nextCursor;
    setNext(res.data.nextCursor);
    for (const n of res.data.notices) known.current?.add(n.id);
    setNotices((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      return [...prev, ...res.data.notices.filter((n) => !ids.has(n.id))];
    });
  }, [locale, limit, loadingMore]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (document.hidden) {
        timer = setTimeout(tick, pollInterval(role, failures.current));
        return;
      }
      void refresh().finally(() => {
        if (alive.current) timer = setTimeout(tick, pollInterval(role, failures.current));
      });
    };
    tick();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    const onWorker = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'mechdost-notice')
        void refresh();
    };
    // Older browsers and blocked storage have no service worker container at all.
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    document.addEventListener('visibilitychange', onVisible);
    worker?.addEventListener('message', onWorker);
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      worker?.removeEventListener('message', onWorker);
    };
  }, [enabled, refresh, role]);

  const markRead = useCallback(
    (n: Notice) => {
      if (n.read) return;
      setNotices((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markNoticesRead(locale, { ids: [n.id] }).then((r) => {
        if (r.ok && alive.current) setUnread(r.data.unread);
      });
    },
    [locale],
  );

  const markAllRead = useCallback(() => {
    setNotices((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    void markNoticesRead(locale, { all: true });
  }, [locale]);

  return {
    status,
    notices,
    unread,
    hasMore: next !== null,
    loadingMore,
    refresh,
    loadMore,
    markRead,
    markAllRead,
  };
}
