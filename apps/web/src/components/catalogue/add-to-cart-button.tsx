'use client';

import { Check, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';
import { addToCart, type AddResult } from '@/demo/store';

export interface AddToCartLabels {
  add: string;
  added: string;
  maxQty: string;
  maxLines: string;
  /** The browser refused to save the cart (private mode, storage full): nothing was added (review B11). */
  saveFailed: string;
}

/**
 * Adds a demo product to the cart with immediate, announced feedback (aria-live) — no modal, no navigation.
 * Labels arrive translated from the server so no i18n runtime ships with this island.
 */
export function AddToCartButton({
  slug,
  labels,
  qty = 1,
  className = '',
}: {
  slug: string;
  labels: AddToCartLabels;
  qty?: number;
  className?: string;
}) {
  const [result, setResult] = useState<AddResult | null>(null);

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

  const added = result === 'added';
  const message =
    result === 'added'
      ? labels.added
      : result === 'max_qty'
        ? labels.maxQty
        : result === 'max_lines'
          ? labels.maxLines
          : result === 'save_failed'
            ? labels.saveFailed
            : '';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const r = addToCart(slug, qty);
          // Clear first, so the same message pressed twice changes the status text and is announced again.
          setResult(null);
          window.requestAnimationFrame(() => {
            setResult(r);
          });
          if (r === 'added') track('add_to_cart', { slug, qty });
          else if (r === 'save_failed')
            track('click', { id: 'add_to_cart_save_failed', path: window.location.pathname });
        }}
        className={`press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-button px-5 text-sm font-bold text-white transition-colors duration-[var(--duration-base)] ${
          added ? 'bg-success' : 'bg-accent-button hover:bg-accent-button-hover'
        } ${className}`}
      >
        {added ? (
          <Check aria-hidden="true" className="size-4" strokeWidth={3} />
        ) : (
          <ShoppingCart aria-hidden="true" className="size-4" />
        )}
        {added ? labels.added : labels.add}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {result && result !== 'added' ? <p className="mt-2 text-xs font-bold text-error">{message}</p> : null}
    </>
  );
}
