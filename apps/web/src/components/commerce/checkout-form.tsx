'use client';

import { coinRedemption, type CoinRules } from '@mechdost/shared/coins';
import { GST_STATE_CODES, gstinStateCode, isGstin, normaliseGstin } from '@mechdost/shared/gst';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { SavedAddress } from '@mechdost/shared/account-api';
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
import { DATA_MODE } from '@/lib/data-mode';
import { useCartPricing } from '@/lib/use-cart-pricing';
import { freeDeliveryHints } from '@/lib/free-delivery-hint';
import { checkoutTotals } from '@/lib/checkout-totals';
import { codAllowedAfterCoins, coinRulesFromApi } from '@/lib/coins-view';
import { CartView } from './cart-view';

// Real sign-in: the customer's saved addresses (design 2026-11-15), loaded only for a signed-in customer.
const SavedAddressPicker = lazy(() =>
  import('../account/saved-pickers').then((m) => ({ default: m.SavedAddressPicker })),
);
import { productNameFor } from '@/demo/i18n/localize';
import type { AppliedCoupon } from '@/lib/coupon-api';

// Real data mode: the coupon field (spec 03), loaded only when the customer opens checkout, never with the page shell.
const CheckoutCoupon = lazy(() => import('./checkout-coupon'));

type Field = 'name' | 'phone' | 'address' | 'pincode' | 'gstin' | 'businessName' | 'consent';

const PHONE = /^[6-9]\d{9}$/;
const PIN = /^[1-9]\d{5}$/;

/**
 * Checkout step (spec 03): labelled fields, inline errors, error summary focus. Demo data mode: cash on delivery
 * uses the demo store. Real data mode (`NEXT_PUBLIC_DATA_MODE=api`, launch 2026-11-16): the API quotes the cart
 * for the typed PIN and both payment methods place the order on the API (`lib/orders-api.ts`, idempotency key per
 * attempt); "Pay online" opens Razorpay Checkout (`lib/payments/pay-online.ts`, loaded only when chosen).
 */
