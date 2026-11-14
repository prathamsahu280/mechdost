'use client';

import { useEffect, useState, type ComponentType } from 'react';
import { COMPARE_EVENT, COMPARE_KEY } from '@/lib/compare/signal';
import type { CompareTrayLabels } from './compare-tray';

interface TrayProps {
  labels: CompareTrayLabels;
  prefix: string;
}

/** Something is stored under the compare key (the tray itself validates it). */
function hasList(): boolean {
  try {
    const raw = window.localStorage.getItem(COMPARE_KEY);
    return raw?.includes('"slugs":["') ?? false;
  } catch {
    return false;
  }
}

/**
 * Mounted on every page (locale layout): loads the compare tray and its store only once the list holds something
 * — in this tab (the store's change event) or another (`storage`). Pages where nobody compares ship a few hundred
 * bytes, not the tray (JS budget, 2026-11-13).
 */
export function CompareTrayLoader(props: TrayProps) {
  const [Tray, setTray] = useState<ComponentType<TrayProps> | null>(null);
  useEffect(() => {
    let started = false;
    // `prompt`: the store has something to ask or tell (another category, a refused save) — load the tray even
    // while the list is empty (redesign 2026-11-14).
    const check = (e?: Event) => {
      if (started || !(hasList() || (e instanceof CustomEvent && e.detail === 'prompt'))) return;
      started = true;
      void import('./compare-tray').then((m) => {
        setTray(() => m.CompareTray);
      });
    };
    check();
    window.addEventListener(COMPARE_EVENT, check);
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener(COMPARE_EVENT, check);
      window.removeEventListener('storage', check);
    };
  }, []);
  return Tray ? <Tray {...props} /> : null;
}
