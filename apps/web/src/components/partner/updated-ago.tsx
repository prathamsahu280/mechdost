'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useNow } from '@/components/portal/use-now';
import { minutesAgo } from '@/lib/partner-kit';

/**
 * "Updated 2 min ago · Refresh" and, when the device is offline, a plain line that says so (design 2026-11-27 § 2.7,
 * § 4). `at` is when the list last loaded (ms), or null while the first load runs.
 */
export function UpdatedAgo({ at, onRefresh }: { at: number | null; onRefresh?: () => void }) {
  const t = useTranslations('partnerKit');
  const now = useNow(30_000);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine);
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  const mins = at === null ? null : minutesAgo(at, Math.max(now, at));
  return (
    <div className="grid gap-1 text-sm">
      {!online ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-button bg-warning-bg px-3 py-2 font-bold text-warning"
        >
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          {t('offline')}
        </p>
      ) : null}
      {mins !== null ? (
        <p className="flex flex-wrap items-center gap-x-2 text-muted">
          <span>{mins === 0 ? t('updated_now') : t('updated_ago', { minutes: mins })}</span>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex min-h-11 items-center gap-1 font-bold text-ink underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {t('refresh')}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
