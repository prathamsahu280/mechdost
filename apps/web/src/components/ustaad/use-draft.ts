'use client';

import { useCallback, useEffect, useRef } from 'react';
import { clearDraft, readDraft, saveDraft, type DraftKey } from '@/lib/ustaad/draft';

/**
 * Keeps `text` as a local draft under `key` (QA audit F-R14): restores it once when the composer opens (after
 * hydration, so server and client markup match), saves every change, and asks before the tab is closed or reloaded
 * while unsent text is in the box. `active` is false once the text has been sent (the composer shows its "done"
 * state): nothing is saved and nothing is asked. Returns `clear`, called on a successful send.
 */
export function useDraft(
  key: DraftKey,
  text: string,
  restore: (draft: string) => void,
  active = true,
): () => void {
  const skipSave = useRef(false);

  useEffect(() => {
    const draft = readDraft(key);
    if (draft) {
      skipSave.current = true; // the save below would see the empty box before the restored text lands
      restore(draft);
    }
  }, [key, restore]);

  useEffect(() => {
    if (!active) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    saveDraft(key, text);
  }, [key, text, active]);

  const unsent = active && text.trim() !== '';
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [unsent]);

  return useCallback(() => {
    clearDraft(key);
  }, [key]);
}
