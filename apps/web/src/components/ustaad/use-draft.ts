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

  // On open and on every key change (another message thread in the same mounted composer) the box shows that key's
  // draft, or nothing: text typed for one thread never lands under another's key. The save below is skipped once, as it
  // still sees the old text in this commit. `restore` must be stable (a state setter or a useCallback).
  useEffect(() => {
    skipSave.current = true; // the save below would see the old box before the restored text lands
    restore(readDraft(key));
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
