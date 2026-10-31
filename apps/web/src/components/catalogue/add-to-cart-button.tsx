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

  useEffect(() => {
    if (!result) return;
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
          : '';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const r = addToCart(slug, qty);
          setResult(r);
          if (r === 'added') track('add_to_cart', { slug, qty });
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
