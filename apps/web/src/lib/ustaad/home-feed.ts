import type { FeedTab } from '@mechdost/shared/ustaad/dto/feed';

/**
 * Home feed helpers (UI upgrade U1, design § 3.1): the "See new posts" check runs every 90 s, only while the page is
 * visible and the phone's data saver is off; each feed tab keeps its own scroll position for the session (no reload
 * feel when switching For you ↔ Following).
 */
export const FRESH_POLL_MS = 90_000;

export function shouldPollFresh(env: { hidden: boolean; saveData: boolean }): boolean {
  return !env.hidden && !env.saveData;
}

interface ScrollStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const scrollKey = (tab: FeedTab) => `ustaad:feed-scroll:${tab}`;

export function rememberScroll(store: ScrollStore, tab: FeedTab, y: number): void {
  store.setItem(scrollKey(tab), String(Math.max(0, Math.round(y))));
}

export function recallScroll(store: ScrollStore, tab: FeedTab): number {
  const n = Number(store.getItem(scrollKey(tab)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
