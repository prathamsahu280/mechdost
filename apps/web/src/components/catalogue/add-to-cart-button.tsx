'use client';

import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { addToCart, MAX_QTY, removeFromCart, setQuantity, useCart, type AddResult } from '@/demo/store';

export interface AddToCartLabels {
  add: string;
  added: string;
  maxQty: string;
  maxLines: string;
  /** The browser refused to save the cart (private mode, storage full): nothing was added (review B11). */
  saveFailed: string;
  /** The quantity stepper (user 2026-11-14, "like swiggy or amazon"); names include the product. */
  increase: string;
  decrease: string;
  remove: string;
  /** "# in cart": `#` is replaced with the quantity. */
  inCart: string;
}

/**
 * "Add to cart", then — once the product is in the cart — a − / count / + stepper in the same place (user
 * 2026-11-14: "add the quantity in there itself too just like swiggy or amazon"). − at one removes it and "Add to
 * cart" comes back; + stops at the per-product limit. Feedback is announced (aria-live), no modal, no navigation.
 * Labels arrive translated from the server so no i18n runtime ships with this island.
 */
export function AddToCartButton({
  slug,
  sku,
  labels,
  qty = 1,
  className = '',
  source,
}: {
  slug: string;
  /** The pack's SKU (products from the API): stored on the cart line for the checkout quote. */
  sku?: string | null;
  labels: AddToCartLabels;
  qty?: number;
  className?: string;
  /** Where the press came from, for analytics (the comparison table). */
  source?: 'compare';
}) {
  const [result, setResult] = useState<AddResult | null>(null);
  const inCart = useCart().find((l) => l.slug === slug)?.qty ?? 0;

  // Only the success message clears itself; an error stays until the next press (a11y review 2026-11-11).
  useEffect(() => {
    if (result !== 'added') return;
    const id = window.setTimeout(() => {
      setResult(null);
    }, 2200);
    return () => {
      window.clearTimeout(id);
    };
  }, [result]);

  function add(n: number) {
    const r = addToCart(slug, n, sku ?? undefined);
    // Clear first, so the same message pressed twice changes the status text and is announced again.
    setResult(null);
    window.requestAnimationFrame(() => {
      setResult(r);
    });
    if (r === 'added') track('add_to_cart', source ? { slug, qty: n, source } : { slug, qty: n });
    else if (r === 'save_failed')
      track('click', { id: 'add_to_cart_save_failed', path: window.location.pathname });
  }

  const message =
    result === 'added'
      ? labels.inCart.replace('#', String(inCart))
      : result === 'max_qty'
        ? labels.maxQty
        : result === 'max_lines'
          ? labels.maxLines
          : result === 'save_failed'
            ? labels.saveFailed
            : '';

  const [inCartBefore = '', inCartAfter = ''] = labels.inCart.split('#');
  const stepButton =
    'press inline-flex size-11 shrink-0 items-center justify-center rounded-button text-accent-soft-text hover:bg-surface disabled:opacity-40';

  return (
    <>
      {inCart > 0 ? (
        <div
          className={`@container flex min-h-11 w-full min-w-0 items-center justify-between gap-1 rounded-button border-2 border-accent-button bg-accent-soft ${className}`}
        >
          <button
            type="button"
            aria-label={inCart === 1 ? labels.remove : labels.decrease}
            onClick={() => {
              if (inCart === 1) {
                removeFromCart(slug);
                track('remove_from_cart', { slug });
              } else {
                setQuantity(slug, inCart - 1);
                track('click', { id: 'cart_qty_decrease', path: window.location.pathname });
              }
              setResult(null);
            }}
            className={stepButton}
          >
            {inCart === 1 ? (
              <Trash2 aria-hidden="true" className="size-4" />
            ) : (
              <Minus aria-hidden="true" className="size-4" strokeWidth={3} />
            )}
          </button>
          {/* Narrow cards (two columns on phones) show just the number, like "− 2 +"; with room the words show too.
              The words always stay for screen readers (QA 2026-11-14: "1 in cart" widened a 480 px page). */}
          <span className="min-w-0 text-sm font-extrabold whitespace-nowrap text-accent-soft-text tabular-nums">
            <span className="sr-only @min-[11rem]:not-sr-only">{inCartBefore}</span>
            {inCart}
            <span className="sr-only @min-[11rem]:not-sr-only">{inCartAfter}</span>
          </span>
          <button
            type="button"
            aria-label={labels.increase}
            disabled={inCart >= MAX_QTY}
            onClick={() => {
              add(1);
            }}
            className={stepButton}
          >
            <Plus aria-hidden="true" className="size-4" strokeWidth={3} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            add(qty);
          }}
          className={`press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-button bg-accent-button px-5 text-sm font-bold text-white transition-colors duration-[var(--duration-base)] hover:bg-accent-button-hover ${className}`}
        >
          <ShoppingCart aria-hidden="true" className="size-4" />
          {labels.add}
        </button>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {result && result !== 'added' ? <p className="mt-2 text-xs font-bold text-error">{message}</p> : null}
    </>
  );
}
