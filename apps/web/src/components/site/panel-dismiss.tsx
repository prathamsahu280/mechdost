'use client';

import { useEffect } from 'react';
import type * as RuntimeModule from '@/lib/panel-dismiss-runtime';

/** Same value as `TRIGGER_ATTR` in `lib/panel-dismiss.ts` (not imported: that module loads lazily). */
const TRIGGER = 'data-disclosure-trigger';

type Runtime = typeof RuntimeModule;

/**
 * Escape closes the open in-page panel and focus returns to its opener (user rule 2026-11-16, markup contract in
 * `lib/panel-dismiss.ts`). Mounted once in the locale layout, so this part stays tiny: the behaviour
 * (`lib/panel-dismiss-runtime.ts`) loads on the first panel-opener click or the first Escape, which keeps it out of
 * every page's first load (JS budget, spec 16; /shop and /cart went over 180 KB gz with a static import).
 */
export function PanelDismiss() {
  useEffect(() => {
    let runtime: Promise<Runtime> | null = null;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const load = (firstKey: string | null) => {
      runtime ??= import('@/lib/panel-dismiss-runtime').then((m) => {
        if (!cancelled) cleanup = m.installPanelDismiss(firstKey);
        return m;
      });
      return runtime;
    };
    function onClick(e: MouseEvent) {
      if (runtime) return;
      const opener = e.target instanceof Element ? e.target.closest(`[${TRIGGER}]`) : null;
      if (opener) void load(opener.getAttribute(TRIGGER));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      void load(null).then((m) => {
        m.onDismissKey(e);
      });
    }
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      cleanup?.();
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
