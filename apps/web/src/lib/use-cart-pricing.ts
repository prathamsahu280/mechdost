'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CheckoutQuote } from '@mechdost/shared/checkout-api';
import { priceCart } from '@/demo/cart-pricing';
import type { CategoryKey } from '@/demo/catalogue';
import type { CartLine } from '@/demo/store';
import { DATA_MODE } from './data-mode';

/** What the cart and checkout render: the same shape whether prices come from the demo or the API. */
export interface PricedLine {
  product: {
    slug: string;
    sku: string;
    name: string;
    brand: string;
    category: CategoryKey;
    pricePaise: number;
  };
  /** The size when the product is sold in several, else null (shown under the name). */
  sizeLabel: string | null;
  qty: number;
  linePaise: number;
}

export interface CartPricing {
  priced: PricedLine[];
  subtotalPaise: number;
  deliveryPaise: number;
  /** Cash-on-delivery total (includes `codFeePaise`); the total for an online payment is `onlineTotalPaise`. */
  totalPaise: number;
  /** The admin-set fee added to a cash-on-delivery order (0 in the demo and when none is set). */
  codFeePaise: number;
  onlineTotalPaise: number;
  /** Real data mode: the API quote behind the numbers (COD eligibility, groups, line issues). */
  quote: CheckoutQuote | null;
  /**
   * "Your savings" estimate vs the maker's printed MRP (decision 2026-11-26): computed by the server in real data mode
   * (0 when the admin switched it off), from the demo catalogue's MRP in the demo. Final only after delivery.
   */
  savings: { totalPaise: number; excludedLines: number };
  /** Real data mode: waiting for the first quote, or the API could not price the cart (error code). */
  status: 'ready' | 'loading' | 'error';
  error: string | null;
}

/** Default PIN for pricing before the customer types theirs (Raipur centre). */
export const DEFAULT_PIN = '492001';

/**
 * Prices the cart. Demo data mode: the demo catalogue (synchronous). Real data mode (`NEXT_PUBLIC_DATA_MODE=api`):
 * `POST /v1/checkout/quote` for the cart's SKUs at `pincode` — the server's prices, delivery and GST are the only
 * numbers shown (spec 03), re-quoted when the cart or the PIN changes. Lines saved without a SKU (from the demo)
 * cannot be priced by the API and are left out.
 */
function useDemoCartPricing(lines: readonly CartLine[]): CartPricing {
  return useMemo(() => {
    const demo = priceCart(lines);
    return {
      priced: demo.priced.map(({ product, qty, linePaise, unitPaise, sku, sizeLabel }) => ({
        sizeLabel,
        product: {
          slug: product.slug,
          sku,
          name: product.name,
          brand: product.brand,
          category: product.category,
          pricePaise: unitPaise,
        },
        qty,
        linePaise,
      })),
      subtotalPaise: demo.subtotalPaise,
      deliveryPaise: demo.deliveryPaise,
      totalPaise: demo.totalPaise,
      codFeePaise: 0,
      onlineTotalPaise: demo.totalPaise,
      savings: { totalPaise: demo.savingsPaise, excludedLines: 0 },
      quote: null,
      status: 'ready' as const,
      error: null,
    };
  }, [lines]);
}

function useApiCartPricing(lines: readonly CartLine[], pincode: string, locale: string): CartPricing {
  const [state, setState] = useState<{
    key: string;
    quote: CheckoutQuote | null;
    error: string | null;
    /** The last successful quote, still shown while a new one loads or after it fails (a mistyped PIN). */
    lastGood: CheckoutQuote | null;
  }>({ key: '', quote: null, error: null, lastGood: null });
  const apiLines = useMemo(
    () => lines.flatMap((l) => (l.sku ? [{ sku: l.sku, qty: l.qty, slug: l.slug }] : [])),
    [lines],
  );
  const key = `${pincode}|${locale}|${apiLines.map((l) => `${l.sku}:${String(l.qty)}`).join(',')}`;

  useEffect(() => {
    if (apiLines.length === 0 || !/^\d{6}$/.test(pincode)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void import('./orders-api').then(async ({ quoteCart }) => {
        const res = await quoteCart(
          locale,
          pincode,
          apiLines.map(({ sku, qty }) => ({ sku, qty })),
        );
        if (!live) return;
        setState((prev) =>
          res.ok
            ? { key, quote: res.data, error: null, lastGood: res.data }
            : { key, quote: null, error: res.code, lastGood: prev.lastGood },
        );
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, apiLines, pincode, locale]);

  const fresh = state.key === key;
  const current = fresh ? state.quote : null;
  // Lines still in the cart keep their last known prices while a new quote loads or after it fails.
  const quote = current ?? state.lastGood;
  const bySku = new Map(apiLines.map((l) => [l.sku, l.slug]));
  const priced: PricedLine[] = (quote?.lines ?? []).flatMap((l) =>
    l.unitPaise === null || l.totalPaise === null
      ? []
      : [
          {
            product: {
              slug: bySku.get(l.sku) ?? l.sku.toLowerCase(),
              sku: l.sku,
              name: l.name ?? l.sku,
              brand: '',
              category: 'spareParts',
              pricePaise: l.unitPaise,
            },
            // The server's name already ends with the size (checkout snapshot rule, 2026-11-24).
            sizeLabel: null,
            qty: l.qty,
            linePaise: l.totalPaise,
          },
        ],
  );
  return {
    priced,
    subtotalPaise: quote?.subtotalPaise ?? 0,
    deliveryPaise: quote?.shippingPaise ?? 0,
    totalPaise: quote?.totalPaise ?? 0,
    codFeePaise: quote?.codFeePaise ?? 0,
    onlineTotalPaise: quote?.onlineTotalPaise ?? 0,
    savings: {
      totalPaise: quote?.savingsEstimate?.totalPaise ?? 0,
      excludedLines: quote?.savingsEstimate?.excludedLines ?? 0,
    },
    // Only a quote for exactly this cart and PIN may be used to place an order.
    quote: current,
    status: apiLines.length === 0 ? 'ready' : fresh && state.error ? 'error' : current ? 'ready' : 'loading',
    error: fresh ? state.error : null,
  };
}

/**
 * Picked once at build time (`NEXT_PUBLIC_DATA_MODE` is inlined), so the demo bundle carries no API pricing code and
 * the API bundle no demo pricing. Same hook order on every render either way.
 */
export const useCartPricing: (lines: readonly CartLine[], pincode: string, locale: string) => CartPricing =
  DATA_MODE === 'api' ? useApiCartPricing : useDemoCartPricing;
