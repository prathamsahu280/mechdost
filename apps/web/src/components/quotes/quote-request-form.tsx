'use client';

import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { DEMO_PRODUCTS, findProduct } from '@/demo/catalogue';
import { DEFAULT_SETTINGS, useSiteSettings } from '@/demo/site-config';
import { createQuote, useCart } from '@/demo/store';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';

/**
 * Prefill quantity: the default minimum (Q20). Computed during server rendering, so it cannot read the admin's
 * browser-stored setting; validation and hints use the live setting (/admin/settings).
 */
const PREFILL_QTY = DEFAULT_SETTINGS.bulkMinUnits;
const MAX_LINES = 20;

type Field = 'items' | 'name' | 'phone' | 'pincode';
interface Line {
  slug: string;
  qty: number;
}

function initialLines(product: string | null, fromCart: boolean, cart: readonly Line[]): Line[] {
  if (fromCart && cart.length > 0) return cart.map((l) => ({ slug: l.slug, qty: Math.max(l.qty, 1) }));
  if (product && findProduct(product)) return [{ slug: product, qty: PREFILL_QTY }];
  return [{ slug: '', qty: PREFILL_QTY }];
}

/**
 * Bulk quote request (spec 19): products + quantities, contact, delivery PIN, note. Opens a negotiation thread with
 * MechDost admin. Demo store until `POST /v1/quotes` ships (signed-in, 3 open quotes per customer).
 */
export function QuoteRequestForm() {
  const t = useTranslations('quote');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const cart = useCart();
  const minUnits = useSiteSettings().bulkMinUnits;
  const fromCart = params.get('from') === 'cart';
  const [lines, setLines] = useState<Line[]>(() => initialLines(params.get('product'), fromCart, cart));
  // The cart is read from storage after hydration: prefill once it arrives.
  const prefilled = useRef(false);
  useEffect(() => {
    if (!fromCart || prefilled.current || cart.length === 0) return;
    prefilled.current = true;
    setLines(initialLines(null, true, cart));
  }, [fromCart, cart]);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const chosen = lines.filter((l) => findProduct(l.slug));
  const units = chosen.reduce((n, l) => n + l.qty, 0);
  const listTotal = chosen.reduce((n, l) => n + (findProduct(l.slug)?.pricePaise ?? 0) * l.qty, 0);

  function update(i: number, change: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));
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
    const next: Partial<Record<Field, string>> = {};
    if (chosen.length === 0) next.items = t('errItems');
    else if (units < minUnits) next.items = t('errMin', { min: minUnits });
    if (value('name').length < 2) next.name = t('errName');
    if (!/^[6-9]\d{9}$/.test(phone)) next.phone = t('errPhone');
    if (!/^[1-9]\d{5}$/.test(value('pincode'))) next.pincode = t('errPincode');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`quote-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    // Merge duplicate product rows so each product appears once.
    const merged = new Map<string, number>();
    for (const l of chosen) merged.set(l.slug, (merged.get(l.slug) ?? 0) + l.qty);
    const quote = createQuote({
      customer: { name: value('name'), phone },
      pincode: value('pincode'),
      note: value('note'),
      lines: [...merged].flatMap(([slug, qty]) => {
        const p = findProduct(slug);
        return p ? [{ slug, name: p.name, brand: p.brand, qty, listPaise: p.pricePaise }] : [];
      }),
    });
    track('click', { id: 'quote_requested', path: window.location.pathname });
    router.push(`${locale === 'hi' ? '/hi' : ''}/quotes/${quote.code}?new=1`);
  }

  const input =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error';
  const aria = (id: Field) => ({
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `quote-${id}-error` : undefined,
  });
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`quote-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('errorSummary')}
        </p>
      ) : null}

      <fieldset id="quote-items" tabIndex={-1} {...aria('items')}>
        <legend className="font-heading text-lg font-extrabold text-ink">{t('items')}</legend>
        <p className="mt-1 text-sm text-muted">{t('minUnits', { min: minUnits })}</p>
        <ul className="mt-4 space-y-3">
          {lines.map((line, i) => {
            const product = findProduct(line.slug);
            return (
              <li
                key={i}
                className="grid grid-cols-[1fr_96px_44px] items-end gap-2 rounded-tile border border-line-card bg-surface-alt p-3"
              >
                <div className="min-w-0">
                  <label htmlFor={`quote-product-${i}`} className="text-xs font-bold text-muted">
                    {t('product')}
                  </label>
                  <select
                    id={`quote-product-${i}`}
                    value={line.slug}
                    onChange={(e) => {
                      update(i, { slug: e.target.value });
                    }}
                    className={`${input} truncate pr-8`}
                  >
                    <option value="">{t('productSelect')}</option>
                    {DEMO_PRODUCTS.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.brand} {p.name} · {formatPrice(p.pricePaise)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`quote-qty-${i}`} className="text-xs font-bold text-muted">
                    {t('qty')}
                  </label>
                  <input
                    id={`quote-qty-${i}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={9999}
                    value={line.qty}
                    onChange={(e) => {
                      update(i, {
                        qty: Math.min(9999, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                      });
                    }}
                    className={`${input} tabular-nums`}
                  />
                </div>
                <button
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() => {
                    setLines((ls) => ls.filter((_, j) => j !== i));
                  }}
                  aria-label={t('remove', { name: product ? product.name : t('product') })}
                  className="press inline-flex size-11 items-center justify-center rounded-button text-muted hover:bg-pill disabled:opacity-40"
                >
                  <X aria-hidden="true" className="size-5" />
                </button>
              </li>
            );
          })}
        </ul>
        {lines.length < MAX_LINES ? (
          <button
            type="button"
            onClick={() => {
              setLines((ls) => [...ls, { slug: '', qty: minUnits }]);
            }}
            className="press mt-3 inline-flex min-h-11 items-center rounded-button border border-dashed border-input-border px-4 text-sm font-bold text-ink hover:bg-pill"
          >
            + {t('add')}
          </button>
        ) : null}
        <p className="mt-3 text-sm text-ink" aria-live="polite">
          <span className="font-bold">{t('units', { count: units })}</span>
          {listTotal > 0 ? (
            <span className="text-muted"> · {t('listTotal', { price: formatPrice(listTotal) })}</span>
          ) : null}
        </p>
        {err('items')}
      </fieldset>

      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div>
          <label htmlFor="quote-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="quote-name"
            {...aria('name')}
            name="name"
            autoComplete="name"
            maxLength={100}
            className={input}
          />
          {err('name')}
        </div>
        <div>
          <label htmlFor="quote-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            id="quote-phone"
            {...aria('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            className={input}
          />
          {err('phone')}
        </div>
        <div>
          <label htmlFor="quote-pincode" className="text-sm font-bold text-ink">
            {t('pincode')}
          </label>
          <input
            id="quote-pincode"
            {...aria('pincode')}
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            className={input}
          />
          {err('pincode')}
        </div>
      </div>

      <div>
        <label htmlFor="quote-note" className="text-sm font-bold text-ink">
          {t('note')}
        </label>
        <textarea
          id="quote-note"
          name="note"
          rows={3}
          maxLength={1000}
          placeholder={t('notePlaceholder')}
          className={`${input} py-2`}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="press inline-flex min-h-12 w-full items-center justify-center rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-70 min-[600px]:w-auto"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
