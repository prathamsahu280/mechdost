'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Flash {
  tone: 'ok' | 'warn';
  text: string;
}

const SHOW_MS = 10_000;

/**
 * One calm confirmation line for the shop portal (assessment 2026-11-15, item 4): set after a step went through, it
 * stays for a few seconds and then goes. It lives in the parent of the list that reloads, so the message survives
 * the card it is about leaving the list (an order that is packed or delivered moves on).
 */
export function useFlash() {
  const [flash, setFlash] = useState<Flash | null>(null);
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setFlash(null);
  }, []);
  const show = useCallback((next: Flash) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFlash(next);
    timer.current = window.setTimeout(() => {
      setFlash(null);
      timer.current = null;
    }, SHOW_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return { flash, show, clear };
}

/**
 * The live region is always mounted (empty), so a screen reader announces the text when it appears. A warning is
 * announced assertively; a success politely.
 */
export function FlashNote({ flash, sticky = false }: { flash: Flash | null; sticky?: boolean }) {
  return (
    <div
      role={flash?.tone === 'warn' ? 'alert' : 'status'}
      aria-live={flash?.tone === 'warn' ? 'assertive' : 'polite'}
      // Under the sticky site header, so a confirmation is seen wherever the shop has scrolled to.
      className={sticky ? 'sticky top-20 z-10' : undefined}
    >
      {flash ? (
        <p
          className={`rounded-card px-4 py-3 text-sm font-bold ${
            flash.tone === 'warn' ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'
          }`}
        >
          {flash.text}
        </p>
      ) : null}
    </div>
  );
}
