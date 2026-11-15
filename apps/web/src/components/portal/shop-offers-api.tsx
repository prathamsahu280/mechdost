'use client';

import { ShopOfferDecidedDto, ShopOffersDto, type ShopOffer } from '@mechdost/shared/coupon-api';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { track } from '@/lib/analytics';
import { adminErrorKey, conditionLines, type AdminErrorKey } from '@/lib/coupon-view';
import { formatDate, formatPrice } from '@/lib/format';
import { portalCard, portalPrimary, portalQuiet } from './portal-guard';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; offers: ShopOffer[] };

/**
 * "Offers to accept" (spec 07, 2026-11-15), owner only: coupons that MechDost staff set up for this shop to fund. The
 * discount comes off what the shop is paid for its own lines, so a shop-funded offer never goes live until the owner
 * accepts the terms shown here; the owner can decline, or withdraw later (the offer then stops at once). The decision
 * carries the version the screen showed: if staff changed the terms meanwhile, the owner is asked again, never bound
 * to terms they did not read. Real API mode only; own module.
 */
export function ShopOffersApi({ shopId }: { shopId: string }) {
  const t = useTranslations('coupons');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<AdminErrorKey | 'o_err_changed' | null>(null);

  const reload = useCallback(async () => {
    const res = await adminApi(locale, `/shop/offers/${shopId}`, ShopOffersDto);
    setLoad(res.ok ? { kind: 'ok', offers: res.data.offers } : { kind: 'error', code: res.code });
  }, [locale, shopId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function decide(o: ShopOffer, decision: 'accept' | 'decline') {
    setWorking(o.couponId);
    setError(null);
    const res = await adminApi(locale, `/shop/offers/${shopId}/${o.couponId}/decision`, ShopOfferDecidedDto, {
      method: 'POST',
      body: { decision, version: o.version },
    });
    setWorking(null);
    if (!res.ok) {
      setError(res.code === 'STALE_OFFER' ? 'o_err_changed' : adminErrorKey(res.code));
      if (res.code === 'STALE_OFFER') await reload();
      return;
    }
    track('click', {
      id: decision === 'accept' ? 'shop_offer_accepted' : 'shop_offer_declined',
      path: window.location.pathname,
    });
    await reload();
  }

  // Nothing to show before the first offer: no empty card clutter on a shop that has none.
  if (load.kind === 'ok' && load.offers.length === 0) return null;
  if (load.kind === 'loading') return null;

  return (
    <section aria-labelledby={`shop-offers-${shopId}`} id="shop-offers" className={portalCard}>
      <h3 id={`shop-offers-${shopId}`} className="font-heading text-lg font-extrabold text-ink">
        {t('o_title')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('o_lead')}</p>
      {load.kind === 'error' ? (
        <p role="alert" className="mt-3 text-sm font-bold text-error">
          {t(adminErrorKey(load.code))}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm font-bold text-error">
          {t(error)}
        </p>
      ) : null}
      {load.kind === 'ok' ? (
        <ul className="mt-4 space-y-4">
          {load.offers.map((o) => (
            <li key={o.couponId} className="rounded-tile border border-line-card bg-surface-alt p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-heading text-base font-extrabold text-ink">
                  <span className="font-mono">{o.code}</span> ·{' '}
                  {locale === 'hi' && o.titleHi ? o.titleHi : o.title}
                </p>
                <span className="rounded-pill bg-pill px-2 py-0.5 text-xs font-bold text-ink">
                  {t(`o_status_${o.status}`)}
                </span>
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
                {conditionLines({ ...o, endsAt: o.endsAt }).map((line) => (
                  <li key={line.key}>
                    {t(line.key, {
                      value: line.key === 'cond_percent' ? (line.value ?? 0) : formatPrice(line.value ?? 0),
                      date: line.at ? formatDate(line.at, locale) : '',
                    })}
                  </li>
                ))}
                <li>{t('o_you_fund')}</li>
                <li>
                  {t('a_uses', {
                    used: o.usedCount,
                    total: o.usageLimitTotal === null ? '∞' : String(o.usageLimitTotal),
                  })}
                </li>
              </ul>
              {(locale === 'hi' && o.termsHi ? o.termsHi : o.terms) ? (
                <p className="mt-2 text-sm text-muted">
                  {locale === 'hi' && o.termsHi ? o.termsHi : o.terms}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {o.status !== 'accepted' ? (
                  <button
                    type="button"
                    disabled={working === o.couponId}
                    className={portalPrimary}
                    onClick={() => void decide(o, 'accept')}
                  >
                    {t('o_accept')}
                  </button>
                ) : null}
                {o.status === 'accepted' ? (
                  <button
                    type="button"
                    disabled={working === o.couponId}
                    className={portalQuiet}
                    onClick={() => void decide(o, 'decline')}
                  >
                    {t('o_withdraw')}
                  </button>
                ) : null}
                {o.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={working === o.couponId}
                    className={portalQuiet}
                    onClick={() => void decide(o, 'decline')}
                  >
                    {t('o_decline')}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
