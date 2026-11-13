'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { DEMO_PRODUCTS, type DemoProduct } from '@/demo/catalogue';
import { localizeProduct } from '@/demo/i18n/localize';
import { listingOf, submitPriceRequest, usePriceRequestsVersion } from '@/demo/price-requests';
import type { DemoShop } from '@/demo/shops';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { portalCard, portalField, portalPrimary } from './portal-guard';

/**
 * "Your prices" (user 2026-11-13, design § Prices): every new price is a request the admin approves; the live
 * price stays until then. A price can never be above the MRP. Demo shops already sell their categories at the
 * catalogue price, which is the starting live price. Demo store until the portal calls
 * `/v1/shop-onboarding/{shopId}/price-requests` (data switch).
 */
export function ShopPrices({ shop }: { shop: DemoShop }) {
  const t = useTranslations('portal');
  usePriceRequestsVersion();
  const products = DEMO_PRODUCTS.filter((p) => shop.categories.includes(p.category));

  return (
    <section aria-labelledby="prices-title" className="space-y-3">
      <div>
        <h2 id="prices-title" className="font-heading text-xl font-extrabold text-ink">
          {t('pricesTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('pricesLead')}</p>
      </div>
      <ul className="grid gap-3 nav:grid-cols-2">
        {products.map((p) => (
          <PriceRow key={p.slug} shopSlug={shop.slug} product={p} />
        ))}
      </ul>
    </section>
  );
}

function PriceRow({ shopSlug, product }: { shopSlug: string; product: DemoProduct }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const l = localizeProduct(product, locale);
  const mrpPaise = product.mrpPaise ?? product.pricePaise;
  const listing = listingOf(shopSlug, product.slug);
  const inputId = `price-${product.slug}`;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = new FormData(form).get('price');
    const parsed = parseRupees(typeof raw === 'string' ? raw : '');
    if (!parsed.ok) {
      setError(t('priceErrFormat'));
      return;
    }
    const result = submitPriceRequest({
      shopSlug,
      productSlug: product.slug,
      pricePaise: parsed.paise,
      mrpPaise,
      currentPaise: product.pricePaise,
    });
    if ('error' in result) {
      setError(
        result.error === 'PRICE_ABOVE_MRP'
          ? t('priceErrAboveMrp', { mrp: formatPrice(mrpPaise) })
          : t('priceErrFormat'),
      );
      return;
    }
    setError(null);
    form.reset();
    track('click', { id: 'shop_price_requested', path: window.location.pathname });
  }

  let status: string[];
  switch (listing.status) {
    case 'none':
      status = [t('priceOnSale', { price: formatPrice(product.pricePaise) })];
      break;
    case 'on_sale':
      status = [t('priceOnSale', { price: formatPrice(listing.livePaise) })];
      if (listing.pending !== undefined)
        status.push(t('pricePending', { price: formatPrice(listing.pending) }));
      break;
    case 'pending':
      status = [t('pricePending', { price: formatPrice(listing.pending) })];
      break;
    case 'rejected':
      status = [t('priceNotApproved', { reason: t(`priceReason_${listing.reason}`) })];
      break;
    case 'blocked':
      status = [t('priceOffSale', { reason: t(`priceReason_${listing.reason}`) })];
      break;
  }

  return (
    <li className={portalCard}>
      <p className="font-bold text-ink">
        {l.brand} {l.name}
      </p>
      <p className="text-xs text-muted">{t('priceMrp', { mrp: formatPrice(mrpPaise) })}</p>
      <div className="mt-2 space-y-1 text-sm">
        {status.map((s) => (
          <p key={s} className="font-bold text-ink">
            {s}
          </p>
        ))}
      </div>
      {listing.status === 'blocked' ? (
        <p className="mt-2 text-xs text-muted">{t('priceOffSaleHint')}</p>
      ) : (
        <form noValidate onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={inputId} className="text-xs font-bold text-ink">
              {t('priceNew')}
            </label>
            <input
              id={inputId}
              name="price"
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              className={`${portalField} mt-1 block w-36`}
            />
          </div>
          <button type="submit" className={portalPrimary}>
            {t('priceSend')}
          </button>
          {error ? (
            <p id={`${inputId}-error`} className="w-full text-xs font-bold text-error">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </li>
  );
}
