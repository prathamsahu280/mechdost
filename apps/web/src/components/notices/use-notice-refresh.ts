'use client';

import { useEffect } from 'react';
import { NOTICES_EVENT, type NoticesEventDetail } from '@/lib/notices-view';

/**
 * Refetch a list the moment the bell hears about something that changes it (spec 10, vendor assessment 2026-11-15:
 * "new offers must arrive live"). The bell polls the notifications every 15 s for partners and staff, and a push
 * wakes it at once; each arrival fires `mechdost:notices` with the kinds. This hook is tiny (no API code), so a
 * portal screen can use it without loading the bell. Cheap: the list is refetched only for the kinds given.
 */
export function useNoticeRefresh(kinds: readonly string[], reload: () => void | Promise<void>): void {
  const key = kinds.join('|');
  useEffect(() => {
    const wanted = new Set(key.split('|'));
    const onNotices = (event: Event) => {
      const detail = (event as CustomEvent<NoticesEventDetail>).detail;
      if (detail.kinds.some((k) => wanted.has(k))) void reload();
    };
    window.addEventListener(NOTICES_EVENT, onNotices);
    return () => {
      window.removeEventListener(NOTICES_EVENT, onNotices);
    };
  }, [key, reload]);
}
