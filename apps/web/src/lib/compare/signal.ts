/**
 * The facts the compare tray loader needs, kept apart from the store so every page ships only these few bytes:
 * the storage key and the event the store fires after each change in this tab (the `storage` event only fires in
 * other tabs). The store and the tray live in a chunk loaded once the list holds something (JS budget, 2026-11-13).
 *
 * Redesign 2026-11-14 (review C1): controls never show compare or cart-limit messages themselves. They `signal()`
 * on the same event: `ask` opens the tray's question or notice (the loader loads the tray if needed), `say` is
 * read out by the one live region in the loader. The question logic itself is in `prompt.ts` (tray only).
 */
export const COMPARE_KEY = 'mechdost-compare';
export const COMPARE_EVENT = 'mechdost-compare-change';

export type CompareSignal =
  | {
      ask: 'switch' | 'full' | 'save_failed';
      slug: string;
      category: string;
      /** The product's category name in the page language. */
      name?: string;
      lang?: string;
      /** The control that asked: focus returns there. */
      origin?: HTMLElement | null;
    }
  | { ask: 'notice'; text: string; origin?: HTMLElement | null }
  | { say: string };

export function signal(detail: CompareSignal): void {
  window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail }));
}
