'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useCart } from '@/demo/store';
import { CART_LANDED_EVENT } from '@/lib/cart-fly';
import { UI_ICONS } from '@/lib/icons';

/**
 * Header cart pill with a live count. `countText` holds server-translated variants for 0, 1 and many
 * (`#` is replaced) so no i18n runtime ships with the header. Fixed width digits keep the pill from shifting.
 * `data-cart-target`: add-to-cart's flying chip lands here, then the pill bumps (lib/cart-fly.ts).
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
  const pill = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const bump = () => {
      const el = pill.current;
      if (!el) return;
      // Remove, then re-add on the next frame, so the animation restarts on rapid adds.
      el.classList.remove('cart-bump');
      requestAnimationFrame(() => {
        el.classList.add('cart-bump');
      });
    };
    window.addEventListener(CART_LANDED_EVENT, bump);
    return () => {
      window.removeEventListener(CART_LANDED_EVENT, bump);
    };
  }, []);

  const count = lines.reduce((n, l) => n + l.qty, 0);
  const sr = (count === 0 ? countText.zero : count === 1 ? countText.one : countText.other).replace(
    '#',
    String(count),
  );
  return (
    <Link
      ref={pill}
      href={href}
      data-cart-target
      data-track="header_cart"
      className="press inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-line-card bg-pill px-3 font-bold text-[13px] text-ink min-[400px]:px-4"
    >
      <UI_ICONS.cart aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={2.25} />
      <span className="sr-only min-[480px]:not-sr-only">{label}</span>
      <span
        key={count}
        aria-hidden="true"
        className={`cart-count min-w-[1.25rem] rounded-full text-center font-bold tabular-nums ${
          count > 0 ? 'bg-accent-button px-1.5 text-white' : 'text-accent-soft-text'
        }`}
      >
        {count}
      </span>
      <span className="sr-only">, {sr}</span>
    </Link>
  );
}
