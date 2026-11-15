'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { checkCoupon, type AppliedCoupon } from '@/lib/coupon-api';
import { conditionLines, couponErrorKey, type CouponErrorKey } from '@/lib/coupon-view';
import { formatDate, formatPrice } from '@/lib/format';

/**
 * The coupon field of the checkout (spec 03 "Coupons"; real data mode, loaded lazily so it costs the page nothing
 * until a customer opens it). Calm and honest: the code is checked first, its conditions and the saving are shown,
 * and only then does the customer choose to use it (CCPA / dark-pattern rules). One coupon per order; coins come after
 * it. The server checks again when the order is placed, so a stale offer is refused there with a clear reason.
 */
export default function CheckoutCoupon({
  pincode,
  lines,
  applied,
  onApply,
}: {
  pincode: string;
  lines: readonly { sku: string; qty: number }[];
  applied: AppliedCoupon | null;
  /** The coupon to price with (or null to remove it); the parent re-quotes the totals. */
  onApply: (coupon: AppliedCoupon | null) => void;
}) {
  const t = useTranslations('coupons');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [found, setFound] = useState<AppliedCoupon | null>(null);
  const [error, setError] = useState<CouponErrorKey | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const signature = `${pincode}|${lines.map((l) => `${l.sku}:${String(l.qty)}`).join(',')}`;

  async function run(codeText: string): Promise<AppliedCoupon | null> {
    const res = await checkCoupon(locale, { code: codeText, pincode, lines });
    if (!res.ok) {
      setError(couponErrorKey(res.code));
      track('apply_coupon', { result: 'refused', reason: null, funder: null });
      return null;
    }
    if (!res.data.ok) {
      setError(couponErrorKey(res.data.reason));
      track('apply_coupon', {
        result: 'refused',
        reason: res.data.reason,
        funder: res.data.coupon?.funder ?? null,
      });
      return null;
    }
    return res.data;
  }

  async function onCheck() {
    const typed = code.trim();
    if (typed === '') {
      setError('err_not_found');
      field.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    setFound(null);
    const ok = await run(typed);
    setWorking(false);
    if (ok) {
      setFound(ok);
      track('apply_coupon', { result: 'applicable', reason: null, funder: ok.coupon.funder });
    } else field.current?.focus();
  }

  // The cart or the PIN changed while a coupon is applied: check it again on the new cart; drop it if it no longer fits.
  const appliedCode = applied?.coupon.code ?? null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (appliedCode === null) return;
    let live = true;
    void run(appliedCode).then((again) => {
      if (live) onApply(again);
    });
    return () => {
      live = false;
    };
    // `run` and `onApply` change every render; the cart signature is what should trigger the re-check.
  }, [signature]);

  if (applied) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line-card bg-surface p-3">
        <p className="text-sm font-bold text-ink">
          {t('applied', { code: applied.coupon.code })} ·{' '}
          {t('saving', { amount: formatPrice(applied.discountPaise) })}
        </p>
        <button
          type="button"
          className="press min-h-11 rounded-button px-3 text-sm font-bold text-accent-soft-text underline"
          onClick={() => {
            track('apply_coupon', { result: 'removed', reason: null, funder: applied.coupon.funder });
            onApply(null);
            setFound(null);
            setCode('');
          }}
        >
          {t('remove')}
        </button>
      </div>
    );
  }

  if (!open)
    return (
      <button
        type="button"
        className="press min-h-11 rounded-button text-sm font-bold text-accent-soft-text underline"
        aria-expanded="false"
        onClick={() => {
          setOpen(true);
          window.requestAnimationFrame(() => field.current?.focus());
        }}
      >
        {t('have')}
      </button>
    );

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="checkout-coupon" className="block text-sm font-bold text-ink">
          {t('label')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="checkout-coupon"
            ref={field}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setFound(null);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onCheck();
              }
            }}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={error !== null}
            aria-describedby={error ? 'checkout-coupon-error' : undefined}
            className="min-h-11 w-full min-w-0 rounded-button border border-input-border bg-surface px-3 text-base text-ink"
          />
          <button
            type="button"
            disabled={working}
            onClick={() => void onCheck()}
            className="press min-h-11 shrink-0 rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill disabled:opacity-60"
          >
            {working ? t('checking') : t('check')}
          </button>
        </div>
        {error ? (
          <p id="checkout-coupon-error" role="alert" className="mt-2 text-sm font-bold text-error">
            {t(error)}
          </p>
        ) : null}
      </div>

      {found ? (
        <div className="rounded-card border border-line-card bg-surface p-4" aria-live="polite">
          <p className="font-heading text-base font-extrabold text-ink">
            {found.coupon.title || found.coupon.code}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {conditionLines(found.coupon).map((c) => (
              <li key={c.key}>
                {t(c.key, {
                  value: c.key === 'cond_percent' ? (c.value ?? 0) : formatPrice(c.value ?? 0),
                  date: c.at ? formatDate(c.at, locale) : '',
                })}
              </li>
            ))}
            <li>
              {found.coupon.funder === 'shop' && found.coupon.shopName
                ? t('cond_shop', { shop: found.coupon.shopName })
                : t('cond_mechdost')}
            </li>
          </ul>
          {found.coupon.terms ? <p className="mt-2 text-sm text-muted">{found.coupon.terms}</p> : null}
          <p className="mt-3 text-sm font-bold text-ink">
            {t('saving', { amount: formatPrice(found.discountPaise) })}
          </p>
          <button
            type="button"
            className="press mt-3 min-h-11 rounded-button bg-accent-button px-4 text-sm font-bold text-white hover:bg-accent-button-hover"
            onClick={() => {
              track('apply_coupon', { result: 'applied', reason: null, funder: found.coupon.funder });
              onApply(found);
            }}
          >
            {t('use')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
