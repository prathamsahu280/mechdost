'use client';

import Link from 'next/link';
import { useCart } from '@/demo/store';
import { UI_EMOJI } from '@/lib/emoji';

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
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const sr = (count === 0 ? countText.zero : count === 1 ? countText.one : countText.other).replace(
    '#',
    String(count),
  );
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
