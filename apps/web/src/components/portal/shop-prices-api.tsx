'use client';

import { PRICE_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import { PriceRequestCreated, ShopOfferList, ShopPriceRequestPage } from '@mechdost/shared/order-views';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { MyShops, type MyShopDto } from '@mechdost/shared/shop-api';
import { apiErrorKey, priceRows, type PriceRow } from '@/lib/order-views';
import { ApiListState } from './api-list-state';
import { ShopStockStepper } from './shop-stock-stepper';
import { portalCard, portalField, portalPrimary } from './portal-styles';

type Load = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ok'; rows: PriceRow[] };

/**
 * "Your prices" on the API (user 2026-11-13, design § Prices; real sign-in only): the shop's offers
 * (`GET /v1/shops/{shopId}/inventory`) with the newest price request per product
 * (`GET /v1/shop-onboarding/{shopId}/price-requests`). A new price is always a request staff approve
 * (`POST …/price-requests`; the inventory route refuses a shop's own price change); the live price stays until then.
 */
export function ShopPricesApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [shops, setShops] = useState<MyShopDto[] | null>(null);

  // The same source as the portal header (`GET /v1/shop/me`, ids from the grants): every shop listed there has prices.
  useEffect(() => {
    let live = true;
    void adminApi(locale, '/shop/me', MyShops).then((res) => {
      if (live) setShops(res.ok ? res.data.shops : []);
    });
    return () => {
      live = false;
    };
  }, [locale]);

  return (
    <section aria-labelledby="prices-title" className="space-y-3">
      <div>
        <h2 id="prices-title" className="font-heading text-xl font-extrabold text-ink">
          {t('pricesTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('pricesLead')}</p>
        {/* The shop's approved price is what it is paid; customers see the admin's price (Q26, QA 2026-11-14 U1). */}
        <p className="mt-1 text-sm text-muted">{t('priceCustomerNote')}</p>
      </div>
      {shops === null ? <div className="skeleton h-24 rounded-card" aria-hidden="true" /> : null}
      {shops?.length === 0 ? (
        <p role="status" className={`${portalCard} text-sm font-bold text-ink`}>
          {t('api_noShop')}
        </p>
      ) : null}
      {shops?.map((s) => (
        <ShopPrices key={s.id} shop={s} showName={shops.length > 1} />
      ))}
    </section>
  );
}

function ShopPrices({ shop, showName }: { shop: MyShopDto; showName: boolean }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const shopId = shop.id;
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const reload = useCallback(async () => {
    const [offers, requests] = await Promise.all([
      adminApi(locale, `/shops/${shopId}/inventory?locale=${locale === 'hi' ? 'hi' : 'en'}`, ShopOfferList),
      adminApi(locale, `/shop-onboarding/${shopId}/price-requests?limit=100`, ShopPriceRequestPage),
    ]);
    if (!offers.ok) {
      setLoad({ status: 'error', code: offers.code });
      return;
    }
    if (!requests.ok) {
      setLoad({ status: 'error', code: requests.code });
      return;
    }
    setLoad({ status: 'ok', rows: priceRows(offers.data.offers, requests.data.items) });
  }, [locale, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-3">
      {showName ? (
        <h3 className="font-heading text-base font-extrabold text-ink">
          {locale === 'hi' && shop.nameHi ? shop.nameHi : shop.name}
        </h3>
      ) : null}
      <ApiListState
        loading={load.status === 'loading'}
        error={load.status === 'error' ? load.code : null}
        count={load.status === 'ok' ? load.rows.length : 0}
        empty={t('api_pricesEmpty')}
        onRetry={() => void reload()}
      />
      {load.status === 'ok' && load.rows.length > 0 ? (
        <ul className="grid gap-3 nav:grid-cols-2">
          {load.rows.map((r) => (
            <PriceRowCard key={r.sku} shopId={shopId} row={r} onSent={reload} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PriceRowCard({
  shopId,
  row,
  onSent,
}: {
  shopId: string;
  row: PriceRow;
  onSent: () => Promise<void>;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = `price-${row.sku}`;
  const reason = PRICE_REJECT_REASONS.find((r) => r === row.rejectedReason);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = new FormData(form).get('price');
    const parsed = parseRupees(typeof raw === 'string' ? raw : '');
    if (!parsed.ok) {
      setError(t('priceErrFormat'));
      return;
    }
    if (parsed.paise > row.mrpPaise) {
      setError(t('priceErrAboveMrp', { mrp: formatPrice(row.mrpPaise) }));
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop-onboarding/${shopId}/price-requests`, PriceRequestCreated, {
      method: 'POST',
      body: { sku: row.sku, pricePaise: parsed.paise, onHand: row.onHand },
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(apiErrorKey(res.code) as 'api_err_generic'));
      return;
    }
    setError(null);
    form.reset();
    track('click', { id: 'shop_price_requested', path: window.location.pathname });
    await onSent();
  }

  return (
    <li className={portalCard}>
      <p className="font-bold text-ink">{row.product}</p>
      <p className="text-xs text-muted">{t('priceMrp', { mrp: formatPrice(row.mrpPaise) })}</p>
      <div className="mt-2 space-y-1 text-sm">
        {row.livePaise !== null ? (
          <p className="font-bold text-ink">{t('priceOnSale', { price: formatPrice(row.livePaise) })}</p>
        ) : null}
        {row.pendingPaise !== null ? (
          <p className="font-bold text-ink">{t('pricePending', { price: formatPrice(row.pendingPaise) })}</p>
        ) : null}
        {reason ? (
          <p className="font-bold text-ink">
            {t('priceNotApproved', { reason: t(`priceReason_${reason}`) })}
          </p>
        ) : null}
      </div>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-wrap items-end gap-2">
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
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('priceSend')}
        </button>
        {error ? (
          <p id={`${inputId}-error`} role="alert" className="w-full text-xs font-bold text-error">
            {error}
          </p>
        ) : null}
      </form>
      {row.version !== null ? (
        <ShopStockStepper
          shopId={shopId}
          sku={row.sku}
          product={row.product}
          onHand={row.onHand}
          reserved={row.reserved}
          version={row.version}
          onChanged={onSent}
        />
      ) : null}
    </li>
  );
}
