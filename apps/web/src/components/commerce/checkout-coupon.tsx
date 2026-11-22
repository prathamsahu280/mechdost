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
 * and only then does the customer choose to use it (CCPA / dark-pattern rules). One offer per order and never added
 * together (2026-11-16): an automatic offer is found by the server with no code and applied on its own (it cannot be
 * removed, it is not a choice); a typed code competes with it and the larger discount wins, the customer is told which
 * one and what the other would have given. The server checks again when the order is placed, so a stale offer is
 * refused there with a clear reason (a gone automatic offer is a price change, never "your code").
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
  /** The offer to price with (or null to remove it); the parent re-quotes the totals. */
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
  // The latest applied offer, for async callbacks that must not act on a stale copy.
  const appliedRef = useRef(applied);
  appliedRef.current = applied;

  async function run(codeText: string | null): Promise<AppliedCoupon | null> {
    const res = await checkCoupon(locale, { code: codeText, pincode, lines });
    if (!res.ok) {
      // Asking for the automatic offer is silent: a failure there is simply "no automatic offer shown".
      if (codeText !== null) {
        setError(couponErrorKey(res.code));
        track('apply_coupon', { result: 'refused', reason: null, funder: null });
      }
      return null;
    }
    if (!res.data.ok) {
      if (codeText !== null) {
        setError(couponErrorKey(res.data.reason));
        track('apply_coupon', {
          result: 'refused',
          reason: res.data.reason,
          funder: res.data.coupon?.funder ?? null,
        });
      }
      return null;
    }
    return res.data;
  }

  /** Ask the server which automatic offer this cart gets (none when the customer has a code applied). */
  async function syncAutomatic(): Promise<void> {
    const auto = await run(null);
    if (appliedRef.current?.source === 'code') return;
    if (auto?.source === 'automatic') {
      if (appliedRef.current?.coupon.code !== auto.coupon.code)
        track('apply_coupon', { result: 'automatic', reason: null, funder: auto.coupon.funder });
      onApply(auto);
    } else if (appliedRef.current) onApply(null);
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

  // The cart or the PIN changed (and once on opening checkout): look for the automatic offer again, or check the typed
  // code again on the new cart and drop it if it no longer fits.
  const appliedCode = applied?.source === 'code' ? applied.coupon.code : null;
  useEffect(() => {
    let live = true;
    if (appliedCode === null) void syncAutomatic();
    else
      void run(appliedCode).then((again) => {
        if (live) onApply(again);
      });
    return () => {
      live = false;
    };
    // `run`, `syncAutomatic` and `onApply` change every render; the cart signature is what should trigger the check.
  }, [signature]);

  const appliedBlock = applied ? (
    <div className="space-y-2 rounded-card border border-line-card bg-surface p-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          {applied.source === 'automatic'
            ? t('auto_applied', { title: applied.coupon.title })
            : t('applied', { code: applied.coupon.code })}{' '}
          · {t('saving', { amount: formatPrice(applied.discountPaise) })}
        </p>
        {applied.source === 'code' ? (
          <button
            type="button"
            className="press min-h-11 rounded-button px-3 text-sm font-bold text-accent-soft-text underline"
            onClick={() => {
              track('apply_coupon', { result: 'removed', reason: null, funder: applied.coupon.funder });
              onApply(null);
              setFound(null);
              setCode('');
              // The automatic offer (if any) comes back: it was only out of the way while the code won.
              void syncAutomatic();
            }}
          >
            {t('remove')}
          </button>
        ) : null}
      </div>
      {applied.source === 'automatic' ? <p className="text-sm text-muted">{t('auto_note')}</p> : null}
      {applied.beaten ? (
        <p className="text-sm text-muted">
          {t(applied.beaten.source === 'code' ? 'beaten_code' : 'beaten_auto', {
            // beaten_code names the offer that won; beaten_auto names the automatic offer that lost.
            title: applied.beaten.source === 'code' ? applied.coupon.title : applied.beaten.title,
            amount: formatPrice(applied.beaten.discountPaise),
          })}
        </p>
      ) : null}
    </div>
  ) : null;

  // A typed code that is applied has nothing more to ask; an automatic offer leaves the code field available.
  if (applied?.source === 'code') return appliedBlock;

  if (!open)
    return (
      <div className="space-y-3">
        {appliedBlock}
        <button
          type="button"
          className="press min-h-11 rounded-button text-sm font-bold text-accent-soft-text underline"
          aria-expanded="false"
          data-disclosure-trigger="checkout-coupon"
          onClick={() => {
            setOpen(true);
            window.requestAnimationFrame(() => field.current?.focus());
          }}
        >
          {t('have')}
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      {appliedBlock}
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
          <button
            type="button"
            data-panel-cancel="checkout-coupon"
            onClick={() => {
              setOpen(false);
              setCode('');
              setError(null);
              setFound(null);
            }}
            className="press min-h-11 shrink-0 rounded-button px-3 text-sm font-bold text-ink underline hover:bg-pill"
          >
            {t('cancel')}
          </button>
        </div>
        {error ? (
          <p id="checkout-coupon-error" role="alert" className="mt-2 text-sm font-bold text-error">
            {t(error)}
          </p>
        ) : null}
      </div>

      {found?.source === 'automatic' ? (
        // The code is valid but the automatic offer saves more: it stays applied, and the customer is told why.
        <p
          className="rounded-card border border-line-card bg-surface p-4 text-sm text-ink"
          aria-live="polite"
        >
          {t('beaten_code', {
            title: found.coupon.title,
            amount: formatPrice(found.beaten?.discountPaise ?? 0),
          })}
        </p>
      ) : null}
      {found?.source === 'code' ? (
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
            <li>{t('cond_mechdost')}</li>
          </ul>
          {found.coupon.terms ? <p className="mt-2 text-sm text-muted">{found.coupon.terms}</p> : null}
          <p className="mt-3 text-sm font-bold text-ink">
            {t('saving', { amount: formatPrice(found.discountPaise) })}
          </p>
          {found.beaten ? (
            <p className="mt-1 text-sm text-muted">
              {t('beaten_auto', {
                title: found.beaten.title,
                amount: formatPrice(found.beaten.discountPaise),
              })}
            </p>
          ) : null}
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