export function CheckoutForm() {
  const t = useTranslations('checkout');
  const states = useTranslations('gstStates');
  const cartT = useTranslations('cart');
  const couponT = useTranslations('coupons');
  const locale = useLocale();
  const router = useRouter();
  const lines = useCart();
  const realData = DATA_MODE === 'api';
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
  // Demo data mode: coins live in the demo store. Real data mode: the API's balance and rules (`GET /me/coins`,
  // loaded lazily), and the API re-checks the coins inside the order (409 COINS_CHANGED).
  const coinAccount = !realData && session?.role === 'customer' ? session.id : null;
  const realCustomer = realData && session?.role === 'customer' ? session.id : null;
  const [apiCoins, setApiCoins] = useState<{ balance: number; rules: CoinRules } | null>(null);
  const [coinsReload, setCoinsReload] = useState(0);
  useEffect(() => {
    if (!realCustomer) return;
    let live = true;
    void import('@/lib/coins-api').then(async (api) => {
      const res = await api.fetchMyCoins(locale);
      // Coins are optional at checkout: without an answer the section stays hidden and the order goes ahead.
      if (live && res.ok) setApiCoins({ balance: res.data.balance, rules: coinRulesFromApi(res.data.rules) });
    });
    return () => {
      live = false;
    };
  }, [realCustomer, locale, coinsReload]);
  // A signed-in customer starts from their name, number and default address (QA 2026-11-14, U6 / crawler F3:
  // everything was empty and the PIN fixed at 492001). Guests keep the Raipur PIN hint.
  const customer = session?.role === 'customer' ? session : null;
  const home = customer
    ? (customer.addresses.find((a) => a.isDefault) ?? customer.addresses[0] ?? null)
    : null;
  // A saved address picked from the API (real sign-in) replaces the prefill below; null = type a different one.
  const [picked, setPicked] = useState<SavedAddress | null>(null);
  const base = {
    name: customer?.name ?? '',
    phone: customer?.phone ?? '',
    address: home ? [home.line1, home.landmark].filter((part) => part.trim() !== '').join(', ') : '',
    pincode: home?.pincode ?? '492001',
  };
  const prefill = picked
    ? {
        name: picked.contactName,
        phone: picked.contactPhone.replace(/^\+91/, ''),
        address: [picked.line1, picked.line2, picked.landmark]
          .filter((part) => part !== null && part.trim() !== '')
          .join(', '),
        pincode: picked.pincode,
      }
    : base;
  const pickKey = picked?.id ?? 'typed';
  // Real data mode re-quotes as the PIN changes (the server's prices, delivery and GST are the only numbers shown).
  const [typedPin, setTypedPin] = useState<string | null>(null);
  const pricing = useCartPricing(
    lines,
    typedPin !== null && PIN.test(typedPin) ? typedPin : prefill.pincode,
    locale,
  );
  const { priced, subtotalPaise, deliveryPaise, totalPaise } = pricing;
  const hints = pricing.quote ? freeDeliveryHints(pricing.quote.groups) : [];
  // One coupon (spec 03, real data mode): taken off first; the server re-checks it when the order is placed.
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const couponDiscount = coupon?.discountPaise ?? 0;
  const couponProducts = coupon?.productDiscountPaise ?? 0;
  const quotePin = typedPin !== null && PIN.test(typedPin) ? typedPin : prefill.pincode;
  // A signed-in customer's block is known before they type anything: say so at once and stop the order
  // (QA 2026-11-14, crawler F2: it was only shown after submitting). The typed-phone check below stays.
  useCustomerBlocks();
  // The API enforces blocks itself in real data mode (403 ORDERS_BLOCKED); the demo checks them here.
  const signedInAllowed = session && !realData ? customerAllowed(session.id) : null;
  const knownBlock =
    signedInAllowed && (!signedInAllowed.order || !signedInAllowed.cod)
      ? signedInAllowed.order
        ? t('blockedCod')
        : t('blockedOrders')
      : null;
  const demoCoins = useCoins(coinAccount);
  const balance = realData ? (apiCoins?.balance ?? 0) : demoCoins.balance;
  // Coins come after the coupon: on what the products cost once the coupon's share is off (spec 20).
  const redemption = coinRedemption(
    balance,
    subtotalPaise - couponProducts,
    realData ? (apiCoins?.rules ?? { ...coinRulesFrom(settings), maxRedeemBp: 0 }) : coinRulesFrom(settings),
  );
  const [useCoinsOn, setUseCoinsOn] = useState(false);
  // Demo: coins are a demo-store discount on cash on delivery only. Real data: the API applies them to both methods.
  const coinDiscount = useCoinsOn && (realData || method === 'cod') ? redemption.discountPaise : 0;
  const showCoins = (coinAccount !== null || realCustomer !== null) && balance > 0;
  // The summary always adds up: a cash-on-delivery fee is its own line, and paying online does not carry it.
  const { feePaise, payablePaise } = checkoutTotals({
    method,
    totalPaise,
    codFeePaise: pricing.codFeePaise,
    onlineTotalPaise: pricing.onlineTotalPaise,
    coinDiscountPaise: coinDiscount,
    couponDiscountPaise: couponDiscount,
  });
  const prefix = locale === 'hi' ? '/hi' : '';
  // A press while the quote is still loading would do nothing: the button shows a pending state instead (QA 2026-11-16, bug 4).
  const checkingPrices = realData && pricing.status === 'loading';
  // Business purchase (buyer GSTIN plan 2026-11-13): optional; checked with the shared, Zod-free GST helpers.
  const [isBusiness, setIsBusiness] = useState(false);
  const [gstinInput, setGstinInput] = useState('');
  const typedGstin = normaliseGstin(gstinInput);
  type StateKey = Parameters<typeof states>[0];
  const isStateKey = (code: string): code is StateKey => GST_STATE_CODES.includes(code);
  // A verified trade account (audience entry design 2026-11-22): its saved GSTIN and business name are offered here.
  // Optional like the rest: nothing is switched on or required for the customer. Loaded lazily, real sign-in only.
  const [trade, setTrade] = useState<{ gstin: string | null; businessName: string } | null>(null);
  useEffect(() => {
    if (AUTH_MODE !== 'firebase') return;
    let live = true;
    void import('@/lib/business-api')
      .then(({ fetchTradeProfile }) => fetchTradeProfile(locale))
      .then((res) => {
        if (!live || !res.ok || res.data.status !== 'verified') return;
        setTrade({ gstin: res.data.gstin, businessName: res.data.businessName ?? '' });
        const saved = res.data.gstin ?? '';
        setGstinInput((typed) => typed || saved);
      });
    return () => {
      live = false;
    };
  }, [locale]);
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

  if (realData && priced.length === 0 && pricing.status !== 'ready' && !submitting)
    return (
      <p
        role={pricing.status === 'error' ? 'alert' : 'status'}
        className="rounded-card border border-line-card bg-surface p-6 text-sm font-bold text-ink shadow-card"
      >
        {pricing.status === 'error' ? t('pricesError') : t('pricesLoading')}
      </p>
    );
  if (priced.length === 0 && !submitting) return <CartView />;

  /** Real data mode, cash on delivery: the API places the order (one key per attempt, never a second order). */
  async function placeCodApi(
    details: { name: string; phone: string; address: string; pincode: string },
    business: { gstin: string; businessName: string } | null,
  ) {
    const quote = pricing.quote;
    setOnlineNote(null);
    if (pricing.error === 'PINCODE_NOT_SERVICEABLE') {
      setErrors({ pincode: t('errService') });
      document.getElementById('checkout-pincode')?.focus();
      return;
    }
    if (!quote) {
      setOnlineNote({ text: pricing.status === 'error' ? t('pricesError') : t('pricesLoading') });
      return;
    }
    // Judged on what the customer pays at the door, after coins (the server checks the same).
    if (!codAllowedAfterCoins(quote, coinDiscount + couponDiscount)) {
      setOnlineNote({ text: t('cod_not_allowed') });
      return;
    }
    setSubmitting(true);
    attemptKey.current ??= crypto.randomUUID().replace(/-/g, '');
    const { placeCodOrder } = await import('@/lib/orders-api');
    const res = await placeCodOrder(
      locale,
      {
        address: {
          contactName: details.name,
          contactPhone: `+91${details.phone}`,
          line1: details.address,
          pincode: details.pincode,
        },
        lines: priced.map(({ product, qty }) => ({ sku: product.sku, qty })),
        expectedTotalPaise: quote.totalPaise - couponDiscount - coinDiscount,
        business,
        coins: coinDiscount > 0 ? redemption.coins : 0,
        // An automatic offer is not sent: the server finds it again (never stacked with a code, 2026-11-16).
        couponCode: coupon?.source === 'code' ? coupon.coupon.code : null,
      },
      attemptKey.current,
    );
    setSubmitting(false);
    if (res.ok) {
      track('purchase_submitted', {
        code: res.data.code,
        valuePaise: res.data.totalPaise,
        demo: false,
        businessPurchase: business !== null,
      });
      clearCart();
      attemptKey.current = null;
      router.push(`${prefix}/orders/${res.data.code}?new=1`);
      return;
    }
    track('click', { id: `checkout_cod_${res.code.toLowerCase()}`, path: window.location.pathname });
    if (
      [
        'PRICE_CHANGED',
        'OUT_OF_STOCK',
        'CHECKOUT_UNAVAILABLE',
        'IDEMPOTENCY_MISMATCH',
        'COINS_CHANGED',
        'INSUFFICIENT_COINS',
        'COUPON_INVALID',
      ].includes(res.code)
    )
      attemptKey.current = null;
    // The coupon no longer applies (used up, ended, cart changed): drop it, show the new total, let them choose again.
    if (res.code === 'COUPON_INVALID') {
      setCoupon(null);
      setOnlineNote({ text: couponT('err_changed') });
      return;
    }
    // The coins changed (spent elsewhere, or the rules changed): reload them and let the customer check again.
    if (res.code === 'COINS_CHANGED' || res.code === 'INSUFFICIENT_COINS') {
      setUseCoinsOn(false);
      setCoinsReload((n) => n + 1);
      setOnlineNote({ text: t('coins_api_changed') });
      return;
    }
    const note =
      res.code === 'AUTH_REQUIRED'
        ? { text: t('cod_sign_in'), link: 'sign_in' as const }
        : res.code === 'VERIFICATION_REQUIRED'
          ? { text: t('cod_verify_email'), link: 'verify_email' as const }
          : res.code === 'PRICE_CHANGED'
            ? { text: t('cod_price_changed') }
            : res.code === 'OUT_OF_STOCK' || res.code === 'CHECKOUT_UNAVAILABLE'
              ? { text: t('online_cart_changed') }
              : res.code === 'COD_NOT_ALLOWED'
                ? { text: t('cod_not_allowed') }
                : res.code === 'ORDERS_BLOCKED'
                  ? { text: t('blockedOrders') }
                  : { text: t('cod_unavailable') };
    setOnlineNote(note);
  }

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
      coins: coinDiscount > 0 ? { count: redemption.coins, discountPaise: coinDiscount } : null,
      coupon: coupon
        ? { code: coupon.source === 'code' ? coupon.coupon.code : null, discountPaise: couponDiscount }
        : null,
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
      result.reason === 'details_changed' ||
      result.reason === 'coins_changed'
    )
      attemptKey.current = null;
    if (result.reason === 'coins_changed') {
      setUseCoinsOn(false);
      setCoinsReload((n) => n + 1);
    }
    if (result.reason === 'coupon_invalid') {
      setCoupon(null);
      setOnlineNote({ text: couponT('err_changed') });
      return;
    }
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
    // Demo: Raipur only. Real data mode: the API decides which PINs are served (any city, rule 7).
    else if (!realData && !pincode.startsWith('4920')) next.pincode = t('errService');
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
    const allowed = realData
      ? { order: true, cod: true }
      : customerAllowed(session?.id ?? findAccount(phone)?.id ?? null);
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
    if (realData) {
      void placeCodApi({ name: value('name'), phone, address: value('address'), pincode }, business);
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
          {AUTH_MODE === 'firebase' && customer ? (
            <Suspense fallback={null}>
              <SavedAddressPicker
                onPick={(address) => {
                  setPicked(address);
                  setTypedPin(address ? address.pincode : null);
                }}
              />
            </Suspense>
          ) : null}
          <div>
            <label htmlFor="checkout-name" className="text-sm font-bold text-ink">
              {t('name')}
            </label>
            <input
              {...field('name')}
              key={`name-${pickKey}`}
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
              key={`phone-${pickKey}`}
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
              key={`address-${pickKey}`}
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
              onChange={(e) => {
                setTypedPin(e.currentTarget.value.trim());
              }}
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={6}
              key={`pincode-${pickKey}`}
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
                {trade?.gstin && typedGstin === trade.gstin ? (
                  <p className="mt-1 text-xs text-muted">{t('tradeGstinNote')}</p>
                ) : null}
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
                  defaultValue={trade?.businessName ?? ''}
                  autoComplete="organization"
                  maxLength={120}
                  className={inputClass}
                />
                {errorText('businessName')}
              </div>
            </div>
          ) : null}
        </div>
        {realData && AUTH_MODE === 'firebase' && priced.length > 0 ? (
          <div className="mt-5">
            <Suspense fallback={null}>
              <CheckoutCoupon
                pincode={quotePin}
                lines={priced.map(({ product, qty }) => ({ sku: product.sku, qty }))}
                applied={coupon}
                onApply={(c) => {
                  setCoupon(c);
                  // Coins were worked out on the products before the coupon: ask again on the new amount.
                  setUseCoinsOn(false);
                }}
              />
            </Suspense>
          </div>
        ) : null}
        {showCoins ? (
          <div className="mt-5 rounded-tile border border-line-card bg-surface-alt p-4">
            {redemption.coins > 0 ? (
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={useCoinsOn}
                  onChange={(e) => {
                    setUseCoinsOn(e.target.checked);
                    track('click', {
                      id: e.target.checked ? 'checkout_coins_on' : 'checkout_coins_off',
                      path: window.location.pathname,
                    });
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
          disabled={submitting || checkingPrices || knownBlock !== null}
          aria-busy={submitting || checkingPrices}
          className="press mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
        >
          {submitting
            ? t(method === 'online' ? 'paying' : 'placing')
            : checkingPrices
              ? t('checking')
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
          {feePaise > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted">{t('codFee')}</dt>
              <dd className="font-bold">{formatPrice(feePaise)}</dd>
            </div>
          ) : null}
          {couponDiscount > 0 ? (
            <div className="flex justify-between text-success">
              <dt>
                {coupon?.source === 'automatic'
                  ? couponT('auto_applied', { title: coupon.coupon.title })
                  : couponT('line', { code: coupon?.coupon.code ?? '' })}
              </dt>
              <dd className="font-bold">−{formatPrice(couponDiscount)}</dd>
            </div>
          ) : null}
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
        {/* The hint names the threshold the server applied to each shop's group (PIN, shop or city), so it never
            disagrees with the charge (QA 2026-11-16, bug 7). The demo has no quote and keeps the city setting. */}
        {pricing.quote ? (
          hints.map((h) => (
            <p key={h.seller} className="mt-3 text-xs text-muted">
              {cartT('freeDeliveryGroupHint', { amount: formatPrice(h.minPaise) })}
            </p>
          ))
        ) : deliveryPaise > 0 ? (
          <p className="mt-3 text-xs text-muted">{cartT('freeDeliveryHint')}</p>
        ) : null}
      </aside>
    </div>
  );
}
