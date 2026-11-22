'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useCart } from '@/demo/store';
import { isPortalPath } from '@/lib/portal-path';

/**
 * Header cart pill with a live count. `countText` holds server-translated variants for 0, 1 and many
 * (`#` is replaced) so no i18n runtime ships with the header. Fixed width digits keep the pill from shifting.
 */
export function CartPill({
  href,
  label,
  icon,
  countText,
}: {
  href: string;
  label: string;
  /** The cart icon, rendered by the server (no icon code in the browser bundle). */
  icon: ReactNode;
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
        // v4 (decision 2026-11-23): a quiet icon button on phones, the navy cart button (accent in dark mode) from 640 px.
        className="press relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-pill sm:size-auto sm:h-10 sm:gap-2.5 sm:bg-cart sm:pr-2 sm:pl-3.5 sm:text-[14px] sm:font-bold sm:text-white sm:shadow-[0_8px_18px_-8px_rgb(16_31_52/0.7)] sm:hover:bg-cart sm:hover:brightness-110"
      >
        <span aria-hidden="true" className="flex">
          {icon}
        </span>
        <span className="sr-only sm:not-sr-only">{label}</span>
        <span
          aria-hidden="true"
          // Fixed box (user 2026-11-22: "the top bar keeps moving with the cart items"): the same size for 0, 1, 12 or
          // 99+, so the header never reflows when the count changes. On phones it is a small badge on the icon.
          className={`grid size-[18px] place-items-center rounded-full bg-cart-badge text-[9px] font-extrabold text-cart-badge-text tabular-nums max-sm:absolute max-sm:top-0 max-sm:right-0 sm:size-6 sm:rounded-lg sm:text-xs ${
            count > 0 ? '' : 'max-sm:invisible'
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
