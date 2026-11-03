'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard focus for inline disclosures whose trigger is replaced while open (WCAG 2.2 2.4.3 focus order;
 * web-design-guidelines review 2026-11-03). Pass the key of what is open (or null). On open, focus moves to the
 * element marked `data-disclosure-field="<key>"`; on close, back to `data-disclosure-trigger="<key>"`, or to the
 * `fallback` trigger when that one is gone (e.g. the block that was just lifted). Runs after commit, so the
 * elements it looks for are already in the DOM.
 */
export function useDisclosureFocus(openKey: string | null, fallback?: string) {
  const previous = useRef(openKey);
  useEffect(() => {
    const was = previous.current;
    previous.current = openKey;
    if (was === openKey) return;
    const find = (attr: string, key: string) =>
      document.querySelector<HTMLElement>(`[data-disclosure-${attr}="${CSS.escape(key)}"]`);
    if (openKey) {
      find('field', openKey)?.focus();
    } else if (was) {
      (find('trigger', was) ?? (fallback ? find('trigger', fallback) : null))?.focus();
    }
  }, [openKey, fallback]);
}
