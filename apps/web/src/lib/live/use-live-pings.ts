'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useLocale } from 'next-intl';
import type { LiveKind } from '@mechdost/shared/live';
import { startLive, subscribeLive } from './live-hub';

/**
 * Run `onPing` when a live ping of one of `kinds` arrives (spec 10 "Live updates", design 2026-11-16). The screen keeps
 * its own polling as the fallback: without `LIVE_TRANSPORT=rtdb` and the database URL `startLive` connects nothing and
 * this hook does nothing, so a build without live updates behaves exactly as before. Light on purpose: it imports the
 * hub only (the database SDK arrives lazily through the hub, after sign-in, while the tab is visible).
 */
export function useLivePings(kinds: readonly LiveKind[], onPing: () => void, enabled = true): void {
  const locale = useLocale();
  const latest = useRef(onPing);
  useEffect(() => {
    latest.current = onPing;
  }, [onPing]);
  const key = kinds.join(',');
  const list = useMemo(() => (key ? (key.split(',') as LiveKind[]) : []), [key]);
  useEffect(() => {
    if (!enabled || list.length === 0) return;
    const unsubscribe = subscribeLive(list, () => {
      latest.current();
    });
    const release = startLive(locale);
    return () => {
      unsubscribe();
      release();
    };
  }, [enabled, list, locale]);
}
