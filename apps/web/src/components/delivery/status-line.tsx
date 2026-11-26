'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * One always-mounted live pair per screen (learning L-P23e; a11y review 2026-11-27): a polite status for results and
 * an alert for failures, both mounted from the start. A message is cleared, then set a moment later, so a repeat is
 * read again. No translations here, so admin, customer and shop screens can use it without the agent portal's bundle.
 * Place `line` in a part of the screen that stays mounted when the action reloads the list.
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
    <>
      <p role="status" className="text-sm font-bold text-success empty:sr-only">
        {msg?.tone === 'ok' ? msg.text : ''}
      </p>
      <p role="alert" className="text-sm font-bold text-error empty:sr-only">
        {msg?.tone === 'error' ? msg.text : ''}
      </p>
    </>
  );
  const clear = () => {
    setMsg(null);
  };
  return { say, clear, line };
}
