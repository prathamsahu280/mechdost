'use client';

import { Check, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { addToCart, type AddResult } from '@/demo/store';
import { CART_LANDED_EVENT, flyToCart } from '@/lib/cart-fly';

export interface AddToCartLabels {
  add: string;
  added: string;
  maxQty: string;
  maxLines: string;
}

/**
 * Adds a demo product to the cart with immediate, announced feedback (aria-live) — no modal, no navigation.
 * Motion (user 2026-11-09: "Add to Cart me iska animation aur accha karna hai"): the button presses in, the cart
 * icon swaps for a check that draws itself, and a "+qty" chip flies along an arc to the header cart, which bumps
 * when it lands. Reduced motion: the swap and the announcement only, the cart still bumps-free updates.
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
  // Bumped on every successful add so the pulse restarts even while "Added" is still showing.
  const [pulse, setPulse] = useState(0);
  const button = useRef<HTMLButtonElement>(null);

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
        ref={button}
        type="button"
        onClick={() => {
          const r = addToCart(slug, qty);
          setResult(r);
          if (r !== 'added') return;
          setPulse((n) => n + 1);
          track('add_to_cart', { slug, qty });
          if (button.current) flyToCart(button.current, `+${String(qty)}`);
          else window.dispatchEvent(new Event(CART_LANDED_EVENT));
        }}
        className={`press relative inline-flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover ${className}`}
      >
        <span key={pulse} className={`inline-flex items-center gap-2 ${pulse > 0 ? 'atc-pulse' : ''}`}>
          {added ? (
            <Check aria-hidden="true" className="atc-check size-4" strokeWidth={3} />
          ) : (
            <ShoppingCart aria-hidden="true" className={`size-4 ${pulse > 0 ? 'atc-in' : ''}`} />
          )}
          <span key={added ? 'added' : 'add'} className={pulse > 0 ? 'atc-in' : ''}>
            {added ? labels.added : labels.add}
          </span>
        </span>
        {added ? <span key={`ripple-${String(pulse)}`} aria-hidden="true" className="atc-ripple" /> : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
      {result && result !== 'added' ? <p className="mt-2 text-xs font-bold text-error">{message}</p> : null}
    </>
  );
}
