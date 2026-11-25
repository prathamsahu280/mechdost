'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTICE_PAGE_MAX, type Notice } from '@mechdost/shared/notice-api';
import { startLive, subscribeLive } from '@/lib/live/live-hub';
import {
  clearReadNotices,
  dismissNotice,
  fetchNotices,
  markNoticesRead,
  restoreNotices,
} from '@/lib/notices-api';
import { arrivedSince, NOTICES_EVENT, pollInterval, type NoticesEventDetail } from '@/lib/notices-view';

/**
 * The notification feed behind the bell and the centre page (spec 10, design 2026-11-15; inbox order and clean-up
 * 2026-11-25). Fetches the first page in the server's order (unread urgent, unread, read; newest first inside each),
 * keeps it fresh while the tab is visible (15 s for partners and staff, 60 s for customers, growing back-off on
 * errors), refreshes at once when the tab becomes visible again or the push worker says a message arrived, and tells
 * the rest of the page about new arrivals (`mechdost:notices`, e.g. the shop's offers list). A live ping over the
 * shared Realtime Database connection (`lib/live`) refreshes it at once, also when the person removed notices on
 * another device (`notice` ping); the poll stays as the fallback (spec 10).
 *
 * Removing is optimistic and undoable: the row leaves the list at once, the call goes out, and `undo` holds the token
 * that brings the batch back (the surface shows it as a toast). A refresh replaces the list with the server's copy, so
 * done and removed notices vanish on every device.
 */
export type FeedStatus = 'loading' | 'ready' | 'error';

/** What "Undo" will bring back, shown in the toast. */
export interface UndoState {
  kind: 'one' | 'many';
  count: number;
  token: string;
}

export interface Feed {
  status: FeedStatus;
  notices: Notice[];
  unread: number;
  hasMore: boolean;
  loadingMore: boolean;
  /** Something went wrong removing or restoring: the surface shows one calm message. */
  actionError: 'remove' | 'undo' | null;
  undo: UndoState | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (n: Notice) => void;
  markAllRead: () => void;
  remove: (n: Notice) => void;
  clearRead: () => void;
  undoLast: () => void;
  closeUndo: () => void;
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
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [actionError, setActionError] = useState<'remove' | 'undo' | null>(null);
  const known = useRef<Set<string> | null>(null);
  const failures = useRef(0);
  const cursor = useRef<string | null>(null);
  const loaded = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    // Pages the person already opened are fetched again in one go (the server order moves rows between groups, so
    // stitching old pages onto a fresh first page could repeat or skip a row).
    const take = Math.min(NOTICE_PAGE_MAX, Math.max(limit, loaded.current));
    const res = await fetchNotices(locale, { limit: take });
    if (!alive.current) return;
    if (!res.ok) {
      failures.current += 1;
      setStatus((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    failures.current = 0;
    const fresh = res.data.notices;
    // The first load only learns what exists; later loads announce what is new.
    const arrived = known.current ? arrivedSince(known.current, fresh) : [];
    known.current = new Set([...(known.current ?? []), ...fresh.map((n) => n.id)]);
    loaded.current = fresh.length;
    cursor.current = res.data.nextCursor;
    setNotices(fresh);
    setNext(res.data.nextCursor);
    setUnread(res.data.unread);
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
      const merged = [...prev, ...res.data.notices.filter((n) => !ids.has(n.id))];
      loaded.current = merged.length;
      return merged;
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
    // A live ping about orders, offers, requests, quotes or coins refreshes the list at once (the poll above stays as the
    // fallback); a `notice` ping says the person removed or restored notices on another device. The connection is
    // shared with the cart and wishlist.
    const unsubscribe = subscribeLive(
      ['order', 'assignment', 'shop', 'workshop', 'request', 'quote', 'coins', 'notice'],
      () => {
        void refresh();
      },
    );
    const release = startLive(locale);
    document.addEventListener('visibilitychange', onVisible);
    worker?.addEventListener('message', onWorker);
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      release();
      document.removeEventListener('visibilitychange', onVisible);
      worker?.removeEventListener('message', onWorker);
    };
  }, [enabled, refresh, role, locale]);

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
    void markNoticesRead(locale, { all: true }).then(() => refresh());
  }, [locale, refresh]);

  const remove = useCallback(
    (n: Notice) => {
      setActionError(null);
      setNotices((prev) => prev.filter((x) => x.id !== n.id));
      loaded.current = Math.max(0, loaded.current - 1);
      if (!n.read) setUnread((u) => Math.max(0, u - 1));
      void dismissNotice(locale, n.id).then((r) => {
        if (!alive.current) return;
        if (!r.ok) {
          setActionError('remove');
          void refresh();
          return;
        }
        setUnread(r.data.unread);
        setUndo({ kind: 'one', count: 1, token: r.data.undoToken });
      });
    },
    [locale, refresh],
  );

  const clearRead = useCallback(() => {
    setActionError(null);
    setNotices((prev) => prev.filter((x) => !x.read));
    void clearReadNotices(locale).then((r) => {
      if (!alive.current) return;
      if (!r.ok) {
        setActionError('remove');
        void refresh();
        return;
      }
      setUnread(r.data.unread);
      if (r.data.undoToken && r.data.cleared > 0)
        setUndo({ kind: 'many', count: r.data.cleared, token: r.data.undoToken });
      void refresh();
    });
  }, [locale, refresh]);

  const undoLast = useCallback(() => {
    if (!undo) return;
    const token = undo.token;
    setUndo(null);
    void restoreNotices(locale, token).then((r) => {
      if (!alive.current) return;
      if (!r.ok) setActionError('undo');
      void refresh();
    });
  }, [locale, undo, refresh]);

  const closeUndo = useCallback(() => {
    setUndo(null);
    setActionError(null);
  }, []);

  return {
    status,
    notices,
    unread,
    hasMore: next !== null,
    loadingMore,
    actionError,
    undo,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    remove,
    clearRead,
    undoLast,
    closeUndo,
  };
}
