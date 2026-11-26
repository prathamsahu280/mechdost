'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  PriceRequestPage,
  PriceRequested,
  ShopOffers,
  type PriceRequestRowDto,
} from '@mechdost/shared/partner-api';
import { MyShops, ShopVersion, type MyShopDto } from '@mechdost/shared/shop-api';
import { adminApi } from '@/lib/admin-api';
import { shopErrorKey } from '@/lib/admin-shop-form';
import { track } from '@/lib/analytics';
import { formatDate, formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { daysLabel } from '@/lib/service-views';
import { CatalogueSkuPicker, type SkuChoice } from './catalogue-sku-picker';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';
import { BusyCard } from './shop-busy-api';
import { ShopHoursFields } from './shop-hours-fields';
import { ShopOffersApi } from './shop-offers-api';
import { ShopCsvCard } from './shop-csv-api';
import { ShopPerformanceApi } from './shop-performance-api';
import { ShopStaffPerformanceLazy } from './shop-staff-performance-lazy';
import { ShopPhotosApi } from './shop-photos-api';
import { ShopTeamApi } from './shop-team-api';
import { ShopDeliveryModeCard } from '../delivery/shop-delivery';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; shops: MyShopDto[] };

/** The signed-in person's shop(s) from `GET /v1/shop/me` (ids come from their grants, never from the page). */
function useMyShops() {
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const reload = useCallback(async () => {
    const res = await adminApi(locale, '/shop/me', MyShops);
    setLoad(res.ok ? { kind: 'ok', shops: res.data.shops } : { kind: 'error', code: res.code });
  }, [locale]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { load, reload };
}

function Problem({ code }: { code: string }) {
  const t = useTranslations('portal');
  return (
    <p role="alert" className="text-sm font-bold text-error">
      {t(shopErrorKey(code) as 'api_common_err_generic')}
    </p>
  );
}

/**
 * Shop portal header on the API (spec 07, real sign-in): the shop's name and address, last-30-day acceptance, the
 * paused / suspended banner with MechDost's reason (code in the shop's language + the note), the working hours (the
 * owner edits them; routing suggests open shops first) and where it delivers. Loaded with the portal's dynamic import.
 */
export function ShopProfileApi() {
  const t = useTranslations('portal');
  const { load, reload } = useMyShops();
  if (load.kind === 'loading') return <div className="skeleton h-40 rounded-card" aria-hidden="true" />;
  if (load.kind === 'error')
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Problem code={load.code} />
        <button type="button" onClick={() => void reload()} className={portalQuiet}>
          {t('api_retry')}
        </button>
      </div>
    );
  if (load.shops.length === 0) return <p className="text-sm text-muted">{t('api_on_noShop')}</p>;
  return (
    <>
      {load.shops.map((s) => (
        <ShopHeader key={s.id} shop={s} onChanged={reload} />
      ))}
    </>
  );
}

