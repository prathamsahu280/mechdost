'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { placeDemoOrder, priceCart, useCart } from '@/demo/store';
import { CartView } from './cart-view';

type Field = 'name' | 'phone' | 'address' | 'pincode' | 'consent';

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;

/** Checkout step (spec 03) on the demo store: labelled fields, inline errors, error summary focus, COD only. */
export function CheckoutForm() {
  const t = useTranslations('checkout');
  const cartT = useTranslations('cart');
  const locale = useLocale();
  const router = useRouter();
  const lines = useCart();
  const { priced, subtotalPaise, deliveryPaise, totalPaise } = priceCart(lines);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  if (priced.length === 0 && !submitting) return <CartView />;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const phone = value('phone')
      .replace(/\D/g, '')
      .replace(/^91(?=\d{10}$)/, '');
    const pincode = value('pincode');
    const next: Partial<Record<Field, string>> = {};
    if (value('name').length < 2) next.name = t('errName');
    if (!PHONE.test(phone)) next.phone = t('errPhone');
    if (value('address').length < 10) next.address = t('errAddress');
    if (!PIN.test(pincode)) next.pincode = t('errPincode');
    else if (!pincode.startsWith('4920')) next.pincode = t('errService');
    if (data.get('consent') !== 'on') next.consent = t('errConsent');
    setErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError) {
      document.getElementById(`checkout-${firstError}`)?.focus();
      return;
    }
    setSubmitting(true);
    const order = placeDemoOrder({ name: value('name'), phone, address: value('address'), pincode });
    track('purchase', { code: order.code, valuePaise: order.totalPaise, demo: true });
    router.push(`${locale === 'hi' ? '/hi' : ''}/orders/${order.code}?new=1`);
  }

  const field = (id: Field) => ({
    id: `checkout-${id}`,
    name: id,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `checkout-${id}-error` : undefined,
  });
  const inputClass =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink aria-[invalid=true]:border-error';
  const errorText = (id: Field) =>
    errors[id] ? (
      <p id={`checkout-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;

  return (
    <div className="grid gap-6 nav:grid-cols-[1fr_360px] nav:items-start">
      <form
        noValidate
        onSubmit={onSubmit}
        className="rounded-card border border-line-card bg-surface p-6 shadow-card"
      >
        <h2 className="font-heading text-lg font-extrabold text-ink">{t('step')}</h2>
        {Object.keys(errors).length > 0 ? (
          <p role="alert" className="mt-3 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
            {t('errorSummary')}
          </p>
        ) : null}
        <div className="mt-4 grid gap-4 min-[600px]:grid-cols-2">
          <div>
            <label htmlFor="checkout-name" className="text-sm font-bold text-ink">
              {t('name')}
            </label>
            <input {...field('name')} autoComplete="name" maxLength={100} className={inputClass} />
            {errorText('name')}
          </div>
          <div>
            <label htmlFor="checkout-phone" className="text-sm font-bold text-ink">
              {t('phone')}
            </label>
            <input
              {...field('phone')}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={14}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">{t('phoneHint')}</p>
            {errorText('phone')}
          </div>
          <div className="min-[600px]:col-span-2">
            <label htmlFor="checkout-address" className="text-sm font-bold text-ink">
              {t('address')}
            </label>
            <textarea
              {...field('address')}
              rows={3}
              autoComplete="street-address"
              maxLength={500}
              className={`${inputClass} py-2`}
            />
            {errorText('address')}
          </div>
          <div>
            <label htmlFor="checkout-pincode" className="text-sm font-bold text-ink">
              {t('pincode')}
            </label>
            <input
              {...field('pincode')}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              defaultValue="492001"
              className={inputClass}
            />
            <p className="mt-1 text-xs text-muted">{t('pincodeHint')}</p>
            {errorText('pincode')}
          </div>
          <fieldset>
            <legend className="text-sm font-bold text-ink">{t('payment')}</legend>
            <label className="mt-2 flex min-h-11 items-center gap-2 rounded-input border border-input-border px-3 text-sm text-ink">
              <input
                type="radio"
                name="payment"
                value="cod"
                defaultChecked
                className="size-6 accent-[var(--color-accent-button)]"
              />
              {t('cod')}
            </label>
            <label className="mt-2 flex min-h-11 items-center gap-2 rounded-input border border-line px-3 text-sm text-muted">
              <input type="radio" name="payment" value="online" disabled className="size-6" />
              {t('online')}
            </label>
          </fieldset>
        </div>
        <label className="mt-5 flex items-start gap-3 text-sm text-ink">
          <input
            {...field('consent')}
            type="checkbox"
            className="mt-1 size-6 shrink-0 accent-[var(--color-accent-button)]"
          />
          <span>{t('consent')}</span>
        </label>
        {errorText('consent')}
        <p className="mt-4 rounded-lg bg-surface-alt px-3 py-2 text-xs text-muted">{t('flowNote')}</p>
        <button
          type="submit"
          disabled={submitting}
          className="press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
        >
          {submitting ? t('placing') : `${t('place')} · ${formatPrice(totalPaise)}`}
        </button>
      </form>

      <aside className="rounded-card border border-line-card bg-surface p-6 shadow-card">
        <h2 className="font-heading text-lg font-extrabold text-ink">{cartT('summary')}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {priced.map(({ product, qty, linePaise }) => (
            <li key={product.slug} className="flex justify-between gap-3">
              <span className="text-ink">
                {product.name} <span className="text-muted">× {qty}</span>
              </span>
              <span className="font-bold text-ink">{formatPrice(linePaise)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{cartT('subtotal')}</dt>
            <dd className="font-bold">{formatPrice(subtotalPaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{cartT('delivery')}</dt>
            <dd className="font-bold">{deliveryPaise === 0 ? cartT('free') : formatPrice(deliveryPaise)}</dd>
          </div>
          <div className="flex justify-between text-base">
            <dt className="font-bold">{cartT('total')}</dt>
            <dd className="font-heading text-xl font-extrabold">{formatPrice(totalPaise)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
