'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/demo/session-state';
import { useCart } from '@/demo/store';
import { AUTH_MODE } from '@/lib/auth/mode';
import { UI_EMOJI } from '@/lib/emoji';
import { isPortalPath } from '@/lib/portal-path';

/**
 * Header cart pill with a live count. `countText` holds server-translated variants for 0, 1 and many
 * (`#` is replaced) so no i18n runtime ships with the header. Fixed width digits keep the pill from shifting.
 */
export function CartPill({
  href,
  label,
  countText,
}: {
  href: string;
  label: string;
  countText: { zero: string; one: string; other: string };
}) {
  const lines = useCart();
  const pathname = usePathname();
  const signedIn = useSession() !== null;
  const locale = pathname === '/hi' || pathname.startsWith('/hi/') ? 'hi' : 'en';
  // Real sign-in mode only (a build-time constant: the demo build drops this): the saved cart follows the customer.
  // The sync module is fetched only when someone is signed in, so a signed-out visit loads nothing extra.
  useEffect(() => {
    if (AUTH_MODE !== 'firebase' || !signedIn) return;
    void import('@/lib/cart-sync').then((m) => {
      m.syncCart(locale);
    });
  }, [signedIn, lines, locale]);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const sr = (count === 0 ? countText.zero : count === 1 ? countText.one : countText.other).replace(
    '#',
    String(count),
  );
  // Partners and staff at work in a portal are not shopping (QA 2026-11-14, U16); the storefront keeps the cart.
  if (isPortalPath(pathname)) return null;
  return (
    <Link
      href={href}
      data-track="header_cart"
      className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-line-card bg-pill px-3 font-bold text-[13px] text-ink min-[440px]:px-4"
    >
      <span aria-hidden="true" className="text-[18px] leading-none">
        {UI_EMOJI.cart}
      </span>
      <span className="sr-only min-[480px]:not-sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={`min-w-[1.25rem] rounded-full text-center font-bold tabular-nums ${
          count > 0 ? 'bg-accent-button px-1.5 text-white' : 'text-accent-soft-text'
        }`}
      >
        {count}
      </span>
      <span className="sr-only">, {sr}</span>
    </Link>
  );
}
