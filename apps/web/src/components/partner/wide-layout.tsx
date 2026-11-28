'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const WIDE = '(min-width: 1024px)';

/** True at the `nav:` breakpoint (1024 px) and wider. Read it inside effects and event handlers, never to pick a layout. */
export function isWideNow(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(WIDE).matches;
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', onChange);
  return () => {
    mq.removeEventListener('change', onChange);
  };
}

/**
 * Chooses between two renderings of the same *content* (compact master rows beside the open item, or the stacked
 * cards on a phone). Only content differs: the frame around it is CSS-driven (`nav:` classes), so the server HTML and
 * the first paint match at every width and nothing shifts when this switches after hydration. Only the chosen
 * variant is mounted, so an item is never in the page twice.
 */
export function WideSwitch({ wide, narrow }: { wide: ReactNode; narrow: ReactNode }) {
  const isWide = useSyncExternalStore(subscribe, isWideNow, () => false);
  return <>{isWide ? wide : narrow}</>;
}
