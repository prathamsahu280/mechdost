/**
 * The two facts the compare tray loader needs, kept apart from the store so every page ships only these few bytes:
 * the storage key and the event the store fires after each change in this tab (the `storage` event only fires in
 * other tabs). The store and the tray live in a chunk loaded once the list holds something (JS budget, 2026-11-13).
 */
export const COMPARE_KEY = 'mechdost-compare';
export const COMPARE_EVENT = 'mechdost-compare-change';
