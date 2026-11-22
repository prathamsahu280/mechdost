'use client';

import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useIsSeller } from '@/demo/session-state';
import { track } from '@/lib/analytics';
import { signal } from '@/lib/compare/signal';
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
  /** "Removed from the cart", read out when − at one removes the product. */
  removed: string;
  /** "# in cart": `#` is replaced with the quantity. */
  inCart: string;
}

type Problem = Exclude<AddResult, 'added'>;

/**
 * "Add to cart", then — once the product is in the cart — a − / count / + stepper in the same place (user
 * 2026-11-14: "add the quantity in there itself too just like swiggy or amazon"). − at one removes it and "Add to
 * cart" comes back; + stops at the per-product limit. No modal, no navigation. Labels arrive translated from the
 * server so no i18n runtime ships with this island.
 *
 * Geometry (bug 2026-11-14: hovering "+" hid the count): the stepper is exactly as tall as "Add to cart" (its
 * outline is drawn inside its box, not around the 44 px buttons); the count takes the space between the buttons and
 * clips instead of running under them; the words "3 in cart" show only from 12rem, where they fit in Hindi too; the
 * hover surface is an inset face inside each button, so it never reaches the count.
 *
 * Focus and feedback (review 2026-11-14, I8): when "Add to cart" turns into the stepper, focus moves to "+"; when
 * the bin removes the product, focus moves to "Add to cart"; at the limit "+" stays focusable (`aria-disabled`).
 * Every change is read out by the one live region (`signal({ say })`). A problem (limit, refused save) shows under
 * the button on the product page and in the table (`notify="inline"`), and in the compare tray from product cards
 * (`notify="tray"`), so nothing ever pushes a card's layout.
 */
export function AddToCartButton({
  slug,
  sku,
  labels,
  qty = 1,
  className = '',
  source,
  notify = 'inline',
}: {
  slug: string;
  /** The pack's SKU (products from the API): stored on the cart line for the checkout quote. */
  sku?: string | null;
  labels: AddToCartLabels;
  qty?: number;
  className?: string;
  /** Where the press came from, for analytics (the comparison table). */
  source?: 'compare';
  notify?: 'inline' | 'tray';
}) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const inCart = useCart().find((l) => l.slug === slug)?.qty ?? 0;
  const addButton = useRef<HTMLButtonElement>(null);
  const plusButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'add' | 'plus' | null>(null);

  // The control that replaced the pressed one takes focus (it would otherwise drop to the page's start).
  useEffect(() => {
    const target =
      focusNext.current === 'plus'
        ? plusButton.current
        : focusNext.current === 'add'
          ? addButton.current
          : null;
    if (!target) return;
    focusNext.current = null;
    target.focus();
  }, [inCart]);

  // Shop accounts never buy (user 2026-11-22): no add, stepper or buy action for them (the product page shows a note).
  const seller = useIsSeller();
  if (seller) return null;

  const problemText = (p: Problem) =>
    p === 'max_qty' ? labels.maxQty : p === 'max_lines' ? labels.maxLines : labels.saveFailed;

  function report(p: Problem, origin: HTMLElement) {
    if (notify === 'tray') signal({ ask: 'notice', text: problemText(p), origin });
    else {
      setProblem(p);
      signal({ say: problemText(p) });
    }
  }

  function add(n: number, origin: HTMLElement) {
    const r = addToCart(slug, n, sku ?? undefined);
    if (r === 'added') {
      setProblem(null);
      if (inCart === 0) focusNext.current = 'plus';
      signal({ say: labels.inCart.replace('#', String(Math.min(inCart + n, MAX_QTY))) });
      track('add_to_cart', source ? { slug, qty: n, source } : { slug, qty: n });
      return;
    }
    report(r, origin);
    if (r === 'save_failed')
      track('click', { id: 'add_to_cart_save_failed', path: window.location.pathname });
  }

  const [inCartBefore = '', inCartAfter = ''] = labels.inCart.split('#');
  const atMax = inCart >= MAX_QTY;

  return (
    <>
      {inCart > 0 ? (
        // Styles: `.cart-stepper`, `.cart-step`, `.cart-count` in globals.css (fewer bytes on every shop page).
        <div data-slot="cart-stepper" className={`cart-stepper ${className}`}>
          <button
            type="button"
            aria-label={inCart === 1 ? labels.remove : labels.decrease}
            onClick={() => {
              setProblem(null);
              if (inCart === 1) {
                focusNext.current = 'add';
                removeFromCart(slug);
                track('remove_from_cart', { slug });
                signal({ say: labels.removed });
              } else {
                setQuantity(slug, inCart - 1);
                track('click', { id: 'cart_qty_decrease', path: window.location.pathname });
                signal({ say: labels.inCart.replace('#', String(inCart - 1)) });
              }
            }}
            className="press cart-step"
          >
            <span>
              {inCart === 1 ? (
                <Trash2 aria-hidden="true" className="size-4" />
              ) : (
                <Minus aria-hidden="true" className="size-4" strokeWidth={3} />
              )}
            </span>
          </button>
          {/* Narrow cards (two columns on phones) show just the number, like "− 2 +"; with room the words show too.
              The words always stay for screen readers (QA 2026-11-14: "1 in cart" widened a 480 px page). The
              count owns the space between the buttons and clips, so it can never run under them. */}
          <span className="cart-count">
            <span className="cart-words">{inCartBefore}</span>
            {inCart}
            <span className="cart-words">{inCartAfter}</span>
          </span>
          <button
            ref={plusButton}
            type="button"
            aria-label={labels.increase}
            // At the limit "+" stays focusable (a disabled button would drop focus) and explains instead.
            aria-disabled={atMax ? 'true' : 'false'}
            onClick={(e) => {
              add(1, e.currentTarget);
            }}
            className="press cart-step"
          >
            <span>
              <Plus aria-hidden="true" className="size-4" strokeWidth={3} />
            </span>
          </button>
        </div>
      ) : (
        <button
          ref={addButton}
          data-slot="add-to-cart"
          type="button"
          onClick={(e) => {
            add(qty, e.currentTarget);
          }}
          className={`press cart-add ${className}`}
        >
          <ShoppingCart aria-hidden="true" className="size-4 shrink-0" />
          {labels.add}
        </button>
      )}
      {notify === 'inline' && problem ? (
        <p className="mt-2 text-xs font-bold text-error">{problemText(problem)}</p>
      ) : null}
    </>
  );
}
