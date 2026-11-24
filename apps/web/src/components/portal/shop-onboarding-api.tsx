'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { PRICE_REJECT_REASONS } from '@mechdost/shared/partner-codes';
import {
  AgreementAccepted,
  MeRoles,
  PriceRequestPage,
  PriceRequested,
  ShopAgreement,
  ShopOffers,
  StatusAnswer,
  type PriceRequestRowDto,
  type ShopAgreementDto,
  type ShopOfferDto,
} from '@mechdost/shared/partner-api';
import { adminApi } from '@/lib/admin-api';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { parseRupees } from '@/lib/money-input';
import { newestRequestBySku, priceRowState, shopIdFromRoles } from '@/lib/partner-onboarding-view';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-styles';

/**
 * The shop side of seller onboarding on the API (Stream D, 2026-11-14; spec 07): "Your prices" (every new price is
 * a request staff approve; `/v1/shop-onboarding/{shopId}/price-requests`, offers from `/v1/shops/{shopId}/inventory`)
 * and the seller agreement. The shop comes from the signed-in account's roles (`GET /v1/me`). Loaded with
 * `next/dynamic` only when AUTH_MODE is firebase; same copy and layout as the demo cards.
 */
type ShopState =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'error'; code: string } | { kind: 'ok'; id: string };

function useMyShop(): ShopState {
  const locale = useLocale();
  const [state, setState] = useState<ShopState>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    void adminApi(locale, '/me', MeRoles).then((res) => {
      if (!live) return;
      if (!res.ok) setState({ kind: 'error', code: res.code });
      else {
        const id = shopIdFromRoles(res.data.roles);
        setState(id ? { kind: 'ok', id } : { kind: 'none' });
      }
    });
    return () => {
      live = false;
    };
  }, [locale]);
  return state;
}

function ShopGate({ state, children }: { state: ShopState; children: (shopId: string) => ReactNode }) {
  const t = useTranslations('portal');
  if (state.kind === 'loading')
    return (
      <p role="status" className="text-sm text-muted">
        {t('api_on_loading')}
      </p>
    );
  if (state.kind === 'error')
    return (
      <p role="alert" className="text-sm font-bold text-error">
        {t(commonErrorKey(state.code))}
      </p>
    );
  if (state.kind === 'none') return <p className="text-sm text-muted">{t('api_on_noShop')}</p>;
  return <>{children(state.id)}</>;
}

/* ───────────────────────────── Your prices ───────────────────────────── */

