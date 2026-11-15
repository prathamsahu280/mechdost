import { useSyncExternalStore } from 'react';
import { WishlistChangeDto, WishlistDto, type Wishlist } from '@mechdost/shared/wishlist-api';
import { authed } from './orders-api';

/**
 * The signed-in customer's wishlist on this page (design 2026-11-15 item 5): the slugs, loaded once per page load,
 * shared by every heart and by the account list through `useSyncExternalStore`. A press updates the screen at once and
 * is sent to the API; if the API refuses, the screen goes back and the caller gets the error code (`WISHLIST_FULL`,
 * `AUTH_REQUIRED`, ...). The API is the only copy of the list; nothing is kept in the browser's storage. Loaded only
 * by the lazy wishlist screens, real sign-in mode only.
 */
interface State {
  /** The first load has finished (a failed load counts: hearts then show "not saved" rather than spin forever). */
  ready: boolean;
  slugs: ReadonlySet<string>;
}

let state: State = { ready: false, slugs: new Set() };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const server: State = { ready: false, slugs: new Set() };

export const useWishlistState = (): State =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => server,
  );

/** Read the list once per page load (later calls wait for the same request). */
export function ensureWishlist(locale: string): Promise<void> {
  loading ??= authed(locale, `/me/wishlist?locale=${locale === 'hi' ? 'hi' : 'en'}`, WishlistDto).then(
    (res) => {
      set({ ready: true, slugs: new Set(res.ok ? res.data.items.map((i) => i.slug) : []) });
    },
  );
  return loading;
}

/** Load the full list for the account screen (also refreshes the shared slugs). */
export async function fetchWishlist(
  locale: string,
): Promise<{ ok: true; data: Wishlist } | { ok: false; code: string }> {
  const res = await authed(locale, `/me/wishlist?locale=${locale === 'hi' ? 'hi' : 'en'}`, WishlistDto);
  if (!res.ok) return { ok: false, code: res.code };
  set({ ready: true, slugs: new Set(res.data.items.map((i) => i.slug)) });
  return { ok: true, data: res.data };
}

/** Put a product on the list or take it off. Resolves to null on success, or the API's error code. */
export async function setWishlisted(locale: string, slug: string, on: boolean): Promise<string | null> {
  const before = state;
  const next = new Set(state.slugs);
  if (on) next.add(slug);
  else next.delete(slug);
  set({ ready: true, slugs: next });
  const res = await authed(locale, `/me/wishlist/${encodeURIComponent(slug)}`, WishlistChangeDto, {
    method: on ? 'PUT' : 'DELETE',
  });
  if (res.ok) return null;
  set(before);
  return res.code;
}
