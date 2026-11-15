'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { COMPARE_EVENT, COMPARE_KEY, type CompareSignal } from '@/lib/compare/signal';
import type { CompareTrayLabels } from './compare-tray';

type Ask = Exclude<CompareSignal, { say: string }>;

interface TrayProps {
  labels: CompareTrayLabels;
  prefix: string;
  /** The latest question or notice a control asked for (a new object each time). */
  request: Ask | null;
}

/** Two or more products are stored under the compare key (the tray itself validates it). */
function hasList(): boolean {
  try {
    const raw = window.localStorage.getItem(COMPARE_KEY);
    // Two or more products: one has nothing to compare, the bar appears from two (decision 2026-11-15).
    return raw ? /"slugs":\["[^"]+","/.test(raw) : false;
  } catch {
    return false;
  }
}

/**
 * Mounted on every page (locale layout): loads the compare tray and its store only once the list holds something
 * — in this tab (the store's change event) or another (`storage`) — or once a control asks something (another
 * category, a full list, a refused save, a cart limit; redesign 2026-11-14). Pages where nobody compares ship a
 * few hundred bytes, not the tray (JS budget, 2026-11-13).
 *
 * It also owns the one live region for compare and cart feedback (review 2026-11-14, I5): always mounted, so the
 * first message is read out; cleared, set on the next frame (a repeated message is read again), cleared again.
 */
export function CompareTrayLoader(props: Omit<TrayProps, 'request'>) {
  const [Tray, setTray] = useState<ComponentType<TrayProps> | null>(null);
  const [request, setRequest] = useState<Ask | null>(null);
  const [said, setSaid] = useState('');

  useEffect(() => {
    let started = false;
    let timer = 0;
    const check = (e?: Event) => {
      const d: unknown = e instanceof CustomEvent ? e.detail : null;
      const sig = typeof d === 'object' && d !== null ? (d as CompareSignal) : null;
      if (sig && 'say' in sig) {
        setSaid('');
        window.clearTimeout(timer);
        window.requestAnimationFrame(() => {
          setSaid(sig.say);
          timer = window.setTimeout(() => {
            setSaid('');
          }, 5000);
        });
        return;
      }
      if (sig && 'ask' in sig) setRequest(sig);
      if (started || !(sig || hasList())) return;
      started = true;
      void import('./compare-tray').then((m) => {
        setTray(() => m.CompareTray);
      });
    };
    check();
    window.addEventListener(COMPARE_EVENT, check);
    window.addEventListener('storage', check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(COMPARE_EVENT, check);
      window.removeEventListener('storage', check);
    };
  }, []);

  return (
    <>
      <p role="status" className="sr-only">
        {said}
      </p>
      {Tray ? <Tray {...props} request={request} /> : null}
    </>
  );
}
