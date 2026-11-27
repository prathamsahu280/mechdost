/**
 * Local drafts for the Ustaad composers (QA audit F-R14, founder approved 2026-11-27 night): text only, on this
 * device (a per-viewer convenience, never shared or sent). Every storage call is wrapped: private mode, a full or
 * blocked storage and server rendering all behave as "no draft".
 */
export const DRAFT_PREFIX = 'mechdost-ustaad-draft:';

export type DraftKey = 'post' | 'story' | 'question_title' | 'question_body' | `dm:${string}`;

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStore(): DraftStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(key: DraftKey, store: DraftStore | null = browserStore()): string {
  try {
    return store?.getItem(DRAFT_PREFIX + key) ?? '';
  } catch {
    return '';
  }
}

/** Saves the text; blank text removes the draft. */
export function saveDraft(key: DraftKey, text: string, store: DraftStore | null = browserStore()): void {
  try {
    if (!store) return;
    if (text.trim()) store.setItem(DRAFT_PREFIX + key, text);
    else store.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage full or blocked: the composer keeps working without a draft.
  }
}

export function clearDraft(key: DraftKey, store: DraftStore | null = browserStore()): void {
  try {
    store?.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage blocked: nothing was saved.
  }
}