function ShopHeader({ shop: s, onChanged }: { shop: MyShopDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const hi = locale === 'hi';
  const reason = s.standing?.reasonCode ? t(`shops_api_reason_${s.standing.reasonCode}`) : null;
  return (
    <div className="space-y-3">
      <section
        aria-labelledby={`shop-head-${s.id}`}
        className="blueprint rounded-card p-6 text-white shadow-card"
      >
        <h2 id={`shop-head-${s.id}`} className="font-heading text-2xl font-extrabold">
          <span aria-hidden="true">🏪 </span>
          {hi && s.nameHi ? s.nameHi : s.name}
        </h2>
        <p className="mt-1 text-sm text-white/80">
          {hi && s.addressLineHi ? s.addressLineHi : s.addressLine} · {s.pincode}
        </p>
        <p className="mt-3 text-sm font-bold">
          {s.offers30d.answered === 0
            ? t('shops_api_meNoOffersYet')
            : t('shops_api_meAccepted', { accepted: s.offers30d.accepted, answered: s.offers30d.answered })}
          {' · '}
          {t('shops_api_onSale', { count: s.offersOnSale })}
        </p>
      </section>

      {s.status === 'paused' || s.status === 'suspended' ? (
        <div
          role="status"
          className="rounded-card border border-warning bg-warning-bg p-4 text-sm text-warning"
        >
          <p className="font-extrabold">
            {t(s.status === 'paused' ? 'shops_api_mePaused' : 'shops_api_meSuspended')}
            {reason ? ` ${t('shops_api_meReason', { reason })}` : ''}
          </p>
          {s.standing?.note ? (
            <p className="mt-1" data-user-content>
              {s.standing.note}
            </p>
          ) : null}
          <p className="mt-1">
            {s.status === 'paused' && s.standing?.until
              ? t('shops_api_mePausedUntil', { date: formatDate(s.standing.until, locale) })
              : t(s.status === 'paused' ? 'shops_api_mePausedEffect' : 'shops_api_meSuspendedEffect')}
          </p>
        </div>
      ) : null}
      {s.status === 'pending' ? (
        <p role="status" className="rounded-card bg-pill p-4 text-sm text-ink">
          {t('shops_api_mePending')}
        </p>
      ) : null}

      <div className="grid gap-3 nav:grid-cols-2">
        <BusyCard shop={s} onChanged={onChanged} />
        <HoursCard shop={s} onChanged={onChanged} />
        <section aria-labelledby={`shop-cov-${s.id}`} className={portalCard}>
          <h3 id={`shop-cov-${s.id}`} className="font-heading text-lg font-extrabold text-ink">
            {t('shops_api_meDelivery')}
          </h3>
          <p className="mt-1 text-sm text-ink">
            {s.coverage.pincodes === 0
              ? t('shops_api_meNoPins')
              : t('shops_api_mePins', {
                  count: s.coverage.pincodes,
                  min: formatPrice(s.coverage.minShippingPaise ?? 0),
                  max: formatPrice(s.coverage.maxShippingPaise ?? 0),
                })}
          </p>
          {s.freeDeliveryMinPaise !== null ? (
            <p className="mt-1 text-sm text-muted">
              {s.freeDeliveryMinPaise === 0
                ? t('shops_api_meFreeAlways')
                : t('shops_api_meFreeFrom', { amount: formatPrice(s.freeDeliveryMinPaise) })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">{t('shops_api_meDeliveryNote')}</p>
        </section>
      </div>
      <ShopDeliveryModeCard shopId={s.id} isOwner={s.isOwner} />
      {s.isOwner ? <ShopOffersApi shopId={s.id} /> : null}
      <ShopCsvCard shopId={s.id} />
      {s.isOwner ? <ShopPerformanceApi shopId={s.id} /> : null}
      <ShopStaffPerformanceLazy shopId={s.id} isOwner={s.isOwner} />
      <ShopPhotosApi shopId={s.id} />
      {s.isOwner ? <ShopTeamApi shopId={s.id} /> : null}
    </div>
  );
}

function HoursCard({ shop: s, onChanged }: { shop: MyShopDto; onChanged: () => Promise<void> }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState({ open: s.hours.open, close: s.hours.close, days: s.hours.days });
  const [invalid, setInvalid] = useState<{ close?: boolean; days?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `own-hours-${s.id}`;
  const closeLabel = s.hours.close === '24:00' ? t('shops_api_hoursMidnightShort') : s.hours.close;

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const bad = { close: !(hours.open < hours.close), days: hours.days.length === 0 };
    if (bad.close || bad.days) {
      setInvalid(bad);
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop/hours/${s.id}`, ShopVersion, {
      method: 'PUT',
      body: { version: s.version, hours: { ...hours, days: [...hours.days].sort((a, b) => a - b) } },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      if (res.code === 'STALE_SHOP') await onChanged();
      return;
    }
    track('click', { id: 'shop_hours_saved', path: window.location.pathname });
    setEditing(false);
    setError(null);
    await onChanged();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={portalCard}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
          {t('shops_api_hoursLegend')}
        </h3>
        <span
          className={`rounded-pill px-3 py-1 text-xs font-extrabold ${s.openNow ? 'bg-success-bg text-success' : 'bg-pill text-muted'}`}
        >
          {s.openNow ? t('shops_api_openNow') : t('shops_api_closedNow')}
        </span>
      </div>
      {editing ? (
        <form
          noValidate
          onSubmit={(e) => void onSubmit(e)}
          aria-busy={busy || undefined}
          className="mt-3 space-y-3"
        >
          <ShopHoursFields
            idPrefix={id}
            open={hours.open}
            close={hours.close}
            days={hours.days}
            invalid={invalid}
            onChange={(h) => {
              setHours(h);
              setInvalid({});
            }}
          />
          {error ? <Problem code={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {t('shops_api_hoursSave')}
            </button>
            <button
              data-panel-cancel="hours"
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className={portalQuiet}
            >
              {t('shops_api_cancel')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink">
            {daysLabel(s.hours.days, locale)} · {s.hours.open}–{closeLabel}
          </p>
          <p className="mt-1 text-xs text-muted">{t('shops_api_hoursNote')}</p>
          {s.isOwner ? (
            <button
              data-disclosure-trigger="hours"
              type="button"
              onClick={() => {
                setEditing(true);
              }}
              className={`${portalQuiet} mt-3`}
            >
              {t('shops_api_hoursEdit')}
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted">{t('shops_api_hoursOwnerOnly')}</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * "Sell another product" (spec 07): a shop picks a live catalogue product it does not list yet and asks for a
 * price with its stock; staff approve it in Admin → Partners (price queue) and the approval creates the listing.
 * Requests still waiting for products not on the board yet are listed here (withdraw happens in "Your prices").
 */
export function ShopNewProductApi() {
  const t = useTranslations('portal');
  const locale = useLocale();
  const { load } = useMyShops();
  const shops = load.kind === 'ok' ? load.shops : [];
  return (
    <section aria-labelledby="new-product-title" className="space-y-3">
      <div>
        <h2 id="new-product-title" className="font-heading text-xl font-extrabold text-ink">
          {t('shops_api_newTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('shops_api_newLead')}</p>
      </div>
      {load.kind === 'ok'
        ? load.shops.map((s) => (
            <div key={s.id} className="space-y-2">
              {shops.length > 1 ? (
                <h3 className="text-sm font-bold text-ink" data-user-content>
                  {t('shops_api_newForShop', { shop: locale === 'hi' && s.nameHi ? s.nameHi : s.name })}
                </h3>
              ) : null}
              <NewProduct shopId={s.id} />
            </div>
          ))
        : null}
    </section>
  );
}

function NewProduct({ shopId }: { shopId: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [listed, setListed] = useState<Set<string> | null>(null);
  const [waiting, setWaiting] = useState<PriceRequestRowDto[]>([]);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<SkuChoice | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [problem, setProblem] = useState<'price' | 'stock' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = `new-product-${shopId}`;

  const load = useCallback(async () => {
    const [o, r] = await Promise.all([
      adminApi(locale, `/shops/${shopId}/inventory?locale=${locale === 'hi' ? 'hi' : 'en'}`, ShopOffers),
      adminApi(locale, `/shop-onboarding/${shopId}/price-requests?limit=100`, PriceRequestPage),
    ]);
    if (!o.ok || !r.ok) {
      setError(!o.ok ? o.code : r.ok ? 'UNKNOWN' : r.code);
      return;
    }
    const skus = new Set(o.data.offers.map((x) => x.sku));
    setListed(skus);
    setWaiting(r.data.items.filter((x) => x.status === 'pending' && !skus.has(x.sku)));
  }, [locale, shopId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choice) return;
    const p = parseRupees(price);
    if (!p.ok || p.paise > choice.mrpPaise) {
      setProblem('price');
      document.getElementById(`${id}-price`)?.focus();
      return;
    }
    const n = Number(stock.trim());
    if (stock.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100_000) {
      setProblem('stock');
      document.getElementById(`${id}-stock`)?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop-onboarding/${shopId}/price-requests`, PriceRequested, {
      method: 'POST',
      body: { sku: choice.sku, pricePaise: p.paise, onHand: n },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    track('click', { id: 'shop_new_product_requested', path: window.location.pathname });
    setChoice(null);
    setPrice('');
    setStock('');
    setOpen(false);
    setSent(true);
    setError(null);
    await load();
  }

  const pendingSkus = new Set([...(listed ?? []), ...waiting.map((w) => w.sku)]);
  return (
    <div className="space-y-3">
      {waiting.length > 0 ? (
        <ul className="space-y-2">
          {waiting.map((w) => (
            <li key={w.id} className={`${portalCard} text-sm`}>
              <span className="font-bold text-ink">{w.product}</span>{' '}
              <span className="text-muted">
                · {t('shops_api_newWaiting', { price: formatPrice(w.requestedPaise), stock: w.onHand })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {sent ? (
        <p role="status" className="text-sm font-bold text-success">
          {t('shops_api_newSent')}
        </p>
      ) : null}
      {error ? <Problem code={error} /> : null}
      {!open ? (
        <button
          data-disclosure-trigger="new-product"
          type="button"
          disabled={listed === null}
          onClick={() => {
            setOpen(true);
            setSent(false);
          }}
          className={portalPrimary}
        >
          {t('shops_api_newOpen')}
        </button>
      ) : (
        <div className={`${portalCard} space-y-3`}>
          {choice ? (
            <form
              noValidate
              onSubmit={(e) => void onSubmit(e)}
              aria-busy={busy || undefined}
              className="space-y-2"
            >
              <p className="text-sm text-ink">
                <span className="font-bold">{choice.name}</span> · {choice.sku} ·{' '}
                {t('shops_api_prodMrp', { mrp: formatPrice(choice.mrpPaise) })}
              </p>
              <div className="grid gap-2 min-[480px]:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-price`} className="text-xs font-bold text-muted">
                    {t('shops_api_newPrice')}
                  </label>
                  <input
                    id={`${id}-price`}
                    inputMode="decimal"
                    value={price}
                    aria-invalid={problem === 'price' ? true : undefined}
                    aria-describedby={problem ? `${id}-problem` : undefined}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      setProblem(null);
                    }}
                    className={portalField}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-stock`} className="text-xs font-bold text-muted">
                    {t('shops_api_prodStock')}
                  </label>
                  <input
                    id={`${id}-stock`}
                    inputMode="numeric"
                    value={stock}
                    aria-invalid={problem === 'stock' ? true : undefined}
                    aria-describedby={problem ? `${id}-problem` : undefined}
                    onChange={(e) => {
                      setStock(e.target.value);
                      setProblem(null);
                    }}
                    className={portalField}
                  />
                </div>
              </div>
              {problem ? (
                <p id={`${id}-problem`} className="text-xs font-bold text-error">
                  {problem === 'price'
                    ? t('shops_api_prodErrPrice', { mrp: formatPrice(choice.mrpPaise) })
                    : t('shops_api_prodErrStock')}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={portalPrimary}>
                  {t('shops_api_newSend')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChoice(null);
                  }}
                  className={portalQuiet}
                >
                  {t('shops_api_pickBack')}
                </button>
              </div>
            </form>
          ) : (
            <CatalogueSkuPicker idPrefix={id} listed={pendingSkus} onPick={setChoice} />
          )}
          <button
            data-panel-cancel="new-product"
            type="button"
            onClick={() => {
              setOpen(false);
              setChoice(null);
            }}
            className={portalQuiet}
          >
            {t('shops_api_cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
