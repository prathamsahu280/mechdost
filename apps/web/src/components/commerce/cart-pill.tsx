'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { useCart } from '@/demo/store';
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
  const locale = pathname === '/hi' || pathname.startsWith('/hi/') ? 'hi' : 'en';
  const onCartPage = /\/(cart|checkout)(\/|$)/.test(pathname);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const sr = (count === 0 ? countText.zero : count === 1 ? countText.one : countText.other).replace(
    '#',
    String(count),
  );
  // Partners and staff at work in a portal are not shopping (QA 2026-11-14, U16); the storefront keeps the cart.
  if (isPortalPath(pathname)) return null;
  return (
    <>
      <CartSync locale={locale} onCartPage={onCartPage} />
      <Link
        href={href}
        data-track="header_cart"
        title={label}
        className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-line-card bg-pill px-2.5 font-bold text-[13px] text-ink min-[440px]:px-4"
      >
        <span aria-hidden="true" className="text-[18px] leading-none">
          {UI_EMOJI.cart}
        </span>
        <span className="sr-only min-[560px]:not-sr-only nav:sr-only xl:not-sr-only">{label}</span>
        <span
          aria-hidden="true"
          // Fixed box (user 2026-11-22: "the top bar keeps moving with the cart items"): same width and padding
          // for 0, 1, 12 or 99+, only the colours change, so the header never reflows when the count changes.
          className={`inline-block w-[1.75rem] rounded-full px-0.5 text-center font-bold tabular-nums ${
            count > 0 ? 'bg-accent-button text-white' : 'text-accent-soft-text'
          }`}
        >
          {count > 99 ? '99+' : count}
        </span>
        <span className="sr-only">, {sr}</span>
      </Link>
    </>
  );
}

interface SyncProps {
  locale: 'en' | 'hi';
  onCartPage: boolean;
}

/**
 * Real sign-in mode only: fetches the sync after the page loads (`import()` in an effect, not `next/dynamic`, so nothing
 * rides in the header's first load — spec 16 budget incident, guard `test/cart-pill-lazy.test.ts`).
 */
function RealCartSync(props: SyncProps) {
  const [Mount, setMount] = useState<ComponentType<SyncProps> | null>(null);
  useEffect(() => {
    let live = true;
    void import('./cart-sync-mount').then((m) => {
      if (live) setMount(() => m.default);
    });
    return () => {
      live = false;
    };
  }, []);
  return Mount ? <Mount {...props} /> : null;
}

function NoCartSync() {
  return null;
}

/** Chosen at build time: the demo build drops the sync entirely. */
// The env value is inlined here (not the imported AUTH_MODE): the minifier folds a literal only inside one module.
const CartSync = process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? RealCartSync : NoCartSync;
