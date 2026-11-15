'use client';

import { useEffect, useState } from 'react';

/** Current time, refreshed every `ms` so countdowns update without re-rendering every frame. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, ms);
    return () => {
      window.clearInterval(id);
    };
  }, [ms]);
  return now;
}
