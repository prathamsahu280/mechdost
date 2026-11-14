'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { PRICE_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import { DEMO_PRODUCTS } from '@/demo/catalogue';
import { localizeProduct, localizeShop } from '@/demo/i18n/localize';
import {
  decidePriceRequest,
  usePendingPriceRequests,
  type DemoPriceRequest,
  type PriceRejectReason,
} from '@/demo/price-requests';
import { findShop } from '@/demo/shops';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

/**
 * Price approval queue (user 2026-11-13, design § Prices, permission `prices:approve`): every seller price waits
 * here; approve puts it on sale, reject needs a reason the seller sees, and a rejected change to a live product
 * takes it off sale for that shop. Demo store until the console calls `/v1/admin/price-requests` (data switch).
 */
export function AdminPriceRequests() {
  const t = useTranslations('portal');
  const pending = usePendingPriceRequests();

  return (
    <section aria-labelledby="price-requests-title" className={portalCard}>
      <h3 id="price-requests-title" className="font-heading text-lg font-extrabold text-ink">
        {t('priceRequestsTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('priceRequestsLead')}</p>
      {pending.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t('priceRequestsEmpty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line-card">
          {pending.map((r) => (
            <PriceRequestRow key={r.id} request={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PriceRequestRow({ request: r }: { request: DemoPriceRequest }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [reason, setReason] = useState<PriceRejectReason | ''>('');
  const [missing, setMissing] = useState(false);
  const shop = findShop(r.shopSlug);
  const product = DEMO_PRODUCTS.find((p) => p.slug === r.productSlug);
  const shopName = shop ? localizeShop(shop, locale).name : r.shopSlug;
  const productName = product
    ? `${localizeProduct(product, locale).brand} ${localizeProduct(product, locale).name}`
    : r.productSlug;
  const reasonId = `price-reason-${r.id}`;

  function decide(decision: 'approved' | 'rejected') {
    if (decision === 'rejected') {
      if (!reason) {
        setMissing(true);
        document.getElementById(reasonId)?.focus();
        return;
      }
      decidePriceRequest(r.id, { decision, reason });
    } else {
      decidePriceRequest(r.id, { decision });
    }
    track('click', { id: `admin_price_${decision}`, path: window.location.pathname });
  }

  return (
    <li className="flex flex-wrap items-end justify-between gap-3 py-3">
      <div className="text-sm">
        <p className="font-bold text-ink">{productName}</p>
        <p className="text-muted">
          {t('priceRequestLine', {
            shop: shopName,
            price: formatPrice(r.pricePaise),
            mrp: formatPrice(r.mrpPaise),
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={reasonId} className="text-xs font-bold text-ink">
            {t('priceRejectReason')}
          </label>
          <select
            id={reasonId}
            value={reason}
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${reasonId}-error` : undefined}
            onChange={(e) => {
              const v = e.target.value;
              setReason(
                (PRICE_REJECT_REASONS as readonly string[]).includes(v) ? (v as PriceRejectReason) : '',
              );
              setMissing(false);
            }}
            className={`${portalField} mt-1 block`}
          >
            <option value="">{t('priceRejectChoose')}</option>
            {PRICE_REJECT_REASONS.map((code) => (
              <option key={code} value={code}>
                {t(`priceReason_${code}`)}
              </option>
            ))}
          </select>
          {missing ? (
            <p id={`${reasonId}-error`} className="mt-1 text-xs font-bold text-error">
              {t('priceRejectNeedsReason')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            decide('rejected');
          }}
          className={portalQuiet}
        >
          {t('priceReject')}
        </button>
        <button
          type="button"
          onClick={() => {
            decide('approved');
          }}
          className={portalPrimary}
        >
          {t('priceApprove')}
        </button>
      </div>
    </li>
  );
}
