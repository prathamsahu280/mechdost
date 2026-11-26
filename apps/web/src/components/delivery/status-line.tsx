'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * One always-mounted live line per screen (learning L-P23e): cleared, then set a moment later, so a repeated message is
 * read again. `tone` only colours the visible text. No translations here, so admin, customer and shop screens can use
 * it without the agent portal's message bundle.
 */
export function useStatusLine() {
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = (text: string, tone: 'ok' | 'error' = 'ok') => {
    clearTimeout(timer.current);
    setMsg(null);
    timer.current = setTimeout(() => {
      setMsg({ text, tone });
    }, 60);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const line = (
    <p
      role="status"
      className={`text-sm font-bold empty:sr-only ${msg?.tone === 'error' ? 'text-error' : 'text-success'}`}
    >
      {msg?.text ?? ''}
    </p>
  );
  const clear = () => {
    setMsg(null);
  };
  return { say, clear, line };
}
