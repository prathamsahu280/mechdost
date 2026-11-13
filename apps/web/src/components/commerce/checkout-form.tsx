'use client';

import { coinRedemption } from '@mechdost/shared/coins';
import { GST_STATE_CODES, gstinStateCode, isGstin, normaliseGstin } from '@mechdost/shared/gst';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { coinBalanceOf, redeemCoins, useCoins } from '@/demo/coins';
import { customerAllowed, useCustomerBlocks } from '@/demo/customer-blocks';
import { findAccount, useSession } from '@/demo/session';
import { coinRulesFrom, useSiteSettings } from '@/demo/site-config';
import { DEMO_CITY } from '@/demo/city';
import { clearCart, placeDemoOrder, useCart } from '@/demo/store';
import { priceCart } from '@/demo/cart-pricing';
import { CartView } from './cart-view';
import { productNameFor } from '@/demo/i18n/localize';

type Field = 'name' | 'phone' | 'address' | 'pincode' | 'gstin' | 'businessName' | 'consent';

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;

/**
 * Checkout step (spec 03): labelled fields, inline errors, error summary focus. Cash on delivery uses the demo
 * store; "Pay online" (real sign-in builds) places the order on the API and opens Razorpay Checkout
 * (`lib/payments/pay-online.ts`, loaded only when chosen).
 */
