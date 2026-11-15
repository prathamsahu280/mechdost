'use client';

import { Heart } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/demo/session-state';
import { track } from '@/lib/analytics';
import { signal } from '@/lib/compare/signal';
import { ensureWishlist, setWishlisted, useWishlistState } from '@/lib/wishlist-store';

export interface WishlistLabels {
  /** "Save {name} to your wishlist" / "Remove {name} from your wishlist" (names include the product). */
  add: string;
  remove: string;
  saved: string;
  removed: string;
  full: string;
  failed: string;
  signIn: string;
  /** Page button text. */
  pageSave: string;
  pageSaved: string;
}

/**
 * The wishlist heart on a product card and on the product page (design 2026-11-15 item 5), the real chunk behind
 * `wishlist-lazy.tsx` (nothing eager imports this file). A toggle button: pressed means saved. Signed out, a press asks
 * the shopper to sign in and brings them back to this page. The list is read once per page load and only when someone
 * is signed in, so a signed-out visit makes no request. Results are read out by the shared live region; problems show
 * as the compare tray's notice (no layout shift on the card).
 */
export default function WishlistHeart({
  slug,
  labels,
  source,
}: {
  slug: string;
  labels: WishlistLabels;
  source: 'card' | 'page';
}) {
  // From the path, not next-intl: the heart also sits on cards outside the shop's intl provider (the home page), where
  // useLocale() throws while prerendering (real-sign-in build 2026-11-15).
  const pathname = usePathname();
  const locale = pathname === '/hi' || pathname.startsWith('/hi/') ? 'hi' : 'en';
  const router = useRouter();
  const signedIn = useSession() !== null;
  const { ready, slugs } = useWishlistState();
  const on = slugs.has(slug);

  useEffect(() => {
    if (signedIn) void ensureWishlist(locale);
  }, [signedIn, locale]);

  async function press(origin: HTMLElement) {
    if (!signedIn) {
      track('wishlist_sign_in_prompted', { slug });
      const prefix = locale === 'hi' ? '/hi' : '';
      const here = `${window.location.pathname}${window.location.search}`;
      router.push(`${prefix}/login?next=${encodeURIComponent(here)}`);
      return;
    }
    const next = !on;
    const code = await setWishlisted(locale, slug, next);
    if (code === null) {
      track('wishlist_toggled', { slug, on: next, source });
      signal({ say: next ? labels.saved : labels.removed });
      return;
    }
    signal({
      ask: 'notice',
      text: code === 'WISHLIST_FULL' ? labels.full : code === 'AUTH_REQUIRED' ? labels.signIn : labels.failed,
      origin,
    });
  }

  const label = on ? labels.remove : labels.add;
  const busy = signedIn && !ready;
  if (source === 'page')
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-busy={busy}
        aria-label={label}
        onClick={(e) => void press(e.currentTarget)}
        className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
      >
        <Heart aria-hidden="true" className={`size-5 ${on ? 'fill-accent text-accent' : ''}`} />
        {on ? labels.pageSaved : labels.pageSave}
      </button>
    );
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-busy={busy}
      aria-label={label}
      onClick={(e) => void press(e.currentTarget)}
      className="press absolute top-[3.75rem] right-3 z-10 inline-flex size-10 items-center justify-center rounded-full bg-surface/95 text-ink shadow-card hover:bg-surface"
    >
      <Heart aria-hidden="true" className={`size-5 ${on ? 'fill-accent text-accent' : ''}`} />
    </button>
  );
}
