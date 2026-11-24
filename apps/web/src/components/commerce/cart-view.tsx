'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS, findProduct } from '@/demo/catalogue';
import { useIsSeller } from '@/demo/session-state';
import { useCategoryEmoji } from '@/demo/site-config';
import {
  cartNow,
  removeFromCart,
  replaceCart,
  setQuantity,
  upgradeLegacyLines,
  useCart,
  MAX_QTY,
} from '@/demo/store';
import { DATA_MODE, QUOTES_AVAILABLE } from '@/lib/data-mode';
import { DEFAULT_PIN, useCartPricing } from '@/lib/use-cart-pricing';
import { CATEGORY_EMOJI, UI_EMOJI } from '@/lib/emoji';
import { formatPrice } from '@/lib/format';
import { track } from '@/lib/analytics';
import { ProductVisualClient } from './product-visual-client';
import { productNameFor } from '@/demo/i18n/localize';

const prefix = (locale: string) => (locale === 'hi' ? '/hi' : '');

/** Cart (spec 03) on the demo store: quantities 1–99, remove, live totals, a delivery-charges hint, one primary action. */
export function CartView() {
  const t = useTranslations('cart');
  const c = useTranslations('catalogue');
  const q = useTranslations('quote');
  const cat = useTranslations('categories');
  const emoji = useCategoryEmoji();
  const locale = useLocale();
  const lines = useCart();
  // Real data mode: the API prices the cart at the Raipur-centre PIN; checkout re-prices at the PIN typed there.
  // (Not the saved address: reading the session here would pull the demo account store into /cart, JS budget.)
  const pricing = useCartPricing(lines, DEFAULT_PIN, locale);
  const { priced, subtotalPaise, deliveryPaise, totalPaise } = pricing;
  const checkoutT = useTranslations('checkout');
  const seller = useIsSeller();
  const base = prefix(locale);

  // Demo data: a line saved by slug only (before sizes, user 2026-11-24) becomes the product's first size.
  useEffect(() => {
    if (DATA_MODE === 'api') return;
    const now = cartNow();
    const next = upgradeLegacyLines(now, (slug) => findProduct(slug)?.sku);
    if (next.some((l, i) => l.sku !== now[i]?.sku)) replaceCart(next);
  }, [lines]);

  if (DATA_MODE === 'api' && priced.length === 0 && lines.length > 0 && pricing.status !== 'ready')
    return (
      <p
        role={pricing.status === 'error' ? 'alert' : 'status'}
        className="rounded-card border border-line-card bg-surface p-6 text-sm font-bold text-ink shadow-card"
      >
        {pricing.status === 'error' ? checkoutT('pricesError') : checkoutT('pricesLoading')}
      </p>
    );
  if (priced.length === 0) {
    // Empty state: one primary action (shop) plus category shortcuts as quiet secondary links.
    return (
      <div className="rounded-card border border-line-card bg-surface p-6 text-center shadow-card tab:p-10">
        <span
          aria-hidden="true"
          className="mx-auto grid size-20 place-items-center rounded-full bg-accent-soft text-[40px]"
        >
          {UI_EMOJI.cart}
        </span>
        <h2 className="mt-5 font-heading text-2xl font-extrabold text-ink">{t('empty')}</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-muted">{t('emptyBody')}</p>
        <Link
          href={`${base}/shop`}
          data-track="cart_empty_shop"
          className="press mt-6 inline-flex min-h-12 items-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('emptyAction')}
        </Link>
        <p className="mt-8 text-sm font-bold text-ink">{t('emptyCategories')}</p>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {CATEGORY_KEYS.map((key) => (
            <li key={key}>
              <Link
                href={`${base}/shop?category=${CATEGORY_SLUGS[key]}`}
                data-track={`cart_empty_${key}`}
                className="press inline-flex min-h-11 items-center gap-2 rounded-pill border border-line-card bg-surface px-4 text-sm font-bold text-ink hover:bg-pill"
              >
                <span aria-hidden="true">{emoji(key, CATEGORY_EMOJI[key])}</span>
                {cat(key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_360px] nav:items-start">
      <ul className="space-y-3">
        {priced.map(({ product, qty, linePaise, sizeLabel }) => (
          <li
            key={product.sku}
            className="grid grid-cols-[72px_1fr] gap-4 rounded-card border border-line-card bg-surface p-4 shadow-card min-[480px]:grid-cols-[96px_1fr]"
          >
            <ProductVisualClient category={product.category} />
            <div className="min-w-0">
              {product.brand ? (
                <p className="text-[11px] font-bold text-muted uppercase">{product.brand}</p>
              ) : null}
              <Link
                href={`${base}/shop/${product.slug}`}
                className="font-heading font-bold text-ink hover:underline"
              >
                {productNameFor(product.slug, product.name, locale)}
              </Link>
              {sizeLabel ? (
                <p className="text-sm font-bold text-ink" data-slot="cart-size">
                  <span className="sr-only">{t('size')}: </span>
                  {sizeLabel}
                </p>
              ) : null}
              <p className="text-xs text-muted">{t('each', { price: formatPrice(product.pricePaise) })}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div
                  className="inline-flex items-center rounded-button border border-input-border"
                  role="group"
                  aria-label={c('quantity')}
                >
                  <button
                    type="button"
                    aria-label={c('decrease')}
                    disabled={qty <= 1}
                    onClick={() => {
                      setQuantity(product.sku, qty - 1);
                    }}
                    className="press inline-flex size-10 items-center justify-center text-ink disabled:opacity-40"
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </button>
                  <span className="min-w-8 text-center text-sm font-bold tabular-nums" aria-live="polite">
                    {qty}
                  </span>
                  <button
                    type="button"
                    aria-label={c('increase')}
                    disabled={qty >= MAX_QTY}
                    onClick={() => {
                      setQuantity(product.sku, qty + 1);
                    }}
                    className="press inline-flex size-10 items-center justify-center text-ink disabled:opacity-40"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-heading text-lg font-extrabold text-ink">
                    {formatPrice(linePaise)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      removeFromCart(product.sku);
                      track('remove_from_cart', { slug: product.slug });
                    }}
                    className="press inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-muted hover:text-error"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                    {t('remove')}
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <aside
        aria-labelledby="summary"
        className="rounded-card border border-line-card bg-surface p-6 shadow-card sticky-aside"
      >
        <h2 id="summary" className="font-heading text-lg font-extrabold text-ink">
          {t('summary')}
        </h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t('subtotal')}</dt>
            <dd className="font-bold text-ink">{formatPrice(subtotalPaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t('delivery')}</dt>
            <dd className="font-bold text-ink">
              {deliveryPaise === 0 ? t('free') : formatPrice(deliveryPaise)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base">
            <dt className="font-bold text-ink">{t('total')}</dt>
            <dd className="font-heading text-xl font-extrabold text-ink">{formatPrice(totalPaise)}</dd>
          </div>
        </dl>
        {deliveryPaise > 0 ? <p className="mt-3 text-xs text-muted">{t('freeDeliveryHint')}</p> : null}
        {seller ? (
          // Shop accounts never buy (user 2026-11-22): the note instead of checkout; "Continue shopping" stays below.
          <p
            role="note"
            className="mt-5 rounded-card border border-warning-line bg-warning-bg p-4 text-sm font-bold text-warning"
          >
            {t('sellerCannotOrder')}
          </p>
        ) : (
          <Link
            href={`${base}/checkout`}
            onClick={() => {
              track('begin_checkout', { items: priced.length, valuePaise: totalPaise });
            }}
            className="press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
          >
            {t('checkout')}
          </Link>
        )}
        <Link
          href={`${base}/shop`}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center text-sm font-bold text-ink underline-offset-4 hover:underline"
        >
          {t('continue')}
        </Link>
        {QUOTES_AVAILABLE && !seller ? (
          <Link
            href={`${base}/quotes/new?from=cart`}
            data-track="cart_bulk_quote"
            className="mt-1 inline-flex min-h-11 w-full items-center justify-center rounded-button border border-dashed border-input-border px-4 text-center text-sm font-bold text-accent-soft-text hover:bg-pill"
          >
            {q('cartBulk')}
          </Link>
        ) : null}
      </aside>
    </div>
  );
}