export function ShopPricesApi() {
  const t = useTranslations('portal');
  const shop = useMyShop();
  return (
    <section aria-labelledby="prices-title" className="space-y-3">
      <div>
        <h2 id="prices-title" className="font-heading text-xl font-extrabold text-ink">
          {t('pricesTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('pricesLead')}</p>
        <p className="mt-1 text-sm text-muted">{t('priceCustomerNote')}</p>
      </div>
      <ShopGate state={shop}>{(shopId) => <PriceBoard shopId={shopId} />}</ShopGate>
    </section>
  );
}

function PriceBoard({ shopId }: { shopId: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [offers, setOffers] = useState<ShopOfferDto[] | null>(null);
  const [requests, setRequests] = useState<PriceRequestRowDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, r] = await Promise.all([
      adminApi(locale, `/shops/${shopId}/inventory?locale=${locale === 'hi' ? 'hi' : 'en'}`, ShopOffers),
      adminApi(locale, `/shop-onboarding/${shopId}/price-requests?limit=100`, PriceRequestPage),
    ]);
    if (!o.ok || !r.ok) {
      setError(!o.ok ? o.code : r.ok ? 'UNKNOWN' : r.code);
      return;
    }
    setError(null);
    setOffers(o.data.offers);
    setRequests(r.data.items);
  }, [locale, shopId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm font-bold text-error">
          {t(commonErrorKey(error))}
        </p>
        <button type="button" onClick={() => void load()} className={portalQuiet}>
          {t('api_on_retry')}
        </button>
      </div>
    );
  if (!offers)
    return (
      <p role="status" className="text-sm text-muted">
        {t('api_on_loading')}
      </p>
    );
  if (offers.length === 0) return <p className="text-sm text-muted">{t('api_on_offersEmpty')}</p>;
  const newest = newestRequestBySku(requests);
  return (
    <ul className="grid gap-3 nav:grid-cols-2">
      {offers.map((o) => (
        <PriceRow
          key={o.sku}
          shopId={shopId}
          offer={o}
          newest={newest.get(o.sku)}
          onChanged={() => void load()}
        />
      ))}
    </ul>
  );
}

function reasonLabel(code: string | null): (typeof PRICE_REJECT_REASONS)[number] {
  return PRICE_REJECT_REASONS.find((r) => r === code) ?? 'other';
}

function PriceRow({
  shopId,
  offer,
  newest,
  onChanged,
}: {
  shopId: string;
  offer: ShopOfferDto;
  newest: PriceRequestRowDto | undefined;
  onChanged: () => void;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = `price-${offer.sku}`;
  const state = priceRowState(offer, newest);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const raw = new FormData(form).get('price');
    const parsed = parseRupees(typeof raw === 'string' ? raw : '');
    if (!parsed.ok) {
      setError(t('priceErrFormat'));
      return;
    }
    if (parsed.paise > offer.mrpPaise) {
      setError(t('priceErrAboveMrp', { mrp: formatPrice(offer.mrpPaise) }));
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop-onboarding/${shopId}/price-requests`, PriceRequested, {
      method: 'POST',
      body: { sku: offer.sku, pricePaise: parsed.paise, onHand: offer.onHand },
    });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.code === 'PRICE_ABOVE_MRP'
          ? t('priceErrAboveMrp', { mrp: formatPrice(offer.mrpPaise) })
          : res.code === 'PRICE_INVALID'
            ? t('priceErrFormat')
            : res.code === 'PRODUCT_NOT_LIVE'
              ? t('api_on_errNotLive')
              : t(commonErrorKey(res.code)),
      );
      return;
    }
    setError(null);
    form.reset();
    track('click', { id: 'shop_price_requested', path: window.location.pathname });
    onChanged();
  }

  async function withdraw(id: string) {
    setBusy(true);
    const res = await adminApi(
      locale,
      `/shop-onboarding/${shopId}/price-requests/${id}/withdraw`,
      StatusAnswer,
      {
        method: 'POST',
      },
    );
    setBusy(false);
    if (!res.ok) {
      setError(t(commonErrorKey(res.code)));
      return;
    }
    track('click', { id: 'shop_price_withdrawn', path: window.location.pathname });
    onChanged();
  }

  const lines: string[] = [];
  if (state.kind === 'off_sale')
    lines.push(
      state.reasonCode
        ? t('priceOffSale', { reason: t(`priceReason_${reasonLabel(state.reasonCode)}`) })
        : t('api_on_offSale'),
    );
  else {
    lines.push(t('priceOnSale', { price: formatPrice(state.livePaise) }));
    if (state.kind === 'on_sale' && state.pending)
      lines.push(t('pricePending', { price: formatPrice(state.pending.requestedPaise) }));
    if (state.kind === 'rejected')
      lines.push(t('priceNotApproved', { reason: t(`priceReason_${reasonLabel(state.reasonCode)}`) }));
  }
  const pending = state.kind === 'on_sale' ? state.pending : null;

  return (
    <li className={portalCard}>
      <p data-user-content className="font-bold text-ink">
        {offer.product}
      </p>
      <p className="text-xs text-muted">{t('priceMrp', { mrp: formatPrice(offer.mrpPaise) })}</p>
      <div className="mt-2 space-y-1 text-sm">
        {lines.map((s) => (
          <p key={s} className="font-bold text-ink">
            {s}
          </p>
        ))}
      </div>
      {pending ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void withdraw(pending.id)}
          className={`${portalQuiet} mt-2`}
        >
          {t('api_on_withdraw')}
        </button>
      ) : null}
      {state.kind === 'off_sale' && state.reasonCode ? (
        <p className="mt-2 text-xs text-muted">{t('priceOffSaleHint')}</p>
      ) : (
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
            <p id={`${inputId}-error`} className="w-full text-xs font-bold text-error">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </li>
  );
}

/* ───────────────────────────── Agreement ───────────────────────────── */

export function ShopAgreementApi() {
  const shop = useMyShop();
  // Hidden until there is a shop and an agreement (like the demo card); the prices card shows the shop state.
  return shop.kind === 'ok' ? <AgreementCard shopId={shop.id} /> : null;
}

function AgreementCard({ shopId }: { shopId: string }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<ShopAgreementDto | null>(null);
  const [ticked, setTicked] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminApi(locale, `/shop-onboarding/${shopId}/agreement`, ShopAgreement);
    if (res.ok) setData(res.data);
    else setError(t(commonErrorKey(res.code)));
  }, [locale, shopId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data)
    return (
      <p role="alert" className="text-sm font-bold text-error">
        {error}
      </p>
    );
  const current = data?.current;
  if (!data || !current) return null;
  const accepted = data.acceptedVersions.includes(current.version);

  async function accept(version: number) {
    if (!ticked) {
      setMissing(true);
      document.getElementById('agreement-consent')?.focus();
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, `/shop-onboarding/${shopId}/agreement`, AgreementAccepted, {
      method: 'POST',
      body: { version },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.code === 'AGREEMENT_OUTDATED' ? t('agreementOutdated') : t(commonErrorKey(res.code)));
      if (res.code === 'AGREEMENT_OUTDATED') void load();
      return;
    }
    setError(null);
    setLive(res.data.live);
    track('click', { id: 'shop_agreement_accepted', path: window.location.pathname });
    void load();
  }

  return (
    <section aria-labelledby="agreement-shop-title" className={portalCard}>
      <h2 id="agreement-shop-title" className="font-heading text-xl font-extrabold text-ink">
        {t('agreementTitle')}
      </h2>
      <div
        lang={locale === 'hi' ? 'hi' : 'en'}
        data-scroll="box"
        className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-surface-alt p-3 text-sm whitespace-pre-line text-ink"
      >
        {locale === 'hi' ? current.textHi : current.textEn}
      </div>
      {accepted ? (
        <p className="mt-3 text-sm font-bold text-ink" role="status">
          {t('api_on_agreementAccepted', { version: current.version })}
          {live ? ` ${t('api_on_live')}` : ''}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">{t('agreementAsk', { version: current.version })}</p>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              id="agreement-consent"
              type="checkbox"
              checked={ticked}
              aria-invalid={missing ? true : undefined}
              aria-describedby={missing ? 'agreement-consent-error' : undefined}
              onChange={(e) => {
                setTicked(e.target.checked);
                setMissing(false);
              }}
              className="mt-0.5 size-5 accent-[var(--color-accent-button)]"
            />
            <span>{t('agreementConsent')}</span>
          </label>
          {missing ? (
            <p id="agreement-consent-error" className="text-xs font-bold text-error">
              {t('agreementErrConsent')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-bold text-error">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void accept(current.version)}
            className={portalPrimary}
          >
            {t('agreementAccept')}
          </button>
        </div>
      )}
    </section>
  );
}
