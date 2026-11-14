'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminResult } from '@/lib/admin-api';

export interface ApiList<T> {
  items: T[];
  /** True until the first answer (success or failure) arrives. */
  loading: boolean;
  /** API error code of the last call; the last good items stay visible next to the error. */
  error: string | null;
  next: string | null;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

/**
 * One paged list from the API for the real-API portal screens: first page on mount, `reload` after every action,
 * optional polling while the tab is visible (offer timers), "Load more" with the API's cursor. A failed call is
 * reported, never shown as an empty list.
 */
export function useApiList<T>(
  fetchPage: (cursor: string | null) => Promise<AdminResult<{ items: T[]; next: string | null }>>,
  pollMs?: number,
): ApiList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  // Answers can overtake each other (poll vs. action reload): only the newest call may write.
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const res = await fetchPage(null);
    if (mine !== seq.current) return;
    setLoading(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setError(null);
    setItems(res.data.items);
    setNext(res.data.next);
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    const mine = ++seq.current;
    const res = await fetchPage(next);
    if (mine !== seq.current) return;
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setError(null);
    setItems((prev) => [...prev, ...res.data.items]);
    setNext(res.data.next);
  }, [fetchPage, next]);

  useEffect(() => {
    void reload();
    if (!pollMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, pollMs);
    return () => {
      window.clearInterval(id);
    };
  }, [reload, pollMs]);

  return { items, loading, error, next, reload, loadMore };
}
