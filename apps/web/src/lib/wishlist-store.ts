import { useSyncExternalStore } from 'react';
import {
  WishlistChangeDto,
  WishlistDto,
  WishlistUnchangedDto,
  type Wishlist,
} from '@mechdost/shared/wishlist-api';
import { authed } from './orders-api';

/**
 * The signed-in customer's wishlist (design 2026-11-15 item 5): the slugs, shared by every heart and by the account
 * list through `useSyncExternalStore`. A press updates the screen at once and is sent to the API (adding twice or
 * removing a missing product is fine, so two devices cannot error each other); if the API refuses, the screen goes back
 * and the caller gets the error code (`WISHLIST_FULL`, `AUTH_REQUIRED`, ...). The API is the only copy of the list;
 * nothing is kept in the browser's storage. `refreshWishlist` re-reads it (with `since=<version>`, so "unchanged" is a
 * tiny answer) when the poll, a tab coming back or the future live listener asks. Loaded only by the lazy wishlist
 * screens and the storefront sync, real sign-in mode only.
 */
interface State {
  /** The first load has finished (a failed load counts: hearts then show "not saved" rather than spin forever). */
  ready: boolean;
  slugs: ReadonlySet<string>;
  /** The list's version the slugs belong to; -1 when unknown (the next read fetches the list). */
  version: number;
}

const EMPTY: State = { ready: false, slugs: new Set(), version: -1 };
let state: State = EMPTY;
let loading: Promise<void> | null = null;
/** Whose list `state` is (shared devices, security review 2026-11-15), and a counter that makes late answers stale. */
let stateUid: string | null = null;
let generation = 0;
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

export const useWishlistState = (): State =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );

/**
 * Sign-out, or a different account: forget the list and make every answer still on its way stale, so one customer's
 * hearts never show for the next one on the same device.
 */
export function resetWishlist(): void {
  generation += 1;
  loading = null;
  stateUid = null;
  set(EMPTY);
}

/** For tests: the cached state. */
export const __stateForTest = (): State => state;

const query = (locale: string) => `locale=${locale === 'hi' ? 'hi' : 'en'}`;
const slugsOf = (list: Wishlist) => new Set(list.items.map((i) => i.slug));

async function uidNow(locale: string): Promise<string | null> {
  const { currentUid } = await import('./auth/firebase-client');
  return currentUid(locale).catch(() => null);
}

/** Read the list once per page load and account (later calls wait for the same request). */
export async function ensureWishlist(locale: string): Promise<void> {
  const uid = await uidNow(locale);
  if (!uid) {
    if (stateUid !== null) resetWishlist();
    return;
  }
  if (stateUid !== null && stateUid !== uid) resetWishlist();
  if (loading) return loading;
  stateUid = uid;
  const gen = generation;
  loading = authed(locale, `/me/wishlist?${query(locale)}`, WishlistDto).then((res) => {
    if (gen !== generation) return;
    set(
      res.ok
        ? { ready: true, slugs: slugsOf(res.data), version: res.data.version }
        : { ready: true, slugs: new Set(), version: -1 },
    );
  });
  return loading;
}

/**
 * Re-read the list from the server: the poll, a tab coming back, opening the cart, and later the live listener all call
 * this. Resolves to false when the read failed (the poller backs off). Nothing is rewritten when the list is unchanged.
 */
export async function refreshWishlist(locale: string): Promise<boolean> {
  const uid = await uidNow(locale);
  if (!uid) {
    if (stateUid !== null) resetWishlist();
    return true;
  }
  if (stateUid !== uid || !state.ready) {
    await ensureWishlist(locale);
    return state.ready && state.version >= 0;
  }
  const gen = generation;
  const res = await authed(
    locale,
    `/me/wishlist?${query(locale)}&since=${String(state.version)}`,
    WishlistDto.or(WishlistUnchangedDto),
  );
  if (!res.ok) return false;
  if (gen !== generation || 'unchanged' in res.data) return true;
  set({ ready: true, slugs: slugsOf(res.data), version: res.data.version });
  return true;
}

/** Load the full list for the account screen (also refreshes the shared slugs). */
export async function fetchWishlist(
  locale: string,
): Promise<{ ok: true; data: Wishlist } | { ok: false; code: string }> {
  const gen = generation;
  const res = await authed(locale, `/me/wishlist?${query(locale)}`, WishlistDto);
  if (!res.ok) return { ok: false, code: res.code };
  if (gen !== generation) return { ok: false, code: 'STALE_SESSION' };
  set({ ready: true, slugs: slugsOf(res.data), version: res.data.version });
  return { ok: true, data: res.data };
}

/** Put a product on the list or take it off. Resolves to null on success, or the API's error code. */
export async function setWishlisted(locale: string, slug: string, on: boolean): Promise<string | null> {
  const before = state;
  const gen = generation;
  const next = new Set(state.slugs);
  if (on) next.add(slug);
  else next.delete(slug);
  set({ ready: true, slugs: next, version: state.version });
  const res = await authed(locale, `/me/wishlist/${encodeURIComponent(slug)}`, WishlistChangeDto, {
    method: on ? 'PUT' : 'DELETE',
  });
  if (gen !== generation) return res.ok ? null : res.code;
  if (res.ok) {
    // If the server's count is not ours, another device changed the list too: leave the version unknown so the next
    // refresh reads the list instead of trusting this answer.
    set({
      ready: true,
      slugs: state.slugs,
      version: res.data.count === state.slugs.size ? res.data.version : -1,
    });
    return null;
  }
  set(before);
  return res.code;
}