export function CheckoutForm() {
  const t = useTranslations('checkout');
  const states = useTranslations('gstStates');
  const cartT = useTranslations('cart');
  const locale = useLocale();
  const router = useRouter();
  const lines = useCart();
  const { priced, subtotalPaise, deliveryPaise, totalPaise } = priceCart(lines);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  // Online payment (Razorpay) needs real sign-in: the API knows who pays.
  const onlineAvailable = AUTH_MODE === 'firebase';
  const [method, setMethod] = useState<'cod' | 'online'>('cod');
  const [onlineNote, setOnlineNote] = useState<{ text: string; link?: 'sign_in' | 'verify_email' } | null>(
    null,
  );
  const [paid, setPaid] = useState<string | null>(null);
  // One key per attempt: retrying after a closed popup reuses the same order on the API.
  const attemptKey = useRef<string | null>(null);
  const paidHeading = useRef<HTMLHeadingElement>(null);
  // MechDost Coins (spec 20): signed-in customers may use coins for part of the products, never delivery.
  const session = useSession();
  const settings = useSiteSettings();
  const coinAccount = session?.role === 'customer' ? session.id : null;
  // A signed-in customer starts from their name, number and default address (QA 2026-11-14, U6 / crawler F3:
  // everything was empty and the PIN fixed at 492001). Guests keep the Raipur PIN hint.
  const customer = session?.role === 'customer' ? session : null;
  const home = customer
    ? (customer.addresses.find((a) => a.isDefault) ?? customer.addresses[0] ?? null)
    : null;
  const prefill = {
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    address: home ? [home.line1, home.landmark].filter((part) => part.trim() !== '').join(', ') : '',
    pincode: home?.pincode ?? '492001',
  };
  // A signed-in customer's block is known before they type anything: say so at once and stop the order
  // (QA 2026-11-14, crawler F2: it was only shown after submitting). The typed-phone check below stays.
  useCustomerBlocks();
  const signedInAllowed = session ? customerAllowed(session.id) : null;
  const knownBlock =
    signedInAllowed && (!signedInAllowed.order || !signedInAllowed.cod)
      ? signedInAllowed.order
        ? t('blockedCod')
        : t('blockedOrders')
      : null;
  const { balance } = useCoins(coinAccount);
  const redemption = coinRedemption(balance, subtotalPaise, coinRulesFrom(settings));
  const [useCoinsOn, setUseCoinsOn] = useState(false);
  // Coins are a demo-store discount: not applied to online payments (the API prices the order).
  const coinDiscount = useCoinsOn && method === 'cod' ? redemption.discountPaise : 0;
  const payablePaise = totalPaise - coinDiscount;
  const prefix = locale === 'hi' ? '/hi' : '';
  // Business purchase (buyer GSTIN plan 2026-11-13): optional; checked with the shared, Zod-free GST helpers.
  const [isBusiness, setIsBusiness] = useState(false);
  const [gstinInput, setGstinInput] = useState('');
  const typedGstin = normaliseGstin(gstinInput);
  type StateKey = Parameters<typeof states>[0];
  const isStateKey = (code: string): code is StateKey => GST_STATE_CODES.includes(code);
  const gstinState = isBusiness && isGstin(typedGstin) ? gstinStateCode(typedGstin) : null;
  const otherState =
    gstinState && gstinState !== DEMO_CITY.gstStateCode && isStateKey(gstinState) ? gstinState : null;

  if (paid)
    return (
      <section className="rounded-card border border-line-card bg-surface p-7 shadow-card">
        <h2 ref={paidHeading} tabIndex={-1} className="font-heading text-xl font-extrabold text-ink">
          {t('paidTitle')}
        </h2>
        <p className="mt-2 text-sm text-ink">{t('paidBody', { code: paid })}</p>
        <Link
          href={`${prefix}/account`}
          className="press mt-5 inline-flex min-h-11 items-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover"
        >
          {t('paidNext')}
        </Link>
      </section>
    );

  if (priced.length === 0 && !submitting) return <CartView />;

  async function payOnlineNow(
    details: { name: string; phone: string; address: string; pincode: string },
    business: { gstin: string; businessName: string } | null,
  ) {
    setOnlineNote(null);
    setSubmitting(true);
    attemptKey.current ??= crypto.randomUUID();
    const { payOnline } = await import('@/lib/payments/pay-online');
    const result = await payOnline({
      locale,
      idempotencyKey: attemptKey.current,
      lines: priced.map(({ product, qty }) => ({ sku: product.sku, qty })),
      address: {
        contactName: details.name,
        contactPhone: `+91${details.phone}`,
        line1: details.address,
        pincode: details.pincode,
      },
      business,
    });
    setSubmitting(false);
    if (result.ok) {
      track('click', { id: 'checkout_paid_online', path: window.location.pathname });
      clearCart();
      attemptKey.current = null;
      setPaid(result.orderCode);
      window.requestAnimationFrame(() => paidHeading.current?.focus());
      return;
    }
    track('click', { id: `checkout_online_${result.reason}`, path: window.location.pathname });
    // A changed cart, price or details, or a closed payment window, needs a fresh order: the next try gets a new key.
    if (
      result.reason === 'cart_changed' ||
      result.reason === 'price_changed' ||
      result.reason === 'expired' ||
      result.reason === 'details_changed'
    )
      attemptKey.current = null;
    setOnlineNote({
      text: t(`online_${result.reason}`),
      link: result.reason === 'sign_in' || result.reason === 'verify_email' ? result.reason : undefined,
    });
  }

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
    const business = isBusiness
      ? { gstin: normaliseGstin(value('gstin')), businessName: value('businessName') }
      : null;
    if (business && !isGstin(business.gstin)) next.gstin = t('errGstin');
    if (business && (business.businessName.length < 2 || business.businessName.length > 120))
      next.businessName = t('errBusinessName');
    if (data.get('consent') !== 'on') next.consent = t('errConsent');
    setErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError) {
      document.getElementById(`checkout-${firstError}`)?.focus();
      return;
    }
    // Customer blocks (spec 08): the signed-in account, or the account behind the phone number typed in, so
    // signing out does not get round a block. The demo takes cash on delivery only, so a COD block stops ordering.
    const allowed = customerAllowed(session?.id ?? findAccount(phone)?.id ?? null);
    if (!allowed.order || !allowed.cod) {
      setBlockedNote(allowed.order ? t('blockedCod') : t('blockedOrders'));
      track('click', {
        id: allowed.order ? 'checkout_blocked_cod' : 'checkout_blocked_orders',
        path: window.location.pathname,
      });
      return;
    }
    setBlockedNote(null);
    if (method === 'online') {
      void payOnlineNow({ name: value('name'), phone, address: value('address'), pincode }, business);
      return;
    }
    setSubmitting(true);
    // Re-check the balance at the moment of ordering (another tab may have used the coins).
    const spend =
      useCoinsOn && coinAccount && redemption.coins > 0 && coinBalanceOf(coinAccount) >= redemption.coins
        ? { accountId: coinAccount, coins: redemption.coins, discountPaise: redemption.discountPaise }
        : null;
    const order = placeDemoOrder(
      { name: value('name'), phone, address: value('address'), pincode },
      priceCart(lines),
      spend,
      business,
    );
    if (spend) redeemCoins(spend.accountId, spend.coins, order.code);
    track('purchase_submitted', {
      code: order.code,
      valuePaise: order.totalPaise,
      demo: true,
      businessPurchase: business !== null,
    });
    router.push(`${prefix}/orders/${order.code}?new=1`);
  }

  const field = (id: Field) => ({
    id: `checkout-${id}`,
    name: id,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `checkout-${id}-error` : undefined,
    // Editing a field clears its error at once; the next submit checks it again (QA 2026-11-14, U17).
    onInput: () => {
      if (errors[id]) setErrors(({ [id]: _cleared, ...rest }) => rest);
    },
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
        // Remount once the session is known (after hydration), so the defaults below apply.
        key={customer?.id ?? 'guest'}
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
            <input
              {...field('name')}
              defaultValue={prefill.name}
              // What the customer typed or saved: not checked for translation (hard rule 10).
              data-user-content
              autoComplete="name"
              maxLength={100}
              className={inputClass}
            />
            {errorText('name')}
          </div>
          <div>
            <label htmlFor="checkout-phone" className="text-sm font-bold text-ink">
              {t('phone')}
            </label>
            <input
              {...field('phone')}
              defaultValue={prefill.phone}
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
              defaultValue={prefill.address}
              // What the customer typed or saved: not checked for translation (hard rule 10).
              data-user-content
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
              defaultValue={prefill.pincode}
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
                checked={method === 'cod'}
                onChange={() => {
                  setMethod('cod');
                }}
                className="size-6 accent-[var(--color-accent-button)]"
              />
              {t('cod')}
            </label>
            <label
              className={`mt-2 flex min-h-11 items-center gap-2 rounded-input border px-3 text-sm ${onlineAvailable ? 'border-input-border text-ink' : 'border-line text-muted'}`}
            >
              <input
                type="radio"
                name="payment"
                value="online"
                checked={method === 'online'}
                disabled={!onlineAvailable}
                onChange={() => {
                  setMethod('online');
                }}
                className="size-6 accent-[var(--color-accent-button)]"
              />
              {onlineAvailable ? t('onlineRazorpay') : t('online')}
            </label>
            {method === 'online' ? <p className="mt-2 text-xs text-muted">{t('onlineNote')}</p> : null}
          </fieldset>
        </div>
        <div className="mt-5 rounded-tile border border-line-card bg-surface-alt p-4">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              id="checkout-business"
              type="checkbox"
              checked={isBusiness}
              onChange={(e) => {
                setIsBusiness(e.target.checked);
                if (!e.target.checked) setErrors(({ gstin: _g, businessName: _b, ...rest }) => rest);
              }}
              className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
            />
            <span>
              <span className="font-bold">{t('businessToggle')}</span>
              <span className="block text-xs text-muted">{t('businessHint')}</span>
            </span>
          </label>
          {isBusiness ? (
            <div className="mt-4 grid gap-4 min-[600px]:grid-cols-2">
              <div>
                <label htmlFor="checkout-gstin" className="text-sm font-bold text-ink">
                  {t('gstin')}
                </label>
                <input
                  {...field('gstin')}
                  value={gstinInput}
                  onChange={(e) => {
                    setGstinInput(e.target.value);
                    // A corrected GSTIN must not keep its old error next to the state note (final review).
                    if (errors.gstin) setErrors(({ gstin: _g, ...rest }) => rest);
                  }}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  className={`${inputClass} uppercase`}
                />
                {errorText('gstin')}
                {otherState ? (
                  <p role="status" className="mt-1 text-xs text-muted">
                    {t('gstStateNote', {
                      state: states(otherState),
                      deliveryState: states(DEMO_CITY.gstStateCode),
                    })}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="checkout-businessName" className="text-sm font-bold text-ink">
                  {t('businessName')}
                </label>
                <input
                  {...field('businessName')}
                  autoComplete="organization"
                  maxLength={120}
                  className={inputClass}
                />
                {errorText('businessName')}
              </div>
            </div>
          ) : null}
        </div>
        {coinAccount && balance > 0 ? (
          <div className="mt-5 rounded-tile border border-line-card bg-surface-alt p-4">
            {redemption.coins > 0 ? (
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={useCoinsOn}
                  onChange={(e) => {
                    setUseCoinsOn(e.target.checked);
                  }}
                  className="mt-0.5 size-6 shrink-0 accent-[var(--color-accent-button)]"
                />
                <span>
                  <span aria-hidden="true">🪙 </span>
                  <span className="font-bold">
                    {t('useCoins', {
                      coins: redemption.coins,
                      amount: formatPrice(redemption.discountPaise),
                    })}
                  </span>
                  <span className="block text-xs text-muted">{t('coinsNote', { balance })}</span>
                </span>
              </label>
            ) : (
              <p className="text-sm text-muted">
                <span aria-hidden="true">🪙 </span>
                {t('coinsNotUsable', { balance })}
              </p>
            )}
          </div>
        ) : null}
        <p className="mt-5 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          <span className="font-bold">{t('policyTitle')}</span> {t('policyNote')}{' '}
          <Link href={`${prefix}/policies/returns`} className="font-bold underline underline-offset-2">
            {t('policyLink')}
          </Link>
        </p>
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
        {onlineNote ? (
          <p role="alert" className="mt-4 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
            {onlineNote.text}{' '}
            {onlineNote.link === 'sign_in' ? (
              <Link
                href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/checkout`)}`}
                className="underline underline-offset-2"
              >
                {t('onlineSignInLink')}
              </Link>
            ) : null}
            {onlineNote.link === 'verify_email' ? (
              <Link href={`${prefix}/account`} className="underline underline-offset-2">
                {t('onlineVerifyLink')}
              </Link>
            ) : null}
          </p>
        ) : null}
        {(blockedNote ?? knownBlock) ? (
          <p role="alert" className="mt-4 rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
            {blockedNote ?? knownBlock}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || knownBlock !== null}
          className="press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
        >
          {submitting
            ? t(method === 'online' ? 'paying' : 'placing')
            : method === 'online'
              ? t('payNow')
              : `${t('place')} · ${formatPrice(payablePaise)}`}
        </button>
      </form>

      <aside className="rounded-card border border-line-card bg-surface p-6 shadow-card">
        <h2 className="font-heading text-lg font-extrabold text-ink">{cartT('summary')}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {priced.map(({ product, qty, linePaise }) => (
            <li key={product.slug} className="flex justify-between gap-3">
              <span className="text-ink">
                {productNameFor(product.slug, product.name, locale)}{' '}
                <span className="text-muted">× {qty}</span>
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
          {coinDiscount > 0 ? (
            <div className="flex justify-between text-success">
              <dt>{t('coinsLine', { coins: redemption.coins })}</dt>
              <dd className="font-bold">−{formatPrice(coinDiscount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base">
            <dt className="font-bold">{cartT('total')}</dt>
            <dd className="font-heading text-xl font-extrabold">{formatPrice(payablePaise)}</dd>
          </div>
        </dl>
        {/* Same hint as the cart, so the fee never surprises (QA 2026-11-14, finding 13). */}
        {deliveryPaise > 0 ? (
          <p className="mt-3 text-xs text-muted">
            {cartT('freeDeliveryHint', { amount: formatPrice(settings.freeDeliveryFromPaise) })}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
